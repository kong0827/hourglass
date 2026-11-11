package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.dto.ProjectMemberRoleOverview;
import com.hourglass.dto.ProjectMemberRoleView;
import com.hourglass.entity.ProjectMember;
import com.hourglass.entity.ProjectMemberRole;
import com.hourglass.entity.Requirement;
import com.hourglass.entity.WorkspaceMember;
import com.hourglass.mapper.ProjectMemberMapper;
import com.hourglass.mapper.ProjectMemberRoleMapper;
import com.hourglass.mapper.WorkspaceMemberMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 项目花名册与角色标注：只影响展示，读可见性沿用既有项目授权口径。 */
class ProjectMemberRoleServiceTest {

    private static final String WS = "S1";
    private static final String P = "P1";
    private static final String OWNER = "U-owner";
    private static final String ADMIN = "U-admin";
    private static final String PLAIN = "U-plain";
    private static final String VIEWER = "U-viewer";

    private WorkspaceMemberMapper memberMapper;
    private ProjectMemberMapper projectMemberMapper;
    private ProjectMemberRoleMapper roleMapper;
    private ProjectAccessService access;
    private ProjectMemberRoleService service;
    private Requirement project;

    @BeforeEach
    void setUp() {
        memberMapper = mock(WorkspaceMemberMapper.class);
        projectMemberMapper = mock(ProjectMemberMapper.class);
        roleMapper = mock(ProjectMemberRoleMapper.class);
        access = mock(ProjectAccessService.class);
        service = new ProjectMemberRoleService(memberMapper, projectMemberMapper, roleMapper, access);

        project = new Requirement();
        project.setId(P);
        project.setName("项目一");
        project.setOwnerUserId(OWNER);
        project.setWorkspaceId(WS);
    }

    @Test
    void rosterSkipsViewersAndInvisibleMembersAndExplainsSource() {
        WorkspaceMember owner = member(OWNER, "owner", null);
        WorkspaceMember admin = member(ADMIN, "admin", null);
        WorkspaceMember plain = member(PLAIN, "member", null);
        WorkspaceMember hidden = member("U-hidden", "member", "assigned");
        WorkspaceMember granted = member("U-granted", "member", "assigned");
        WorkspaceMember viewer = member(VIEWER, "viewer", null);
        when(memberMapper.selectByWorkspace(WS)).thenReturn(Arrays.asList(
                owner, admin, plain, hidden, granted, viewer));

        List<ProjectMember> grants = new ArrayList<ProjectMember>();
        grants.add(grant(PLAIN, "write"));
        grants.add(grant("U-hidden", "none"));
        grants.add(grant("U-granted", "read"));
        when(projectMemberMapper.selectByWorkspace(WS)).thenReturn(grants);

        ProjectMemberRole role = new ProjectMemberRole();
        role.setWorkspaceId(WS);
        role.setProjectId(P);
        role.setUserId(PLAIN);
        role.setRoleTitle("前端");
        when(roleMapper.selectByProject(WS, P)).thenReturn(Collections.singletonList(role));

        ProjectMemberRoleOverview overview = service.roster(WS, project, OWNER);

        assertTrue(overview.isCanEditRole());
        Map<String, ProjectMemberRoleView> byUser = new HashMap<String, ProjectMemberRoleView>();
        for (ProjectMemberRoleView v : overview.getMembers()) {
            byUser.put(v.getUserId(), v);
        }
        assertEquals(4, overview.getMembers().size());
        assertFalse(byUser.containsKey(VIEWER));
        assertFalse(byUser.containsKey("U-hidden"));

        assertEquals("项目负责人", byUser.get(OWNER).getSource());
        assertEquals("write", byUser.get(OWNER).getAccess());
        assertEquals("空间管理员", byUser.get(ADMIN).getSource());
        assertEquals("空间默认参与", byUser.get(PLAIN).getSource());
        assertEquals("前端", byUser.get(PLAIN).getRoleTitle());
        assertEquals("项目授权", byUser.get("U-granted").getSource());
        assertEquals("read", byUser.get("U-granted").getAccess());
        assertTrue(byUser.get(PLAIN).isCanEditRole());
    }

    @Test
    void viewerCanReadRosterButCannotEdit() {
        when(memberMapper.selectByWorkspace(WS)).thenReturn(Collections.singletonList(member(VIEWER, "viewer", null)));
        when(roleMapper.selectByProject(WS, P)).thenReturn(Collections.emptyList());
        when(projectMemberMapper.selectByWorkspace(WS)).thenReturn(Collections.emptyList());

        ProjectMemberRoleOverview overview = service.roster(WS, project, VIEWER);

        assertFalse(overview.isCanEditRole());
        assertTrue(overview.getMembers().isEmpty());
    }

    @Test
    void plainMemberCannotSaveRole() {
        when(access.roleOf(WS, PLAIN)).thenReturn("member");

        AppException ex = assertThrows(AppException.class,
                () -> service.saveRole(WS, project, ADMIN, "前端", PLAIN));
        assertEquals(403, ex.getCode());
        verify(roleMapper, never()).upsert(any(ProjectMemberRole.class));
    }

