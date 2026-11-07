package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.entity.ProjectMember;
import com.hourglass.entity.WorkspaceMember;
import com.hourglass.mapper.ProjectMemberMapper;
import com.hourglass.mapper.WorkspaceMemberMapper;
import org.junit.jupiter.api.Test;

import java.util.Arrays;
import java.util.Collections;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ProjectAccessServiceTest {

    private static final String WS = "W1";

    private final ProjectMemberMapper grants = mock(ProjectMemberMapper.class);
    private final WorkspaceMemberMapper members = mock(WorkspaceMemberMapper.class);
    private final ProjectAccessService service = new ProjectAccessService(grants, members);

    @Test
    void viewerSeesEverythingButCannotWrite() {
        member("U1", ProjectAccessService.ROLE_VIEWER);

        assertTrue(service.canView(WS, "U1", "R1"));
        assertFalse(service.canWrite(WS, "U1", "R1"));

        AppException error = assertThrows(AppException.class, () -> service.assertWrite(WS, "U1", null));
        assertEquals(403, error.getCode());
        verify(grants, never()).selectOne(anyString(), anyString(), anyString());
    }

    @Test
    void memberWithoutGrantDefaultsToParticipate() {
        member("U2", ProjectAccessService.ROLE_MEMBER);
        when(grants.selectOne(WS, "R1", "U2")).thenReturn(null);

        assertTrue(service.canView(WS, "U2", "R1"));
        assertTrue(service.canWrite(WS, "U2", "R1"));
    }

    @Test
    void memberWithNoneGrantTreatsProjectAsMissing() {
        member("U2", ProjectAccessService.ROLE_MEMBER);
        when(grants.selectOne(WS, "R1", "U2")).thenReturn(grant("R1", "U2", ProjectAccessService.ACCESS_NONE));
        when(grants.selectByUser(WS, "U2")).thenReturn(Arrays.asList(
                grant("R1", "U2", ProjectAccessService.ACCESS_NONE),
                grant("R2", "U2", ProjectAccessService.ACCESS_READ)));

        assertFalse(service.canView(WS, "U2", "R1"));
        assertEquals(Collections.singleton("R1"), service.hiddenProjectIds(WS, "U2"));

        AppException error = assertThrows(AppException.class, () -> service.assertView(WS, "U2", "R1"));
        assertEquals(404, error.getCode(), "不可见项目按不存在处理，避免泄露项目是否存在");

        AppException writeError = assertThrows(AppException.class, () -> service.assertWrite(WS, "U2", "R1"));
        assertEquals(404, writeError.getCode(), "写入口径与读一致：不能靠 403 反推项目存在");
    }

    @Test
    void readGrantKeepsViewButBlocksWrite() {
        member("U2", ProjectAccessService.ROLE_MEMBER);
        when(grants.selectOne(WS, "R1", "U2")).thenReturn(grant("R1", "U2", ProjectAccessService.ACCESS_READ));

        assertTrue(service.canView(WS, "U2", "R1"));
        assertFalse(service.canWrite(WS, "U2", "R1"));

        AppException error = assertThrows(AppException.class, () -> service.assertWrite(WS, "U2", "R1"));
        assertEquals(403, error.getCode());
    }

    @Test
    void privilegedRolesIgnoreExplicitNoneAndKeepFullLists() {
        member("U3", ProjectAccessService.ROLE_OWNER);
        when(grants.selectByUser(WS, "U3"))
                .thenReturn(Collections.singletonList(grant("R1", "U3", ProjectAccessService.ACCESS_NONE)));

        assertTrue(service.canView(WS, "U3", "R1"));
        assertTrue(service.canWrite(WS, "U3", "R1"));
        assertTrue(service.hiddenProjectIds(WS, "U3").isEmpty());
        verify(grants, never()).selectByUser(WS, "U3");
    }

    @Test
    void saveGrantNormalizesLegacyRolesAndDefaultToRemoval() {
        service.saveGrant(WS, "U2", "R1", ProjectAccessService.ACCESS_DEV);
        service.saveGrant(WS, "U2", "R1", "pm");
        service.saveGrant(WS, "U2", "R1", " default ");

        verify(grants, times(3)).deleteOne(WS, "R1", "U2");
        verify(grants, never()).upsert(org.mockito.ArgumentMatchers.any(ProjectMember.class));
    }

    @Test
    void saveGrantPersistsSupportedAccess() {
        service.saveGrant(WS, "U2", "R1", ProjectAccessService.ACCESS_NONE);

        org.mockito.ArgumentCaptor<ProjectMember> saved =
                org.mockito.ArgumentCaptor.forClass(ProjectMember.class);
        verify(grants).upsert(saved.capture());
        assertEquals(WS, saved.getValue().getWorkspaceId());
        assertEquals("R1", saved.getValue().getProjectId());
        assertEquals("U2", saved.getValue().getUserId());
        assertEquals(ProjectAccessService.ACCESS_NONE, saved.getValue().getAccess());
    }

    @Test
    void saveGrantRejectsUnknownValue() {
        AppException error = assertThrows(AppException.class,
                () -> service.saveGrant(WS, "U2", "R1", "superuser"));
        assertEquals(400, error.getCode());
        verify(grants, never()).upsert(org.mockito.ArgumentMatchers.any(ProjectMember.class));
    }

    @Test
    void normalizeAccessCollapsesLegacyAndDefaultValues() {
        assertEquals("", ProjectAccessService.normalizeAccess(null));
        assertEquals("", ProjectAccessService.normalizeAccess("  "));
        assertEquals("", ProjectAccessService.normalizeAccess("DEFAULT"));
        assertEquals("", ProjectAccessService.normalizeAccess("pm"));
        assertEquals("", ProjectAccessService.normalizeAccess("dev"));
        assertEquals("", ProjectAccessService.normalizeAccess("qa"));
        assertEquals(ProjectAccessService.ACCESS_READ, ProjectAccessService.normalizeAccess(" READ "));
        assertEquals(ProjectAccessService.ACCESS_NONE, ProjectAccessService.normalizeAccess("none"));
    }

    @Test
    void filterVisibleMembersMatchesCanViewWithoutPerMemberQueries() {
        WorkspaceMember owner = rawMember("U9", ProjectAccessService.ROLE_OWNER);
        WorkspaceMember viewer = rawMember("U8", ProjectAccessService.ROLE_VIEWER);
        WorkspaceMember hidden = rawMember("U2", ProjectAccessService.ROLE_MEMBER);
        WorkspaceMember plain = rawMember("U3", ProjectAccessService.ROLE_MEMBER);
        when(grants.selectByWorkspace(WS))
                .thenReturn(Collections.singletonList(grant("R1", "U2", ProjectAccessService.ACCESS_NONE)));

        java.util.List<WorkspaceMember> visible = service.filterVisibleMembers(WS,
                Arrays.asList(owner, viewer, hidden, plain), "R1");

        assertEquals(3, visible.size());
        assertEquals("U9", visible.get(0).getUserId());
        assertEquals("U8", visible.get(1).getUserId());
        assertEquals("U3", visible.get(2).getUserId());
        verify(grants, times(1)).selectByWorkspace(WS);
        verify(members, never()).selectMember(anyString(), anyString());
    }

    @Test
    void filterVisibleMembersKeepsAllWhenTaskHasNoProject() {
        WorkspaceMember owner = rawMember("U9", ProjectAccessService.ROLE_OWNER);
        WorkspaceMember hidden = rawMember("U2", ProjectAccessService.ROLE_MEMBER);
        when(grants.selectByWorkspace(WS))
                .thenReturn(Collections.singletonList(grant("R1", "U2", ProjectAccessService.ACCESS_NONE)));

        java.util.List<WorkspaceMember> visible = service.filterVisibleMembers(WS,
                Arrays.asList(owner, hidden), null);

        assertEquals(2, visible.size());
        verify(grants, never()).selectByWorkspace(WS);
    }

    private WorkspaceMember rawMember(String userId, String role) {
        WorkspaceMember m = new WorkspaceMember();
        m.setWorkspaceId(WS);
        m.setUserId(userId);
        m.setRole(role);
        return m;
    }

    private void member(String userId, String role) {
        WorkspaceMember m = new WorkspaceMember();
        m.setWorkspaceId(WS);
        m.setUserId(userId);
        m.setRole(role);
        when(members.selectMember(WS, userId)).thenReturn(m);
    }

    private ProjectMember grant(String projectId, String userId, String access) {
        ProjectMember pm = new ProjectMember();
        pm.setWorkspaceId(WS);
        pm.setProjectId(projectId);
        pm.setUserId(userId);
        pm.setAccess(access);
        return pm;
    }
}
