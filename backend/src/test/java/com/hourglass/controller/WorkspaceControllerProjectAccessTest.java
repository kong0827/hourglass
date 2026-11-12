package com.hourglass.controller;

import com.hourglass.common.GlobalExceptionHandler;
import com.hourglass.common.LoginUser;
import com.hourglass.entity.Requirement;
import com.hourglass.entity.Workspace;
import com.hourglass.entity.WorkspaceMember;
import com.hourglass.mapper.RequirementMapper;
import com.hourglass.mapper.UserMapper;
import com.hourglass.dto.ProjectMemberRoleOverview;
import com.hourglass.dto.ProjectMemberRoleView;
import com.hourglass.service.ActivityService;
import com.hourglass.service.AuditService;
import com.hourglass.service.NotificationEventService;
import com.hourglass.service.ProjectAccessService;
import com.hourglass.service.ProjectMemberRoleService;
import com.hourglass.service.WorkspaceService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.Collections;

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.http.MediaType.APPLICATION_JSON;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class WorkspaceControllerProjectAccessTest {

    private static final String WS = "W1";

    private WorkspaceService workspaceService;
    private ProjectAccessService projectAccessService;
    private RequirementMapper requirementMapper;
    private ProjectMemberRoleService projectMemberRoleService;
    private ActivityService activityService;
    private AuditService auditService;
    private NotificationEventService notificationEvents;
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        workspaceService = mock(WorkspaceService.class);
        projectAccessService = mock(ProjectAccessService.class);
        projectMemberRoleService = mock(ProjectMemberRoleService.class);
        requirementMapper = mock(RequirementMapper.class);
        activityService = mock(ActivityService.class);
        auditService = mock(AuditService.class);
        notificationEvents = mock(NotificationEventService.class);
        mvc = MockMvcBuilders.standaloneSetup(new WorkspaceController(workspaceService, mock(UserMapper.class),
                        projectAccessService, projectMemberRoleService,
                        requirementMapper, activityService, notificationEvents, auditService))
                .setControllerAdvice(new GlobalExceptionHandler())
                .build();
        LoginUser user = new LoginUser("U1", "u1", "x", "我", "user");
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(user, null, user.getAuthorities()));
    }

    @AfterEach
    void tearDown() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void viewerTargetCannotBeConfigured() throws Exception {
        workspace("shared");
        when(workspaceService.members("U1", WS)).thenReturn(Collections.singletonList(member("U2", "viewer")));

        mvc.perform(put("/api/workspaces/" + WS + "/project-access")
                        .contentType(APPLICATION_JSON)
                        .content("{\"userId\":\"U2\",\"projectId\":\"P1\",\"access\":\"none\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(400));

        verify(projectAccessService, never()).saveGrant(anyString(), anyString(), anyString(), anyString());
    }

    @Test
    void personalSpaceRejectsProjectAccessMatrix() throws Exception {
        workspace("personal");

        mvc.perform(get("/api/workspaces/" + WS + "/project-access"))
                .andExpect(status().isBadRequest());

        verifyNoInteractions(requirementMapper);
    }

    @Test
    void auditLogUsesNormalizedAccess() throws Exception {
        workspace("shared");
        when(workspaceService.members("U1", WS)).thenReturn(Collections.singletonList(member("U2", "member")));
        Requirement project = new Requirement();
        project.setId("P1");
        project.setWorkspaceId(WS);
        project.setName("项目A");
        when(requirementMapper.selectById("P1")).thenReturn(project);
        when(projectAccessService.effectiveAccess(org.mockito.ArgumentMatchers.eq(WS),
                org.mockito.ArgumentMatchers.eq("P1"),
                org.mockito.ArgumentMatchers.any(WorkspaceMember.class)))
                .thenReturn("write");
        when(projectAccessService.saveGrant(WS, "U2", "P1", "pm")).thenReturn("");

        mvc.perform(put("/api/workspaces/" + WS + "/project-access")
                        .contentType(APPLICATION_JSON)
                        .content("{\"userId\":\"U2\",\"projectId\":\"P1\",\"access\":\"pm\"}"))
                .andExpect(status().isOk());

        verify(projectAccessService).saveGrant(WS, "U2", "P1", "pm");
        /* 历史 pm 归一化为空（存量成员默认参与）：日志写有效权限「可参与」，不再出现 default 码值 */
        verify(activityService).logConfig(WS, "U1", "调整成员「U2」对项目「项目A」的可见范围 → 可参与");
        verifyNoInteractions(notificationEvents);
    }

    @Test
    void projectAccessChangeNotifiesTarget() throws Exception {
        workspace("shared");
        when(workspaceService.members("U1", WS)).thenReturn(Collections.singletonList(member("U2", "member")));
        Requirement project = new Requirement();
        project.setId("P1");
        project.setWorkspaceId(WS);
        project.setName("项目A");
        when(requirementMapper.selectById("P1")).thenReturn(project);
        when(projectAccessService.effectiveAccess(org.mockito.ArgumentMatchers.eq(WS),
                org.mockito.ArgumentMatchers.eq("P1"),
                org.mockito.ArgumentMatchers.any(WorkspaceMember.class)))
                .thenReturn("write");
        when(projectAccessService.saveGrant(WS, "U2", "P1", "none")).thenReturn("none");

        mvc.perform(put("/api/workspaces/" + WS + "/project-access")
                        .contentType(APPLICATION_JSON)
                        .content("{\"userId\":\"U2\",\"projectId\":\"P1\",\"access\":\"none\"}"))
                .andExpect(status().isOk());

        verify(notificationEvents).notifySystem("U2", WS, NotificationEventService.PROJECT_ACCESS,
                "项目可见范围已调整：「项目A」",
                "你在空间「W1」中对该项目的可见范围已调整为「不可见」", null, "project", "P1");
    }

    @Test
    void unchangedProjectAccessDoesNotNotifyTarget() throws Exception {
        workspace("shared");
        when(workspaceService.members("U1", WS)).thenReturn(Collections.singletonList(member("U2", "member")));
        Requirement project = new Requirement();
        project.setId("P1");
        project.setWorkspaceId(WS);
        project.setName("项目A");
        when(requirementMapper.selectById("P1")).thenReturn(project);
        when(projectAccessService.effectiveAccess(org.mockito.ArgumentMatchers.eq(WS),
                org.mockito.ArgumentMatchers.eq("P1"),
                org.mockito.ArgumentMatchers.any(WorkspaceMember.class)))
                .thenReturn("read");
        when(projectAccessService.saveGrant(WS, "U2", "P1", "read")).thenReturn("read");

        mvc.perform(put("/api/workspaces/" + WS + "/project-access")
                        .contentType(APPLICATION_JSON)
                        .content("{\"userId\":\"U2\",\"projectId\":\"P1\",\"access\":\"read\"}"))
                .andExpect(status().isOk());

        verifyNoInteractions(notificationEvents);
    }

    @Test
    void removingMemberNotifiesRemovedUser() throws Exception {
        workspace("shared");

        mvc.perform(delete("/api/workspaces/" + WS + "/members/U2"))
                .andExpect(status().isOk());

        verify(notificationEvents).notifySystem("U2", WS, NotificationEventService.MEMBER_REMOVED,
                "你已被移出空间「W1」",
                "你在该空间的成员身份与项目可见范围已被移除；如有疑问请联系空间主", null);
    }

    @Test
    void batchMemberGrantsAuditsAndNotifiesOnce() throws Exception {
        workspace("shared");
        when(workspaceService.members("U1", WS)).thenReturn(Collections.singletonList(member("U2", "member")));
        Requirement p1 = new Requirement();
        p1.setId("P1");
        p1.setWorkspaceId(WS);
        p1.setName("项目A");
        Requirement p2 = new Requirement();
        p2.setId("P2");
        p2.setWorkspaceId(WS);
        p2.setName("项目B");
        when(requirementMapper.selectById("P1")).thenReturn(p1);
        when(requirementMapper.selectById("P2")).thenReturn(p2);
        java.util.Map<String, String> changed = new java.util.LinkedHashMap<String, String>();
        changed.put("P2", "write");
        java.util.Map<String, String> wanted = new java.util.LinkedHashMap<String, String>();
        wanted.put("P1", "read");
        wanted.put("P2", "write");
        when(projectAccessService.saveMemberGrants(org.mockito.ArgumentMatchers.eq(WS),
                org.mockito.ArgumentMatchers.any(WorkspaceMember.class),
                org.mockito.ArgumentMatchers.eq(wanted)))
                .thenReturn(changed);

        mvc.perform(put("/api/workspaces/" + WS + "/members/U2/project-access")
                        .contentType(APPLICATION_JSON)
                        .content("{\"grants\":[{\"projectId\":\"P1\",\"access\":\"read\"},"
                                + "{\"projectId\":\"P2\",\"access\":\"write\"}]}"))
                .andExpect(status().isOk());

        verify(activityService, org.mockito.Mockito.times(1))
                .logConfig(WS, "U1", "调整成员「U2」的项目权限：项目B→可参与");
        verify(notificationEvents, org.mockito.Mockito.times(1)).notifySystem(
                "U2", WS, NotificationEventService.PROJECT_ACCESS,
                "项目可见范围已调整（1 个项目）",
                "你在空间「W1」中的项目权限已调整：项目B→可参与",
                null, "member", "U2");
    }

    @Test
    void batchMemberGrantsRejectsUnknownAccess() throws Exception {
        workspace("shared");
        when(workspaceService.members("U1", WS)).thenReturn(Collections.singletonList(member("U2", "member")));

        mvc.perform(put("/api/workspaces/" + WS + "/members/U2/project-access")
                        .contentType(APPLICATION_JSON)
                        .content("{\"grants\":[{\"projectId\":\"P1\",\"access\":\"superuser\"}]}"))
                .andExpect(status().isBadRequest());

        verify(projectAccessService, never()).saveGrant(anyString(), anyString(), anyString(), anyString());
        verify(projectAccessService, never()).saveMemberGrants(anyString(),
                org.mockito.ArgumentMatchers.any(WorkspaceMember.class), org.mockito.ArgumentMatchers.anyMap());
    }

    @Test
    void batchMemberGrantsWithoutChangesSkipsAuditAndNotice() throws Exception {
        workspace("shared");
        when(workspaceService.members("U1", WS)).thenReturn(Collections.singletonList(member("U2", "member")));
        Requirement p1 = new Requirement();
        p1.setId("P1");
        p1.setWorkspaceId(WS);
        p1.setName("项目A");
        when(requirementMapper.selectById("P1")).thenReturn(p1);
        when(projectAccessService.saveMemberGrants(org.mockito.ArgumentMatchers.eq(WS),
                org.mockito.ArgumentMatchers.any(WorkspaceMember.class), org.mockito.ArgumentMatchers.anyMap()))
                .thenReturn(new java.util.LinkedHashMap<String, String>());

        mvc.perform(put("/api/workspaces/" + WS + "/members/U2/project-access")
                        .contentType(APPLICATION_JSON)
                        .content("{\"grants\":[{\"projectId\":\"P1\",\"access\":\"write\"}]}"))
                .andExpect(status().isOk());

        verifyNoInteractions(activityService);
        verifyNoInteractions(notificationEvents);
    }

    @Test
    void projectRosterRequiresViewAndReturnsCompanyAndRole() throws Exception {
        workspace("shared");
        Requirement p1 = new Requirement();
        p1.setId("P1");
        p1.setWorkspaceId(WS);
        p1.setName("项目A");
        when(requirementMapper.selectById("P1")).thenReturn(p1);
        ProjectMemberRoleOverview overview = new ProjectMemberRoleOverview();
        ProjectMemberRoleView row = new ProjectMemberRoleView();
        row.setUserId("U2");
        row.setCompanyName("外部公司");
        row.setRoleTitle("前端");
        row.setAccess("write");
        overview.setMembers(Collections.singletonList(row));
        overview.setCanEditRole(true);
        when(projectMemberRoleService.roster(WS, p1, "U1")).thenReturn(overview);

        mvc.perform(get("/api/workspaces/" + WS + "/projects/P1/members"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.members[0].companyName").value("外部公司"))
                .andExpect(jsonPath("$.data.members[0].roleTitle").value("前端"))
                .andExpect(jsonPath("$.data.canEditRole").value(true));

        verify(projectAccessService).assertView(WS, "U1", "P1");
    }

    @Test
    void projectRosterRejectsProjectFromAnotherWorkspace() throws Exception {
        workspace("shared");
        Requirement other = new Requirement();
        other.setId("P1");
        other.setWorkspaceId("W2");
        when(requirementMapper.selectById("P1")).thenReturn(other);

        mvc.perform(get("/api/workspaces/" + WS + "/projects/P1/members"))
                .andExpect(status().isNotFound());

        verify(projectAccessService, never()).assertView(anyString(), anyString(), anyString());
    }

    @Test
    void saveProjectRoleDelegatesTransactionalLogging() throws Exception {
        workspace("shared");
        Requirement p1 = new Requirement();
        p1.setId("P1");
        p1.setWorkspaceId(WS);
        p1.setName("项目A");
        when(requirementMapper.selectById("P1")).thenReturn(p1);
        when(workspaceService.members("U1", WS)).thenReturn(Collections.singletonList(member("U2", "member")));
        when(projectMemberRoleService.saveRole(WS, p1, "U2", "前端", null, "U1")).thenReturn("前端");

        mvc.perform(put("/api/workspaces/" + WS + "/projects/P1/member-roles/U2")
                        .contentType(APPLICATION_JSON)
                        .content("{\"roleTitle\":\"前端\"}"))
                .andExpect(status().isOk());

        verify(projectMemberRoleService).saveRole(WS, p1, "U2", "前端", null, "U1");
        // 角色服务在业务事务内强一致留痕，控制器不再额外调用吞异常日志入口。
        verifyNoInteractions(activityService, auditService);
    }

    @Test
    void updateMemberCompanyDelegatesAndAudits() throws Exception {
        workspace("shared");
        when(workspaceService.members("U1", WS)).thenReturn(Collections.singletonList(member("U2", "member")));
        when(workspaceService.updateMemberCompany("U1", WS, "U2", "外部公司")).thenReturn("外部公司");

        mvc.perform(put("/api/workspaces/" + WS + "/members/U2/company")
                        .contentType(APPLICATION_JSON)
                        .content("{\"companyName\":\"外部公司\"}"))
                .andExpect(status().isOk());

        verify(workspaceService).updateMemberCompany("U1", WS, "U2", "外部公司");
        verify(auditService).recordCurrent(org.mockito.ArgumentMatchers.eq(WS),
                org.mockito.ArgumentMatchers.eq("member_company"),
                org.mockito.ArgumentMatchers.eq("member"),
                org.mockito.ArgumentMatchers.eq("U2"),
                org.mockito.ArgumentMatchers.eq("U2"),
                org.mockito.ArgumentMatchers.eq(true),
                org.mockito.ArgumentMatchers.contains("外部公司"),
                org.mockito.ArgumentMatchers.any(javax.servlet.http.HttpServletRequest.class));
    }

    @Test
    void jobTitleAndDictionaryRoutesDelegateExactContract() throws Exception {
        mvc.perform(put("/api/workspaces/" + WS + "/members/U2/job-title")
                .contentType(APPLICATION_JSON).content("{\"jobTitle\":\"全栈工程师\"}"))
                .andExpect(status().isOk());
        verify(workspaceService).updateMemberJobTitle("U1", WS, "U2", "全栈工程师");
        com.hourglass.dto.MemberLabelOptions options = new com.hourglass.dto.MemberLabelOptions();
        options.setRoleTitles(Collections.singletonList("产品经理"));
        options.setCompanyNames(Collections.singletonList("公司"));
        when(workspaceService.memberLabelOptions("U1", WS)).thenReturn(options);
        mvc.perform(get("/api/workspaces/" + WS + "/member-label-options"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.roleTitles[0]").value("产品经理"));
        mvc.perform(put("/api/workspaces/" + WS + "/member-label-options")
                .contentType(APPLICATION_JSON).content("{\"roleTitles\":[\"产品经理\"],\"companyNames\":[\"公司\"]}"))
                .andExpect(status().isOk());
        verify(workspaceService).updateMemberLabelOptions("U1", WS, options);
    }

    @Test
    void batchAndCopyRoutesReturnCountsAndDefaultOverwriteFalse() throws Exception {
        Requirement project = new Requirement(); project.setId("P1"); project.setWorkspaceId(WS);
        when(requirementMapper.selectById("P1")).thenReturn(project);
        when(projectMemberRoleService.saveRoles(WS, project, Collections.singletonList("U2"), "开发",
                Collections.emptyList(), "U1")).thenReturn(Collections.singletonMap("updated", 1));
        mvc.perform(put("/api/workspaces/" + WS + "/projects/P1/member-roles")
                .contentType(APPLICATION_JSON).content("{\"userIds\":[\"U2\"],\"roleTitle\":\"开发\",\"secondaryRoleTitles\":[]}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.updated").value(1));
        java.util.Map<String, Integer> result = new java.util.LinkedHashMap<String, Integer>();
        result.put("copied", 1); result.put("skipped", 2);
        when(projectMemberRoleService.copyRoles(WS, project, "P2", false, "U1")).thenReturn(result);
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post(
                "/api/workspaces/" + WS + "/projects/P1/member-roles/copy")
                .contentType(APPLICATION_JSON).content("{\"sourceProjectId\":\"P2\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.copied").value(1))
                .andExpect(jsonPath("$.data.skipped").value(2));
        verify(projectMemberRoleService).copyRoles(WS, project, "P2", false, "U1");
    }

    @Test
    void singleRoleRoutePreservesOmittedSecondaryAndForwardsExplicitEmpty() throws Exception {
        Requirement project = new Requirement(); project.setId("P1"); project.setWorkspaceId(WS);
        when(requirementMapper.selectById("P1")).thenReturn(project);
        mvc.perform(put("/api/workspaces/" + WS + "/projects/P1/member-roles/U2")
                .contentType(APPLICATION_JSON).content("{\"roleTitle\":\"开发\"}"))
                .andExpect(status().isOk());
        verify(projectMemberRoleService).saveRole(WS, project, "U2", "开发", null, "U1");
        mvc.perform(put("/api/workspaces/" + WS + "/projects/P1/member-roles/U2")
                .contentType(APPLICATION_JSON).content("{\"roleTitle\":\"\",\"secondaryRoleTitles\":[]}"))
                .andExpect(status().isOk());
        verify(projectMemberRoleService).saveRole(WS, project, "U2", "", Collections.emptyList(), "U1");
    }

    private void workspace(String type) {
        Workspace ws = new Workspace();
        ws.setId(WS);
        ws.setName("W1");
        ws.setType(type);
        ws.setMyRole("owner");
        when(workspaceService.requireMember("U1", WS)).thenReturn(ws);
    }

    private WorkspaceMember member(String userId, String role) {
        WorkspaceMember m = new WorkspaceMember();
        m.setWorkspaceId(WS);
        m.setUserId(userId);
        m.setDisplayName(userId);
        m.setRole(role);
        return m;
    }
}
