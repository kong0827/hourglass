package com.hourglass.controller;

import com.hourglass.common.AppException;
import com.hourglass.common.GlobalExceptionHandler;
import com.hourglass.common.LoginUser;
import com.hourglass.dto.ListPreferenceRequest;
import com.hourglass.dto.ListPreferenceResponse;
import com.hourglass.entity.Workspace;
import com.hourglass.service.ListPreferenceService;
import com.hourglass.service.WorkspaceService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.Arrays;
import java.util.Collections;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.http.MediaType.APPLICATION_JSON;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class ListPreferenceControllerTest {

    private ListPreferenceService listPreferenceService;
    private WorkspaceService workspaceService;
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        listPreferenceService = mock(ListPreferenceService.class);
        workspaceService = mock(WorkspaceService.class);
        Workspace ws = new Workspace();
        ws.setId("W1");
        when(workspaceService.resolve(eq("U1"), any())).thenReturn(ws);

        mvc = MockMvcBuilders.standaloneSetup(new ListPreferenceController(listPreferenceService, workspaceService))
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
    void getResolvesWorkspaceAndReturnsEmptyPreference() throws Exception {
        when(listPreferenceService.get("U1", "W1", "task-list"))
                .thenReturn(new ListPreferenceResponse("task-list", null, Collections.<String>emptyList()));

        mvc.perform(get("/api/list-preferences/task-list").param("workspace", "W1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.viewKey").value("task-list"))
                .andExpect(jsonPath("$.data.viewMode").doesNotExist())
                .andExpect(jsonPath("$.data.columns").isEmpty());

        verify(workspaceService).resolve("U1", "W1");
        verify(listPreferenceService).get("U1", "W1", "task-list");
    }

    @Test
    void putResolvesWorkspaceAndPassesRequestToService() throws Exception {
        when(listPreferenceService.save(eq("U1"), eq("W1"), eq("project-list"), any(ListPreferenceRequest.class)))
                .thenReturn(new ListPreferenceResponse("project-list", "card",
                        Arrays.asList("name", "progress", "status")));

        mvc.perform(put("/api/list-preferences/project-list")
                        .param("workspace", "W1")
                        .contentType(APPLICATION_JSON)
                        .content("{\"viewMode\":\"card\",\"columns\":[\"name\",\"progress\",\"status\"]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.viewMode").value("card"))
                .andExpect(jsonPath("$.data.columns[1]").value("progress"));

        verify(workspaceService).resolve("U1", "W1");
        ArgumentCaptor<ListPreferenceRequest> captor = ArgumentCaptor.forClass(ListPreferenceRequest.class);
        verify(listPreferenceService).save(eq("U1"), eq("W1"), eq("project-list"), captor.capture());
        assertEquals("card", captor.getValue().getViewMode());
        assertEquals(Arrays.asList("name", "progress", "status"), captor.getValue().getColumns());
    }

    @Test
    void validationErrorsUseHttp400() throws Exception {
        when(listPreferenceService.get("U1", "W1", "unknown"))
                .thenThrow(AppException.badRequest("不支持的列表视图"));

        mvc.perform(get("/api/list-preferences/unknown").param("workspace", "W1"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(400));
    }
}
