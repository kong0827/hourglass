package com.hourglass.controller;

import com.hourglass.common.GlobalExceptionHandler;
import com.hourglass.common.LoginUser;
import com.hourglass.dto.PageResult;
import com.hourglass.dto.ReqDocActivityView;
import com.hourglass.entity.RequirementDoc;
import com.hourglass.entity.Workspace;
import com.hourglass.service.RequirementDocService;
import com.hourglass.service.WorkspaceService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.Collections;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** /api/req-docs/activities 不能被 /api/req-docs/{id} 抢先匹配成文档 ID */
class RequirementDocControllerRoutingTest {

    private RequirementDocService docService;
    private WorkspaceService workspaceService;
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        docService = mock(RequirementDocService.class);
        workspaceService = mock(WorkspaceService.class);
        Workspace ws = new Workspace();
        ws.setId("W1");
        when(workspaceService.resolve(eq("U1"), any())).thenReturn(ws);

        mvc = MockMvcBuilders.standaloneSetup(new RequirementDocController(docService, workspaceService))
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
    void feedActivitiesHitsSpaceLevelRouteInsteadOfDocDetail() throws Exception {
        ReqDocActivityView item = new ReqDocActivityView();
        item.setId(1L);
        item.setDocId("D1");
        item.setDocTitle("登录需求");
        when(docService.feedActivities("W1", "U1", 0, 100)).thenReturn(
                PageResult.of(Collections.singletonList(item), 1, 0, 100));

        mvc.perform(get("/api/req-docs/activities").param("workspace", "W1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.total").value(1))
                .andExpect(jsonPath("$.data.items[0].docId").value("D1"))
                .andExpect(jsonPath("$.data.items[0].docTitle").value("登录需求"));

        verify(docService).feedActivities("W1", "U1", 0, 100);
        verify(docService, never()).getVisible(any(), any(), any());
    }

    @Test
    void docDetailRouteStillResolvesById() throws Exception {
        RequirementDoc doc = new RequirementDoc();
        doc.setId("D1");
        doc.setTitle("登录需求");
        when(docService.getVisible("W1", "U1", "D1")).thenReturn(doc);

        mvc.perform(get("/api/req-docs/D1").param("workspace", "W1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.id").value("D1"))
                .andExpect(jsonPath("$.data.title").value("登录需求"));

        verify(docService).getVisible("W1", "U1", "D1");
        verify(docService, never()).feedActivities(any(), any(), anyInt(), anyInt());
    }
}
