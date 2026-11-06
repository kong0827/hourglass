package com.devstudio.kanban.controller;

import com.devstudio.kanban.common.GlobalExceptionHandler;
import com.devstudio.kanban.common.LoginUser;
import com.devstudio.kanban.entity.Requirement;
import com.devstudio.kanban.entity.Workspace;
import com.devstudio.kanban.entity.WorkspaceMember;
import com.devstudio.kanban.mapper.RequirementMapper;
import com.devstudio.kanban.mapper.UserMapper;
import com.devstudio.kanban.service.ActivityService;
import com.devstudio.kanban.service.NotificationEventService;
import com.devstudio.kanban.service.ProjectAccessService;
import com.devstudio.kanban.service.WorkspaceService;
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
    private ActivityService activityService;
    private NotificationEventService notificationEvents;
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        workspaceService = mock(WorkspaceService.class);
        projectAccessService = mock(ProjectAccessService.class);
        requirementMapper = mock(RequirementMapper.class);
        activityService = mock(ActivityService.class);
        notificationEvents = mock(NotificationEventService.class);
        mvc = MockMvcBuilders.standaloneSetup(new WorkspaceController(workspaceService, mock(UserMapper.class),
                        projectAccessService, requirementMapper, activityService, notificationEvents))
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

        mvc.perform(put("/api/workspaces/" + WS + "/project-access")
                        .contentType(APPLICATION_JSON)
                        .content("{\"userId\":\"U2\",\"projectId\":\"P1\",\"access\":\"pm\"}"))
                .andExpect(status().isOk());

        verify(projectAccessService).saveGrant(WS, "U2", "P1", "pm");
        verify(activityService).logConfig(WS, "U1", "调整项目可见范围「项目A」→ default");
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

        mvc.perform(put("/api/workspaces/" + WS + "/project-access")
                        .contentType(APPLICATION_JSON)
                        .content("{\"userId\":\"U2\",\"projectId\":\"P1\",\"access\":\"none\"}"))
                .andExpect(status().isOk());

        verify(notificationEvents).notifySystem("U2", WS, NotificationEventService.PROJECT_ACCESS,
                "项目可见范围已调整：「项目A」",
                "你在空间「W1」中对该项目的可见范围已调整为「不可见」", null);
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
        when(projectAccessService.configuredAccess(WS, "P1", "U2")).thenReturn("read");

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
