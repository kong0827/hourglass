package com.hourglass.controller;

import com.hourglass.common.AppException;
import com.hourglass.common.GlobalExceptionHandler;
import com.hourglass.common.LoginUser;
import com.hourglass.config.WorkspaceArgumentResolver;
import com.hourglass.config.WorkspaceCtx;
import com.hourglass.entity.Workspace;
import com.hourglass.service.ManagerService;
import com.hourglass.service.WorkspaceService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class ManagerControllerTest {

    private ManagerService service;
    private ManagerController controller;
    private MockMvc mvc;
    private Workspace workspace;

    @BeforeEach
    void setUp() {
        service = mock(ManagerService.class);
        controller = new ManagerController(service);
        WorkspaceService workspaces = mock(WorkspaceService.class);
        workspace = new Workspace();
        workspace.setId("W1");
        workspace.setMyRole("viewer");
        when(workspaces.resolve(eq("U1"), any())).thenReturn(workspace);
        mvc = MockMvcBuilders.standaloneSetup(controller)
                .setCustomArgumentResolvers(new WorkspaceArgumentResolver(workspaces))
                .setControllerAdvice(new GlobalExceptionHandler())
                .build();
        LoginUser user = new LoginUser("U1", "u1", "x", "Alice", "user");
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(user, null, user.getAuthorities()));
    }

    @AfterEach
    void tearDown() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void reportsBindsOptionalDisplayFiltersAndReturnsMetadata() throws Exception {
        when(service.reports("W1", "R1", "U1", "测试", "A"))
                .thenReturn(metadata("R1", "测试", "A"));
        mvc.perform(get("/api/manager/reports").param("reqId", "R1")
                        .param("roleTitle", "测试").param("companyName", "A"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.scope.reqId").value("R1"))
                .andExpect(jsonPath("$.data.scope.roleTitle").value("测试"))
                .andExpect(jsonPath("$.data.scope.companyName").value("A"))
                .andExpect(jsonPath("$.data.filterOptions.roleTitles[0]").value("测试"))
                .andExpect(jsonPath("$.data.filterOptions.companyNames[1]").value("B"));
        verify(service).reports("W1", "R1", "U1", "测试", "A");
    }

    @Test
    void workloadBindsProjectAndUnsetFilters() throws Exception {
        when(service.workload("W1", "U1", "R1", "__unset__", "__unset__"))
                .thenReturn(metadata("R1", "__unset__", "__unset__"));
        mvc.perform(get("/api/manager/workload").param("reqId", "R1")
                        .param("roleTitle", "__unset__").param("companyName", "__unset__"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.scope.roleTitle").value("__unset__"))
                .andExpect(jsonPath("$.data.scope.companyName").value("__unset__"));
        verify(service).workload("W1", "U1", "R1", "__unset__", "__unset__");
    }

    @Test
    void missingFiltersAndOriginalJavaSignaturesRemainCompatible() throws Exception {
        when(service.reports("W1", null, "U1", null, null)).thenReturn(metadata(null, null, null));
        when(service.workload("W1", "U1", null, null, null)).thenReturn(metadata(null, null, null));
        mvc.perform(get("/api/manager/reports")).andExpect(status().isOk());
        mvc.perform(get("/api/manager/workload")).andExpect(status().isOk());
        verify(service).reports("W1", null, "U1", null, null);
        verify(service).workload("W1", "U1", null, null, null);
        WorkspaceCtx context = new WorkspaceCtx("U1", workspace);
        controller.reports(null, context);
        controller.workload(context);
        verify(service).reports("W1", null, "U1");
        verify(service).workload("W1", "U1");
    }

    @Test
    void serviceValidationErrorsRemainHttp400() throws Exception {
        String longRole = String.join("", Collections.nCopies(33, "职"));
        String longCompany = String.join("", Collections.nCopies(65, "司"));
        when(service.reports("W1", null, "U1", longRole, null))
                .thenThrow(AppException.badRequest("roleTitle 最多 32 个字符"));
        when(service.workload("W1", "U1", null, null, longCompany))
                .thenThrow(AppException.badRequest("companyName 最多 64 个字符"));
        mvc.perform(get("/api/manager/reports").param("roleTitle", longRole))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value(400));
        mvc.perform(get("/api/manager/workload").param("companyName", longCompany))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value(400));
    }

    private Map<String, Object> metadata(String reqId, String roleTitle, String companyName) {
        Map<String, Object> options = new LinkedHashMap<String, Object>();
        options.put("roleTitles", Arrays.asList("测试", "开发"));
        options.put("companyNames", Arrays.asList("A", "B"));
        Map<String, Object> scope = new LinkedHashMap<String, Object>();
        scope.put("reqId", reqId);
        scope.put("roleTitle", roleTitle);
        scope.put("companyName", companyName);
        Map<String, Object> result = new LinkedHashMap<String, Object>();
        result.put("filterOptions", options);
        result.put("scope", scope);
        return result;
    }
}
