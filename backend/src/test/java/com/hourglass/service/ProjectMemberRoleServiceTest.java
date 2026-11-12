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
    private com.hourglass.mapper.RequirementMapper projects;
    private MemberLabelLogService labelLogs;
    private Requirement project;

    @BeforeEach
    void setUp() {
        memberMapper = mock(WorkspaceMemberMapper.class);
        projectMemberMapper = mock(ProjectMemberMapper.class);
        roleMapper = mock(ProjectMemberRoleMapper.class);
        access = mock(ProjectAccessService.class);
        projects = mock(com.hourglass.mapper.RequirementMapper.class);
        labelLogs = mock(MemberLabelLogService.class);
        service = new ProjectMemberRoleService(memberMapper, projectMemberMapper, roleMapper, access,
                projects, mock(com.hourglass.mapper.WorkspaceMemberLabelOptionMapper.class), labelLogs);
        when(access.roleOf(WS, OWNER)).thenReturn("owner");

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

    @Test
    void inheritsWorkspaceTitleWithoutBackfillingOverride() {
        WorkspaceMember target = member(PLAIN, "member", null);
        target.setJobTitle("全栈工程师");
        when(memberMapper.selectByWorkspace(WS)).thenReturn(Collections.singletonList(target));
        ProjectMemberRoleView view = service.roster(WS, project, OWNER).getMembers().get(0);
        assertNull(view.getRoleTitle());
        assertEquals("全栈工程师", view.getJobTitle());
        assertEquals("全栈工程师", view.getEffectiveRoleTitle());
        assertEquals("workspace", view.getRoleSource());
        assertEquals(Collections.emptyList(), view.getSecondaryRoleTitles());
        verify(roleMapper, never()).upsert(any());
    }

    @Test
    void primaryOverrideWinsAndSecondaryOnlyStillInheritsDefault() {
        WorkspaceMember target = member(PLAIN, "member", null);
        target.setJobTitle("开发");
        when(memberMapper.selectByWorkspace(WS)).thenReturn(Collections.singletonList(target));
        ProjectMemberRole row = role(PLAIN, "测试", "产品经理");
        when(roleMapper.selectByProject(WS, P)).thenReturn(Collections.singletonList(row));
        ProjectMemberRoleView view = service.roster(WS, project, OWNER).getMembers().get(0);
        assertEquals("测试", view.getEffectiveRoleTitle());
        assertEquals("project", view.getRoleSource());
        assertEquals(Collections.singletonList("产品经理"), view.getSecondaryRoleTitles());
        row.setRoleTitle("");
        view = service.roster(WS, project, OWNER).getMembers().get(0);
        assertEquals("", view.getRoleTitle());
        assertEquals("开发", view.getEffectiveRoleTitle());
        assertEquals("workspace", view.getRoleSource());
        target.setJobTitle(null);
        assertEquals("unset", service.roster(WS, project, OWNER).getMembers().get(0).getRoleSource());
    }

    @Test
    void omittedSecondaryPreservesAndBlankPrimaryKeepsSecondaryRow() {
        allowTarget(PLAIN);
        when(roleMapper.selectOne(WS, P, PLAIN)).thenReturn(role(PLAIN, "开发", "测试"));
        service.saveRole(WS, project, PLAIN, "  ", null, OWNER);
        ArgumentCaptor<ProjectMemberRole> row = ArgumentCaptor.forClass(ProjectMemberRole.class);
        verify(roleMapper).upsert(row.capture());
        assertEquals("", row.getValue().getRoleTitle());
        assertEquals(Collections.singletonList("测试"), row.getValue().getSecondaryRoleTitles());
        verify(roleMapper, never()).deleteOne(anyString(), anyString(), anyString());
    }

    @Test
    void explicitEmptySecondaryClearsAndEmptyPrimaryDeletesRow() {
        allowTarget(PLAIN);
        when(roleMapper.selectOne(WS, P, PLAIN)).thenReturn(role(PLAIN, "开发", "测试"));
        service.saveRole(WS, project, PLAIN, "", Collections.emptyList(), OWNER);
        verify(roleMapper).deleteOne(WS, P, PLAIN);
        verify(labelLogs).record(org.mockito.ArgumentMatchers.eq(WS), org.mockito.ArgumentMatchers.eq(OWNER),
                org.mockito.ArgumentMatchers.eq("project_role"), org.mockito.ArgumentMatchers.eq("project"),
                org.mockito.ArgumentMatchers.eq(P), anyString(), anyString());
    }

    @Test
    void secondaryTrimsDeduplicatesAndExcludesPrimary() {
        allowTarget(PLAIN);
        service.saveRole(WS, project, PLAIN, " 测试 ", Arrays.asList(" 测试", "开发 ", "开发", "", "产品经理"), OWNER);
        ArgumentCaptor<ProjectMemberRole> row = ArgumentCaptor.forClass(ProjectMemberRole.class);
        verify(roleMapper).upsert(row.capture());
        assertEquals(Arrays.asList("开发", "产品经理"), row.getValue().getSecondaryRoleTitles());
    }

    @Test
    void secondaryLimitsRejectBeforeWriting() {
        allowTarget(PLAIN);
        assertThrows(AppException.class, () -> service.saveRole(WS, project, PLAIN, "开发",
                Arrays.asList("a", "b", "c", "d", "e", "f"), OWNER));
        assertThrows(AppException.class, () -> service.saveRole(WS, project, PLAIN, "开发",
                Collections.singletonList(String.join("", Collections.nCopies(33, "角"))), OWNER));
        verify(roleMapper, never()).upsert(any());
    }

    @Test
    void batchDeduplicatesAndPreservesPerUserSecondary() {
        allowTarget(PLAIN);
        allowTarget(ADMIN);
        when(roleMapper.selectByProject(WS, P)).thenReturn(Arrays.asList(role(PLAIN, "", "测试"), role(ADMIN, "", "开发")));
        assertEquals(Integer.valueOf(2), service.saveRoles(WS, project, Arrays.asList(PLAIN, ADMIN, PLAIN),
                "产品经理", null, OWNER).get("updated"));
        ArgumentCaptor<ProjectMemberRole> rows = ArgumentCaptor.forClass(ProjectMemberRole.class);
        verify(roleMapper, org.mockito.Mockito.times(2)).upsert(rows.capture());
        assertEquals(Collections.singletonList("测试"), rows.getAllValues().get(0).getSecondaryRoleTitles());
        assertEquals(Collections.singletonList("开发"), rows.getAllValues().get(1).getSecondaryRoleTitles());
        verify(labelLogs).record(org.mockito.ArgumentMatchers.eq(WS), org.mockito.ArgumentMatchers.eq(OWNER),
                org.mockito.ArgumentMatchers.eq("project_role"), anyString(), anyString(), anyString(), anyString());
    }

    @Test
    void batchInvalidLastTargetWritesNothing() {
        allowTarget(PLAIN);
        when(memberMapper.selectMember(WS, VIEWER)).thenReturn(member(VIEWER, "viewer", null));
        assertThrows(AppException.class, () -> service.saveRoles(WS, project, Arrays.asList(PLAIN, VIEWER), "开发", null, OWNER));
        verify(roleMapper, never()).upsert(any());
        verify(roleMapper, never()).deleteOne(anyString(), anyString(), anyString());
        org.mockito.Mockito.verifyNoInteractions(labelLogs);
    }

    @Test
    void batchInvisibleTargetAndUnauthorizedOperatorRejectWholeBatch() {
        allowTarget(PLAIN);
        when(memberMapper.selectMember(WS, ADMIN)).thenReturn(member(ADMIN, "member", "assigned"));
        assertThrows(AppException.class, () -> service.saveRoles(WS, project, Arrays.asList(PLAIN, ADMIN), "开发", null, OWNER));
        when(access.roleOf(WS, ADMIN)).thenReturn("member");
        assertThrows(AppException.class, () -> service.saveRoles(WS, project, Collections.singletonList(PLAIN), "开发", null, ADMIN));
        verify(roleMapper, never()).upsert(any());
    }

    @Test
    void batchCapsUniqueTargetsAt200() {
        List<String> ids = new ArrayList<String>();
        for (int i = 0; i < 201; i++) ids.add("U" + i);
        assertThrows(AppException.class, () -> service.saveRoles(WS, project, ids, "开发", null, OWNER));
        verify(roleMapper, never()).upsert(any());
    }

    @Test
    void copyDefaultSkipsProjectOverrideButSnapshotsWorkspaceDefault() {
        copySetup();
        WorkspaceMember plain = member(PLAIN, "member", null);
        plain.setJobTitle("全栈工程师");
        when(memberMapper.selectByWorkspace(WS)).thenReturn(Arrays.asList(plain, member(ADMIN, "admin", null)));
        when(access.canView(WS, ADMIN, "P2")).thenReturn(true);
        when(access.canView(WS, ADMIN, P)).thenReturn(true);
        when(roleMapper.selectByProject(WS, "P2")).thenReturn(Collections.singletonList(role(ADMIN, "产品经理", "测试")));
        when(roleMapper.selectByProject(WS, P)).thenReturn(Collections.singletonList(role(ADMIN, "", "开发")));
        Map<String, Integer> result = service.copyRoles(WS, project, "P2", false, OWNER);
        assertEquals(Integer.valueOf(1), result.get("copied"));
        assertEquals(Integer.valueOf(1), result.get("skipped"));
        ArgumentCaptor<ProjectMemberRole> row = ArgumentCaptor.forClass(ProjectMemberRole.class);
        verify(roleMapper).upsert(row.capture());
        assertEquals("全栈工程师", row.getValue().getRoleTitle());
        assertEquals(P, row.getValue().getProjectId());
    }

    @Test
    void copyOverwriteReplacesPrimaryAndSecondary() {
        copySetup();
        when(roleMapper.selectByProject(WS, "P2")).thenReturn(Collections.singletonList(role(PLAIN, "产品经理", "测试")));
        when(roleMapper.selectByProject(WS, P)).thenReturn(Collections.singletonList(role(PLAIN, "开发", "业务")));
        Map<String, Integer> result = service.copyRoles(WS, project, "P2", true, OWNER);
        assertEquals(Integer.valueOf(1), result.get("copied"));
        assertEquals(Integer.valueOf(0), result.get("skipped"));
        ArgumentCaptor<ProjectMemberRole> row = ArgumentCaptor.forClass(ProjectMemberRole.class);
        verify(roleMapper).upsert(row.capture());
        assertEquals("产品经理", row.getValue().getRoleTitle());
        assertEquals(Collections.singletonList("测试"), row.getValue().getSecondaryRoleTitles());
    }

    @Test
    void copySecondaryOnlyWorksButHiddenAndViewerAreNotCopied() {
        copySetup();
        when(memberMapper.selectByWorkspace(WS)).thenReturn(Arrays.asList(member(PLAIN, "member", null),
                member(VIEWER, "viewer", null), member(ADMIN, "member", "assigned")));
        when(roleMapper.selectByProject(WS, "P2")).thenReturn(Arrays.asList(role(PLAIN, "", "测试"),
                role(VIEWER, "开发"), role(ADMIN, "开发")));
        assertEquals(Integer.valueOf(1), service.copyRoles(WS, project, "P2", false, OWNER).get("copied"));
        ArgumentCaptor<ProjectMemberRole> row = ArgumentCaptor.forClass(ProjectMemberRole.class);
        verify(roleMapper).upsert(row.capture());
        assertEquals("", row.getValue().getRoleTitle());
        assertEquals(Collections.singletonList("测试"), row.getValue().getSecondaryRoleTitles());
    }

    @Test
    void copyCrossWorkspaceAndUnreadableSourceFailBeforeWriting() {
        copySetup();
        Requirement source = new Requirement();
        source.setId("P2"); source.setWorkspaceId("another-space");
        when(projects.selectById("P2")).thenReturn(source);
        assertThrows(AppException.class, () -> service.copyRoles(WS, project, "P2", false, OWNER));
        source.setWorkspaceId(WS);
        org.mockito.Mockito.doThrow(AppException.notFound("无权限")).when(access).assertView(WS, OWNER, "P2");
        assertThrows(AppException.class, () -> service.copyRoles(WS, project, "P2", false, OWNER));
        verify(roleMapper, never()).upsert(any());
    }

    @Test
    void copyRequiresEditableTarget() {
        when(access.roleOf(WS, PLAIN)).thenReturn("member");
        assertEquals(403, assertThrows(AppException.class,
                () -> service.copyRoles(WS, project, "P2", true, PLAIN)).getCode());
        org.mockito.Mockito.verifyNoInteractions(projects, labelLogs);
    }

    @Test
    void secondaryJsonTypeHandlerRoundTripsAndPreservesSqlNull() throws Exception {
        com.hourglass.mapper.RoleTitlesTypeHandler handler = new com.hourglass.mapper.RoleTitlesTypeHandler();
        java.sql.PreparedStatement statement = mock(java.sql.PreparedStatement.class);
        handler.setNonNullParameter(statement, 1, Arrays.asList("测试", "产品经理"), org.apache.ibatis.type.JdbcType.VARCHAR);
        verify(statement).setString(1, "[\"测试\",\"产品经理\"]");
        java.sql.ResultSet results = mock(java.sql.ResultSet.class);
        when(results.getString("secondary_role_titles")).thenReturn("[\"测试\",\"产品经理\"]");
        assertEquals(Arrays.asList("测试", "产品经理"), handler.getNullableResult(results, "secondary_role_titles"));
        when(results.getString("secondary_role_titles")).thenReturn(null);
        assertNull(handler.getNullableResult(results, "secondary_role_titles"));
    }

    @Test
    void memberRoleMapperXmlIncludesSecondaryAndWorkspaceDefaultColumns() throws Exception {
        org.apache.ibatis.session.Configuration configuration = new org.apache.ibatis.session.Configuration();
        configuration.getTypeAliasRegistry().registerAlias("ProjectMemberRole", ProjectMemberRole.class);
        configuration.getTypeAliasRegistry().registerAlias("WorkspaceMember", WorkspaceMember.class);
        for (String resource : Arrays.asList("mapper/ProjectMemberRoleMapper.xml", "mapper/WorkspaceMemberMapper.xml")) {
            try (java.io.InputStream input = getClass().getClassLoader().getResourceAsStream(resource)) {
                new org.apache.ibatis.builder.xml.XMLMapperBuilder(input, configuration, resource, configuration.getSqlFragments()).parse();
            }
        }
        org.apache.ibatis.mapping.MappedStatement upsert = configuration.getMappedStatement("com.hourglass.mapper.ProjectMemberRoleMapper.upsert");
        org.apache.ibatis.mapping.BoundSql sql = upsert.getBoundSql(role(PLAIN, "开发", "测试"));
        assertTrue(sql.getSql().contains("secondary_role_titles"));
        assertTrue(sql.getParameterMappings().get(4).getTypeHandler() instanceof com.hourglass.mapper.RoleTitlesTypeHandler);
        assertTrue(configuration.getMappedStatement("com.hourglass.mapper.WorkspaceMemberMapper.selectMember")
                .getBoundSql(Collections.emptyMap()).getSql().contains("job_title"));
    }

    private void allowTarget(String userId) {
        when(memberMapper.selectMember(WS, userId)).thenReturn(member(userId, "member", null));
        when(access.canView(WS, userId, P)).thenReturn(true);
    }

    private void copySetup() {
        Requirement source = new Requirement();
        source.setId("P2"); source.setWorkspaceId(WS); source.setName("源项目");
        when(projects.selectById("P2")).thenReturn(source);
        when(memberMapper.selectByWorkspace(WS)).thenReturn(Collections.singletonList(member(PLAIN, "member", null)));
        when(access.canView(WS, PLAIN, "P2")).thenReturn(true);
        when(access.canView(WS, PLAIN, P)).thenReturn(true);
    }

    private static ProjectMemberRole role(String userId, String primary, String... secondary) {
        ProjectMemberRole row = new ProjectMemberRole();
        row.setUserId(userId); row.setRoleTitle(primary); row.setSecondaryRoleTitles(Arrays.asList(secondary));
        return row;
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
