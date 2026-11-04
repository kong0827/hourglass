package com.devstudio.kanban.config;

import com.devstudio.kanban.service.SseService;
import com.devstudio.kanban.service.WorkspaceVersionService;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

class ChangeBroadcastFilterTest {

    @Test
    void stripsContextPathBeforeMatchingApiWrites() throws Exception {
        SseService sse = mock(SseService.class);
        WorkspaceVersionService versions = mock(WorkspaceVersionService.class);
        ChangeBroadcastFilter filter = new ChangeBroadcastFilter(sse, versions);

        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/hourglass/api/tasks/T1");
        request.setContextPath("/hourglass");
        request.setRequestURI("/hourglass/api/tasks/T1");
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(request, response, new MockFilterChain());

        verify(versions).bump(any());
        verify(sse).broadcast(eq("changed"), any(), eq("T1"), any(), any(), eq("task"), any());
    }
}
