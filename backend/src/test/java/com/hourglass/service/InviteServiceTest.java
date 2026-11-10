package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.dto.InviteCreateRequest;
import com.hourglass.entity.Invite;
import com.hourglass.entity.InviteProjectGrant;
import com.hourglass.entity.ProjectMember;
import com.hourglass.entity.Requirement;
import com.hourglass.entity.Workspace;
import com.hourglass.mapper.InviteMapper;
import com.hourglass.mapper.InviteProjectGrantMapper;
import com.hourglass.mapper.ProjectMemberMapper;
import com.hourglass.mapper.RequirementMapper;
import com.hourglass.mapper.UserMapper;
import com.hourglass.mapper.WorkspaceMapper;
import com.hourglass.mapper.WorkspaceMemberMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.time.LocalDateTime;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class InviteServiceTest {

    private static final String WS = "W1";
    private static final String CODE = "ABCDE23456";

    private final InviteMapper inviteMapper = mock(InviteMapper.class);
    private final InviteProjectGrantMapper grantMapper = mock(InviteProjectGrantMapper.class);
    private final ProjectMemberMapper projectMemberMapper = mock(ProjectMemberMapper.class);
    private final RequirementMapper requirementMapper = mock(RequirementMapper.class);
    private final WorkspaceMapper workspaceMapper = mock(WorkspaceMapper.class);
    private final WorkspaceMemberMapper memberMapper = mock(WorkspaceMemberMapper.class);
    private final UserMapper userMapper = mock(UserMapper.class);
    private final WorkspaceService workspaceService = mock(WorkspaceService.class);
    private final InviteService service = new InviteService(inviteMapper, grantMapper, projectMemberMapper,
            requirementMapper, workspaceMapper, memberMapper, userMapper, workspaceService);

    @BeforeEach
    void setUp() {
        Workspace ws = new Workspace();
        ws.setId(WS);
        ws.setName("团队空间");
        ws.setType("shared");
        when(workspaceService.requireManager("U1", WS)).thenReturn(ws);
        when(workspaceMapper.selectById(WS)).thenReturn(ws);
        when(requirementMapper.selectById("P1")).thenReturn(project("P1"));
        when(requirementMapper.selectById("P2")).thenReturn(project("P2"));
    }

    @Test
    void createStoresOnlyReadableOrWritableGrants() {
        InviteCreateRequest request = new InviteCreateRequest();
        request.setGrants(Arrays.asList(
                grant("P1", "write"),
                grant("P2", " read "),
                grant("P1", "read"),
                grant("P3", "none"),
                grant("P4", "default")));

        Map<String, Object> res = service.create("U1", WS, request);

        assertEquals(2, res.get("grantCount"));
        ArgumentCaptor<InviteProjectGrant> saved = ArgumentCaptor.forClass(InviteProjectGrant.class);
        verify(grantMapper, times(2)).insert(saved.capture());
        List<InviteProjectGrant> grants = saved.getAllValues();
        assertEquals("P1", grants.get(0).getProjectId());
        assertEquals(ProjectAccessService.ACCESS_WRITE, grants.get(0).getAccess());
        assertEquals("P2", grants.get(1).getProjectId());
        assertEquals(ProjectAccessService.ACCESS_READ, grants.get(1).getAccess());
    }

    @Test
    void createRejectsProjectFromAnotherWorkspace() {
        Requirement foreign = project("P8");
        foreign.setWorkspaceId("W2");
        when(requirementMapper.selectById("P8")).thenReturn(foreign);
        InviteCreateRequest request = new InviteCreateRequest();
        request.setGrants(Collections.singletonList(grant("P8", "read")));

        assertEquals(404, assertThrows(AppException.class,
                () -> service.create("U1", WS, request)).getCode());
        verify(grantMapper, never()).insert(any(InviteProjectGrant.class));
    }

    @Test
    void createWithoutGrantsStillReturnsUsableInvite() {
        Map<String, Object> res = service.create("U1", WS);

        assertEquals(0, res.get("grantCount"));
        verify(inviteMapper).insert(any(Invite.class));
        verifyNoInteractions(grantMapper);
    }

    @Test
    void joinSeedsMemberThenAppliesInviteGrants() {
        Invite inv = invite(CODE);
        when(inviteMapper.selectByIdForUpdate(CODE)).thenReturn(inv);
        when(inviteMapper.incrUsedCount(CODE)).thenReturn(1);
        when(memberMapper.selectMember(WS, "U2")).thenReturn(null);
        when(grantMapper.selectByInvite(CODE)).thenReturn(Arrays.asList(
                inviteGrant("P1", "write"), inviteGrant("P2", "read"),
                inviteGrant("P9", "read")));

        Map<String, Object> res = service.join(CODE.toLowerCase(), "U2");

        assertFalse((Boolean) res.get("already"));
        assertEquals(2, res.get("grantCount"), "已删除或跨空间的项目授权应跳过");
        verify(workspaceService).joinByInvite(WS, "U2");
        ArgumentCaptor<ProjectMember> upserted = ArgumentCaptor.forClass(ProjectMember.class);
        verify(projectMemberMapper, times(2)).upsert(upserted.capture());
        assertEquals(WS, upserted.getAllValues().get(0).getWorkspaceId());
        assertEquals("U2", upserted.getAllValues().get(0).getUserId());
        assertEquals(ProjectAccessService.ACCESS_WRITE, upserted.getAllValues().get(0).getAccess());
        verify(inviteMapper).incrUsedCount(CODE);
    }

    @Test
    void existingMemberJoinDoesNotOverwriteGrants() {
        Invite inv = invite(CODE);
        when(inviteMapper.selectByIdForUpdate(CODE)).thenReturn(inv);
        when(memberMapper.selectMember(WS, "U2"))
                .thenReturn(new com.hourglass.entity.WorkspaceMember());

        Map<String, Object> res = service.join(CODE, "U2");

        assertTrue((Boolean) res.get("already"));
        verify(workspaceService, never()).joinByInvite(anyString(), anyString());
        verifyNoInteractions(grantMapper);
        verify(projectMemberMapper, never()).upsert(any(ProjectMember.class));
    }

    @Test
    void revokeRemovesInviteGrantsBeforeInvite() {
        Invite inv = invite(CODE);
        when(inviteMapper.selectByIdForUpdate(CODE)).thenReturn(inv);

        service.revoke("U1", WS, CODE);

        org.mockito.InOrder order = org.mockito.Mockito.inOrder(grantMapper, inviteMapper);
        order.verify(inviteMapper).selectByIdForUpdate(CODE);
        order.verify(grantMapper).deleteByInvite(CODE);
        order.verify(inviteMapper).delete(CODE);
    }

    /** 加入先锁邀请行再锁用户行：与撤销串行，同一用户并发加入排队后走「已是成员」 */
    @Test
    void joinLocksInviteThenUserBeforeCheckingMembership() {
        Invite inv = invite(CODE);
        when(inviteMapper.selectByIdForUpdate(CODE)).thenReturn(inv);
        when(inviteMapper.incrUsedCount(CODE)).thenReturn(1);
        when(grantMapper.selectByInvite(CODE)).thenReturn(Collections.<InviteProjectGrant>emptyList());

        service.join(CODE, "U2");

        org.mockito.InOrder order = org.mockito.Mockito.inOrder(inviteMapper, userMapper, memberMapper, workspaceService);
        order.verify(inviteMapper).selectByIdForUpdate(CODE);
        order.verify(userMapper).lockById("U2");
        order.verify(memberMapper).selectMember(WS, "U2");
        order.verify(workspaceService).joinByInvite(WS, "U2");
        verify(inviteMapper, never()).selectById(anyString());
    }

    @Test
    void joinFailsWhenInviteRevokedConcurrently() {
        when(inviteMapper.selectByIdForUpdate(CODE)).thenReturn(null);

        assertEquals(404, assertThrows(AppException.class, () -> service.join(CODE, "U2")).getCode());
        verify(workspaceService, never()).joinByInvite(anyString(), anyString());
    }

    @Test
    void joinRollsBackWhenUsedCountNotUpdated() {
        when(inviteMapper.selectByIdForUpdate(CODE)).thenReturn(invite(CODE));
        when(inviteMapper.incrUsedCount(CODE)).thenReturn(0);
        when(grantMapper.selectByInvite(CODE)).thenReturn(Collections.<InviteProjectGrant>emptyList());

        assertEquals(404, assertThrows(AppException.class, () -> service.join(CODE, "U2")).getCode());
    }

    @Test
    void revokeOfUnknownInviteIs404() {
        when(inviteMapper.selectByIdForUpdate(CODE)).thenReturn(null);
        assertEquals(404, assertThrows(AppException.class, () -> service.revoke("U1", WS, CODE)).getCode());
        verify(grantMapper, never()).deleteByInvite(anyString());
    }

    @Test
    void infoCountsGrantsAndOnlyExposesWorkspaceIdToMembers() {
        when(inviteMapper.selectById(CODE)).thenReturn(invite(CODE));
        when(grantMapper.selectByInvite(CODE)).thenReturn(Arrays.asList(
                inviteGrant("P1", "write"), inviteGrant("P2", "read"), inviteGrant("P3", "write")));
        when(memberMapper.selectMember(WS, "U2")).thenReturn(new com.hourglass.entity.WorkspaceMember());

        Map<String, Object> anon = service.info(CODE, null);
        assertEquals(2, anon.get("writeGrantCount"));
        assertEquals(1, anon.get("readGrantCount"));
        assertFalse((Boolean) anon.get("alreadyMember"));
        assertFalse(anon.containsKey("workspaceId"), "匿名访问不暴露空间 ID");

        Map<String, Object> member = service.info(CODE, "U2");
        assertTrue((Boolean) member.get("alreadyMember"));
        assertEquals(WS, member.get("workspaceId"));

        Map<String, Object> outsider = service.info(CODE, "U3");
        assertFalse((Boolean) outsider.get("alreadyMember"));
        assertFalse(outsider.containsKey("workspaceId"));
    }

    private Requirement project(String id) {
        Requirement r = new Requirement();
        r.setId(id);
        r.setWorkspaceId(WS);
        r.setName(id);
        return r;
    }

    private Invite invite(String code) {
        Invite inv = new Invite();
        inv.setId(code);
        inv.setWorkspaceId(WS);
        inv.setCreatedBy("U1");
        inv.setExpiresAt(LocalDateTime.now().plusDays(1));
        return inv;
    }

    private InviteCreateRequest.Grant grant(String projectId, String access) {
        InviteCreateRequest.Grant g = new InviteCreateRequest.Grant();
        g.setProjectId(projectId);
        g.setAccess(access);
        return g;
    }

    private InviteProjectGrant inviteGrant(String projectId, String access) {
        InviteProjectGrant g = new InviteProjectGrant();
        g.setInviteId(CODE);
        g.setWorkspaceId(WS);
        g.setProjectId(projectId);
        g.setAccess(access);
        return g;
    }
}
