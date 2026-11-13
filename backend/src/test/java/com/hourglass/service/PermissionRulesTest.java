package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.entity.ProjectMember;
import com.hourglass.entity.Workspace;
import com.hourglass.entity.WorkspaceMember;
import com.hourglass.mapper.BoardColumnMapper;
import com.hourglass.mapper.CategoryMapper;
import com.hourglass.mapper.InviteMapper;
import com.hourglass.mapper.ProjectMemberMapper;
import com.hourglass.mapper.SavedViewMapper;
import com.hourglass.mapper.UserMapper;
import com.hourglass.mapper.WorkspaceMapper;
import com.hourglass.mapper.WorkspaceMemberMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicLong;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 空间角色（owner/admin/member/viewer）与项目可见范围的规则回归。 */
class PermissionRulesTest {

    private static final String WS = "S1";
    private static final String OWNER = "U1";
    private static final String ADMIN = "U2";
    private static final String MEMBER = "U3";
    private static final String VIEWER = "U4";
    private static final String OTHER_ADMIN = "U5";
    private static final String PROJECT = "P1";

    private final Map<String, String> roles = new HashMap<String, String>();

    private WorkspaceMapper workspaceMapper;
    private WorkspaceMemberMapper memberMapper;
    private ProjectMemberMapper projectMemberMapper;
    private WorkspaceService workspaceService;
    private ProjectAccessService projectAccessService;

    @BeforeEach
    void setUp() {
        roles.put(OWNER, ProjectAccessService.ROLE_OWNER);
        roles.put(ADMIN, ProjectAccessService.ROLE_ADMIN);
        roles.put(MEMBER, ProjectAccessService.ROLE_MEMBER);
        roles.put(VIEWER, ProjectAccessService.ROLE_VIEWER);
        roles.put(OTHER_ADMIN, ProjectAccessService.ROLE_ADMIN);

        workspaceMapper = mock(WorkspaceMapper.class);
        memberMapper = mock(WorkspaceMemberMapper.class);
        projectMemberMapper = mock(ProjectMemberMapper.class);
        when(workspaceMapper.selectById(WS)).thenReturn(workspace());
        when(memberMapper.selectMember(anyString(), anyString())).thenAnswer(invocation ->
                member(invocation.getArgument(1), roles.get(invocation.getArgument(1))));

        WorkspaceMemberCache memberCache = new WorkspaceMemberCache(workspaceMapper, memberMapper,
                60_000L, new AtomicLong(1_000_000L)::get);
        projectAccessService = new ProjectAccessService(projectMemberMapper, memberMapper);
        workspaceService = new WorkspaceService(workspaceMapper, memberMapper, mock(UserMapper.class),
                mock(BoardColumnMapper.class), mock(com.hourglass.mapper.ColumnTransitionMapper.class),
                mock(CategoryMapper.class),
                mock(com.hourglass.mapper.WorkspacePriorityMapper.class), mock(SavedViewMapper.class),
                mock(com.hourglass.mapper.AppNotificationMapper.class),
                mock(com.hourglass.mapper.UserListPreferenceMapper.class),
                mock(WorkActivityService.class),
                mock(InviteMapper.class),
                mock(com.hourglass.mapper.InviteProjectGrantMapper.class), projectMemberMapper,
                mock(com.hourglass.mapper.ProjectMemberRoleMapper.class),
                mock(com.hourglass.mapper.TaskWatchMapper.class), mock(TaskCascade.class),
                mock(ActivityService.class), memberCache, mock(WorkspaceMetaCache.class),
                mock(com.hourglass.mapper.WorkspaceMemberLabelOptionMapper.class), mock(MemberLabelLogService.class),
                projectAccessService);
    }

    /* ==================== WorkspaceService ==================== */

    @Test
    void viewerCannotWriteOrManageWorkspace() {
        assertEquals(403, assertThrows(AppException.class,
                () -> workspaceService.requireWriter(VIEWER, WS)).getCode());
        assertEquals(403, assertThrows(AppException.class,
                () -> workspaceService.requireManager(VIEWER, WS)).getCode());
    }

