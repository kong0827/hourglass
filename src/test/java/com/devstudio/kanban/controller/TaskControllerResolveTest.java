package com.devstudio.kanban.controller;

import com.devstudio.kanban.common.AppException;
import com.devstudio.kanban.common.GlobalExceptionHandler;
import com.devstudio.kanban.common.LoginUser;
import com.devstudio.kanban.config.BoardQueryArgumentResolver;
import com.devstudio.kanban.config.WorkspaceArgumentResolver;
import com.devstudio.kanban.dto.BoardQuery;
import com.devstudio.kanban.dto.TaskListResponse;
import com.devstudio.kanban.entity.Workspace;
import com.devstudio.kanban.service.TaskCommandService;
import com.devstudio.kanban.service.TaskQueryService;
import com.devstudio.kanban.service.TaskTrashService;
import com.devstudio.kanban.service.TaskWorkflowService;
import com.devstudio.kanban.service.WorkspaceService;
import com.devstudio.kanban.service.WorkspaceVersionService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * BE-ARCH-2 参数解析器回归：@CurrentWorkspace / @BoardFilter / @RequireRole。
 * 不启动 Spring 容器（无需数据库），只验证解析与权限分支。
 */
class TaskControllerResolveTest {

    private TaskQueryService taskService;
    private TaskTrashService trashService;
    private WorkspaceService workspaceService;
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        taskService = mock(TaskQueryService.class);
        trashService = mock(TaskTrashService.class);
        workspaceService = mock(WorkspaceService.class);
        WorkspaceVersionService versionService = mock(WorkspaceVersionService.class);
        when(versionService.version("W1")).thenReturn(1L);
        when(versionService.etag(any(), any(), any(), anyLong())).thenReturn("x");

        Workspace ws = new Workspace();
        ws.setId("W1");
        ws.setType("shared");
        ws.setOwnerId("U1");
        ws.setMyRole("owner");
        when(workspaceService.resolve(eq("U1"), any())).thenReturn(ws);

        mvc = MockMvcBuilders.standaloneSetup(new TaskController(taskService, mock(TaskCommandService.class), mock(TaskWorkflowService.class), trashService, versionService, mock(com.devstudio.kanban.service.TaskWatchService.class)))
                .setCustomArgumentResolvers(new WorkspaceArgumentResolver(workspaceService),
                        new BoardQueryArgumentResolver())
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
    void boardFilterParsesCsvAndPaging() throws Exception {
        when(taskService.list(eq("W1"), eq("U1"), any(BoardQuery.class), isNull(), eq(0), eq(0)))
                .thenReturn(new TaskListResponse());

        mvc.perform(get("/api/tasks/list")
                        .param("owners", "我,小明")
                        .param("pris", "P0,P1")
                        .param("doneLimit", "30")
                        .param("focus", "true"))
                .andExpect(status().isOk());

        verify(taskService).list(eq("W1"), eq("U1"), argThat(q ->
                q.getOwners().size() == 2
                        && q.getOwners().contains("小明")
                        && q.getPris().size() == 2
                        && q.isFocus()
                        && q.getDoneLimit() == 30), isNull(), eq(0), eq(0));
    }

    @Test
    void requireRoleRejectsMember() throws Exception {
        Workspace member = new Workspace();
        member.setId("W1");
        member.setMyRole("member");
        when(workspaceService.resolve(eq("U1"), any())).thenReturn(member);

        mvc.perform(delete("/api/tasks/K1/purge"))
                .andExpect(status().isForbidden());
    }

    @Test
    void requireRoleAllowsOwner() throws Exception {
        mvc.perform(delete("/api/tasks/K1/purge")).andExpect(status().isOk());
        verify(trashService).purge("W1", "K1");
    }
}
