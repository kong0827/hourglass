package com.devstudio.kanban.config;

import com.devstudio.kanban.common.LoginUser;
import com.devstudio.kanban.service.SessionEpochService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class SessionEpochFilterTest {

    @AfterEach
    void clear() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void rejectsSessionWhoseEpochWasBumped() throws Exception {
        LoginUser user = new LoginUser("U1", "u1", "x", "用户一", "user");
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(user, null, user.getAuthorities()));
        SessionEpochService epochs = mock(SessionEpochService.class);
        when(epochs.current("U1")).thenReturn(5L);

        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/hourglass/api/auth/me");
        request.setContextPath("/hourglass");
        request.setRequestURI("/hourglass/api/auth/me");
        request.getSession(true).setAttribute(SessionEpochFilter.SESSION_KEY, 4L);
        MockHttpServletResponse response = new MockHttpServletResponse();

        new SessionEpochFilter(epochs).doFilter(request, response, new MockFilterChain());

        assertEquals(401, response.getStatus());
    }

    @Test
    void acceptsCurrentEpoch() throws Exception {
        LoginUser user = new LoginUser("U2", "u2", "x", "用户二", "user");
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(user, null, user.getAuthorities()));
        SessionEpochService epochs = mock(SessionEpochService.class);
        when(epochs.current("U2")).thenReturn(1L);

        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/hourglass/api/auth/me");
        request.setContextPath("/hourglass");
        request.setRequestURI("/hourglass/api/auth/me");
        request.getSession(true).setAttribute(SessionEpochFilter.SESSION_KEY, 1L);
        MockHttpServletResponse response = new MockHttpServletResponse();

        new SessionEpochFilter(epochs).doFilter(request, response, new MockFilterChain());

        assertEquals(200, response.getStatus());
    }
}