    @Test
    void memberCanWriteButCannotManageWorkspace() {
        assertEquals(ProjectAccessService.ROLE_MEMBER,
                workspaceService.requireWriter(MEMBER, WS).getMyRole());
        assertEquals(403, assertThrows(AppException.class,
                () -> workspaceService.requireManager(MEMBER, WS)).getCode());
    }

    @Test
    void adminCannotPromoteMemberToAdmin() {
        assertEquals(403, assertThrows(AppException.class,
                () -> workspaceService.updateMemberRole(ADMIN, WS, MEMBER, ProjectAccessService.ROLE_ADMIN))
                .getCode());
        verify(memberMapper, never()).updateRole(anyString(), anyString(), anyString());
    }

    @Test
    void adminCannotTouchExistingAdmin() {
        assertEquals(403, assertThrows(AppException.class,
                () -> workspaceService.updateMemberRole(ADMIN, WS, OTHER_ADMIN, ProjectAccessService.ROLE_MEMBER))
                .getCode());
        verify(memberMapper, never()).updateRole(anyString(), anyString(), anyString());
    }

    @Test
    void adminCanDemoteMemberToViewer() {
        workspaceService.updateMemberRole(ADMIN, WS, MEMBER, ProjectAccessService.ROLE_VIEWER);
        verify(memberMapper).updateRole(WS, MEMBER, ProjectAccessService.ROLE_VIEWER);
    }

    /** 回归：按项目分配的成员经「升管理员 → 退回成员」不能变成全部可见 */
    @Test
    void roleRoundTripKeepsAssignedModeAndGrants() {
        roles.put(MEMBER, ProjectAccessService.ROLE_ADMIN);
        workspaceService.updateMemberRole(OWNER, WS, MEMBER, ProjectAccessService.ROLE_MEMBER);

        verify(memberMapper).updateRole(WS, MEMBER, ProjectAccessService.ROLE_MEMBER);
        verify(projectMemberMapper, never()).deleteByUser(anyString(), anyString());
        verify(memberMapper, never()).updateProjectAccessMode(anyString(), anyString(), anyString());
        /* 担任管理员期间新建的项目没有 none 种子，退回成员时补齐 */
        verify(projectMemberMapper).seedAssignedNone(WS);
    }

    @Test
    void promotingMemberDoesNotTouchProjectGrants() {
        workspaceService.updateMemberRole(OWNER, WS, MEMBER, ProjectAccessService.ROLE_ADMIN);

        verify(memberMapper).updateRole(WS, MEMBER, ProjectAccessService.ROLE_ADMIN);
        verify(projectMemberMapper, never()).deleteByUser(anyString(), anyString());
        verify(projectMemberMapper, never()).seedAssignedNone(anyString());
        verify(memberMapper, never()).updateProjectAccessMode(anyString(), anyString(), anyString());
    }

    @Test
    void ownerCanPromoteMemberToOwner() {
        workspaceService.updateMemberRole(OWNER, WS, MEMBER, ProjectAccessService.ROLE_OWNER);

        verify(memberMapper).updateRole(WS, MEMBER, ProjectAccessService.ROLE_OWNER);
    }

    @Test
    void ownerCanDemoteAnotherOwnerWhenOneRemains() {
        roles.put(MEMBER, ProjectAccessService.ROLE_OWNER);
        when(memberMapper.countOwners(WS)).thenReturn(2);

        workspaceService.updateMemberRole(OWNER, WS, MEMBER, ProjectAccessService.ROLE_MEMBER);

        verify(memberMapper).updateRole(WS, MEMBER, ProjectAccessService.ROLE_MEMBER);
    }

    @Test
    void cannotDemoteLastOwner() {
        when(memberMapper.countOwners(WS)).thenReturn(1);

        assertEquals(400, assertThrows(AppException.class,
                () -> workspaceService.updateMemberRole(OWNER, WS, OWNER, ProjectAccessService.ROLE_MEMBER))
                .getCode());
        verify(memberMapper, never()).updateRole(anyString(), anyString(), anyString());
    }