    @Test
    void viewerCannotSaveRoleEvenWhenOwnerOfProject() {
        project.setOwnerUserId(VIEWER);
        when(access.roleOf(WS, VIEWER)).thenReturn("viewer");

        AppException ex = assertThrows(AppException.class,
                () -> service.saveRole(WS, project, ADMIN, "前端", VIEWER));
        assertEquals(403, ex.getCode());
    }

    @Test
    void projectOwnerCanSaveTrimmedRole() {
        when(access.roleOf(WS, OWNER)).thenReturn("member");
        when(memberMapper.selectMember(WS, PLAIN)).thenReturn(member(PLAIN, "member", null));
        when(access.canView(WS, PLAIN, P)).thenReturn(true);

        String saved = service.saveRole(WS, project, PLAIN, "  产品经理  ", OWNER);

        assertEquals("产品经理", saved);
        ArgumentCaptor<ProjectMemberRole> captor = ArgumentCaptor.forClass(ProjectMemberRole.class);
        verify(roleMapper).upsert(captor.capture());
        assertEquals(WS, captor.getValue().getWorkspaceId());
        assertEquals(P, captor.getValue().getProjectId());
        assertEquals(PLAIN, captor.getValue().getUserId());
        assertEquals("产品经理", captor.getValue().getRoleTitle());
    }

    @Test
    void adminCanClearRoleWithBlankValue() {
        when(access.roleOf(WS, ADMIN)).thenReturn("admin");
        when(memberMapper.selectMember(WS, PLAIN)).thenReturn(member(PLAIN, "member", null));
        when(access.canView(WS, PLAIN, P)).thenReturn(true);

        String saved = service.saveRole(WS, project, PLAIN, "   ", ADMIN);

        assertEquals("", saved);
        verify(roleMapper).deleteOne(WS, P, PLAIN);
        verify(roleMapper, never()).upsert(any(ProjectMemberRole.class));
    }

    @Test
    void roleTooLongIsRejected() {
        when(access.roleOf(WS, ADMIN)).thenReturn("admin");
        when(memberMapper.selectMember(WS, PLAIN)).thenReturn(member(PLAIN, "member", null));
        when(access.canView(WS, PLAIN, P)).thenReturn(true);
        StringBuilder title = new StringBuilder();
        for (int i = 0; i < 33; i++) {
            title.append('角');
        }

        AppException ex = assertThrows(AppException.class,
                () -> service.saveRole(WS, project, PLAIN, title.toString(), ADMIN));
        assertEquals(400, ex.getCode());
        verify(roleMapper, never()).upsert(any(ProjectMemberRole.class));
    }

    @Test
    void viewerTargetIsRejected() {
        when(access.roleOf(WS, ADMIN)).thenReturn("admin");
        when(memberMapper.selectMember(WS, VIEWER)).thenReturn(member(VIEWER, "viewer", null));

        AppException ex = assertThrows(AppException.class,
                () -> service.saveRole(WS, project, VIEWER, "QA", ADMIN));
        assertEquals(400, ex.getCode());
    }

    @Test
    void targetWithoutProjectVisibilityIsRejected() {
        when(access.roleOf(WS, ADMIN)).thenReturn("admin");
        when(memberMapper.selectMember(WS, PLAIN)).thenReturn(member(PLAIN, "member", "assigned"));
        when(access.canView(WS, PLAIN, P)).thenReturn(false);

        AppException ex = assertThrows(AppException.class,
                () -> service.saveRole(WS, project, PLAIN, "QA", ADMIN));
        assertEquals(400, ex.getCode());
        verify(roleMapper, never()).upsert(any(ProjectMemberRole.class));
    }

    @Test
    void unknownTargetIs404() {
        when(access.roleOf(WS, ADMIN)).thenReturn("admin");
        when(memberMapper.selectMember(WS, "U-ghost")).thenReturn(null);

        AppException ex = assertThrows(AppException.class,
                () -> service.saveRole(WS, project, "U-ghost", "QA", ADMIN));
        assertEquals(404, ex.getCode());
    }

    @Test
    void rosterWithoutRoleRowsLeavesRoleTitleNull() {
        when(memberMapper.selectByWorkspace(WS)).thenReturn(Collections.singletonList(member(PLAIN, "member", null)));
        when(roleMapper.selectByProject(WS, P)).thenReturn(Collections.emptyList());
        when(projectMemberMapper.selectByWorkspace(WS)).thenReturn(Collections.emptyList());

        ProjectMemberRoleView view = service.roster(WS, project, ADMIN).getMembers().get(0);

        assertNull(view.getRoleTitle());
        assertEquals("write", view.getAccess());
    }

    private static WorkspaceMember member(String userId, String role, String mode) {
        WorkspaceMember m = new WorkspaceMember();
        m.setWorkspaceId(WS);
        m.setUserId(userId);
        m.setRole(role);
        m.setProjectAccessMode(mode);
        m.setDisplayName(userId + "-name");
        return m;
    }

    private static ProjectMember grant(String userId, String access) {
        ProjectMember pm = new ProjectMember();
        pm.setWorkspaceId(WS);
        pm.setProjectId(P);
        pm.setUserId(userId);
        pm.setAccess(access);
        return pm;
    }
}