    @Test
    void adminCannotGrantOrTouchOwner() {
        assertEquals(403, assertThrows(AppException.class,
                () -> workspaceService.updateMemberRole(ADMIN, WS, MEMBER, ProjectAccessService.ROLE_OWNER))
                .getCode());
        assertEquals(403, assertThrows(AppException.class,
                () -> workspaceService.updateMemberRole(ADMIN, WS, OWNER, ProjectAccessService.ROLE_MEMBER))
                .getCode());
        verify(memberMapper, never()).updateRole(anyString(), anyString(), anyString());
    }

    @Test
    void ownerCanLeaveWhenAnotherOwnerRemains() {
        when(memberMapper.countOwners(WS)).thenReturn(2);

        workspaceService.removeMember(OWNER, WS, OWNER);

        verify(memberMapper).delete(WS, OWNER);
    }

    @Test
    void lastOwnerCannotLeave() {
        when(memberMapper.countOwners(WS)).thenReturn(1);

        assertEquals(400, assertThrows(AppException.class,
                () -> workspaceService.removeMember(OWNER, WS, OWNER)).getCode());
        verify(memberMapper, never()).delete(anyString(), anyString());
    }

    @Test
    void ownerCanRemoveAnotherOwnerWhenOneRemains() {
        roles.put(MEMBER, ProjectAccessService.ROLE_OWNER);
        when(memberMapper.countOwners(WS)).thenReturn(2);

        workspaceService.removeMember(OWNER, WS, MEMBER);

        verify(memberMapper).delete(WS, MEMBER);
    }

    @Test
    void adminCannotRemoveOwner() {
        roles.put(MEMBER, ProjectAccessService.ROLE_OWNER);

        assertEquals(403, assertThrows(AppException.class,
                () -> workspaceService.removeMember(ADMIN, WS, MEMBER)).getCode());
        verify(memberMapper, never()).delete(anyString(), anyString());
    }

    @Test
    void adminCannotRemoveAdmin() {
        assertEquals(403, assertThrows(AppException.class,
                () -> workspaceService.removeMember(ADMIN, WS, OTHER_ADMIN)).getCode());
        verify(memberMapper, never()).delete(anyString(), anyString());
    }

    @Test
    void adminCanRemoveMember() {
        workspaceService.removeMember(ADMIN, WS, MEMBER);
        verify(memberMapper).delete(WS, MEMBER);
        verify(projectMemberMapper).deleteByUser(WS, MEMBER);
    }

    @Test
    void viewerCanLeaveButNotWrite() {
        workspaceService.removeMember(VIEWER, WS, VIEWER);
        verify(memberMapper).delete(WS, VIEWER);
    }

    @Test
    void onlyPrivilegedOrProjectOwnerCanManageModules() {
        com.hourglass.mapper.RequirementMapper requirementMapper = mock(com.hourglass.mapper.RequirementMapper.class);
        com.hourglass.entity.Requirement project = new com.hourglass.entity.Requirement();
        project.setId(PROJECT);
        project.setWorkspaceId(WS);
        project.setOwnerUserId(MEMBER);
        when(requirementMapper.selectById(PROJECT)).thenReturn(project);
        ReleasePermissionService release = new ReleasePermissionService(memberMapper, requirementMapper, projectAccessService);
        CategoryService categories = new CategoryService(mock(CategoryMapper.class), requirementMapper,
                mock(ActivityService.class), mock(DeletionTraceService.class),
                projectAccessService, release, mock(WorkspaceMetaCache.class));

        categories.assertManage(WS, OWNER, PROJECT);
        categories.assertManage(WS, ADMIN, PROJECT);
        categories.assertManage(WS, MEMBER, PROJECT);
        assertEquals(403, assertThrows(AppException.class,
                () -> categories.assertManage(WS, VIEWER, PROJECT)).getCode());
        roles.put("U6", ProjectAccessService.ROLE_MEMBER);
        assertEquals(403, assertThrows(AppException.class,
                () -> categories.assertManage(WS, "U6", PROJECT)).getCode());

        when(projectMemberMapper.selectOne(WS, PROJECT, MEMBER))
                .thenReturn(grant(PROJECT, MEMBER, ProjectAccessService.ACCESS_READ));
        assertEquals(403, assertThrows(AppException.class,
                () -> categories.assertManage(WS, MEMBER, PROJECT)).getCode(), "项目负责人被设为只读时也不能维护模块");
    }

    /* ==================== ProjectAccessService ==================== */

    @Test
    void viewerScopeIsNullForPrivilegedAndViewerOnly() {
        assertNull(projectAccessService.viewerScope(WS, OWNER));
        assertNull(projectAccessService.viewerScope(WS, ADMIN));
        assertNull(projectAccessService.viewerScope(WS, VIEWER));
        assertEquals(MEMBER, projectAccessService.viewerScope(WS, MEMBER));
    }

    @Test
    void viewerCannotWriteEvenWithoutProject() {
        assertEquals(403, assertThrows(AppException.class,
                () -> projectAccessService.assertWrite(WS, VIEWER, null)).getCode());
        projectAccessService.assertWrite(WS, MEMBER, null);
    }

    @Test
    void readOnlyGrantRejectsWriteButAllowsView() {
        when(projectMemberMapper.selectOne(WS, PROJECT, MEMBER))
                .thenReturn(grant(PROJECT, MEMBER, ProjectAccessService.ACCESS_READ));

        projectAccessService.assertView(WS, MEMBER, PROJECT);
        assertEquals(403, assertThrows(AppException.class,
                () -> projectAccessService.assertWrite(WS, MEMBER, PROJECT)).getCode());
    }

    @Test
    void noneGrantHidesProjectFromReads() {
        when(projectMemberMapper.selectOne(WS, PROJECT, MEMBER))
                .thenReturn(grant(PROJECT, MEMBER, ProjectAccessService.ACCESS_NONE));

        assertEquals(404, assertThrows(AppException.class,
                () -> projectAccessService.assertView(WS, MEMBER, PROJECT)).getCode());
    }

    @Test
    void hiddenProjectIdsOnlyCollectsExplicitNone() {
        when(projectMemberMapper.selectByUser(WS, MEMBER)).thenReturn(Arrays.asList(
                grant("P1", MEMBER, ProjectAccessService.ACCESS_NONE),
                grant("P2", MEMBER, ProjectAccessService.ACCESS_READ),
                grant("P3", MEMBER, ProjectAccessService.ACCESS_PM)));

        Set<String> hidden = projectAccessService.hiddenProjectIds(WS, MEMBER);
        assertEquals(new HashSet<String>(Arrays.asList("P1")), hidden);
        assertTrue(projectAccessService.hiddenProjectIds(WS, ADMIN).isEmpty());
        assertTrue(projectAccessService.hiddenProjectIds(WS, VIEWER).isEmpty());
    }

    @Test
    void legacyRoleGrantsCollapseToDefault() {
        for (String legacy : Arrays.asList(ProjectAccessService.ACCESS_PM,
                ProjectAccessService.ACCESS_DEV, ProjectAccessService.ACCESS_QA, "default", "")) {
            projectAccessService.saveGrant(WS, MEMBER, PROJECT, legacy);
        }
        verify(projectMemberMapper, org.mockito.Mockito.times(5)).deleteOne(WS, PROJECT, MEMBER);
        verify(projectMemberMapper, never()).upsert(any(ProjectMember.class));
    }

    @Test
    void grantValuesStillPersist() {
        projectAccessService.saveGrant(WS, MEMBER, PROJECT, ProjectAccessService.ACCESS_NONE);
        verify(projectMemberMapper).upsert(any(ProjectMember.class));
    }

    private static Workspace workspace() {
        Workspace ws = new Workspace();
        ws.setId(WS);
        ws.setName("space");
        ws.setType("shared");
        ws.setOwnerId(OWNER);
        return ws;
    }

    private static WorkspaceMember member(String userId, String role) {
        if (role == null) {
            return null;
        }
        WorkspaceMember m = new WorkspaceMember();
        m.setWorkspaceId(WS);
        m.setUserId(userId);
        m.setRole(role);
        return m;
    }

    private static ProjectMember grant(String projectId, String userId, String access) {
        ProjectMember pm = new ProjectMember();
        pm.setWorkspaceId(WS);
        pm.setProjectId(projectId);
        pm.setUserId(userId);
        pm.setAccess(access);
        return pm;
    }
}
