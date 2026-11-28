package com.hourglass.config;

import com.hourglass.dto.ApiTokenAuth;
import com.hourglass.entity.ApiToken;
import com.hourglass.entity.AppUser;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import java.util.concurrent.atomic.AtomicBoolean;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ApiTokenRateLimitFilterTest {

    private static ApiTokenAuth auth(String tokenId) {
        ApiToken token = new ApiToken();
        token.setId(tokenId);
        token.setScope("read");
        AppUser user = new AppUser();
        user.setId("U1");
        user.setUsername("u1");
        return new ApiTokenAuth(token, user);
    }

    @Test
    void passesThroughWithoutAuthenticatedToken() throws Exception {
        ApiTokenRateLimitFilter filter = new ApiTokenRateLimitFilter(new ApiTokenRateLimiter(1, 1));
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/hourglass/api/tasks/list");
        MockHttpServletResponse response = new MockHttpServletResponse();
        AtomicBoolean called = new AtomicBoolean(false);

        filter.doFilter(request, response, (req, res) -> called.set(true));

        assertTrue(called.get());
        assertEquals(200, response.getStatus());
    }

    @Test
    void returns429WithRetryAfterWhenLimitExceeded() throws Exception {
        ApiTokenRateLimitFilter filter = new ApiTokenRateLimitFilter(new ApiTokenRateLimiter(1, 1));
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/hourglass/api/tasks/list");
        request.setAttribute(ApiTokenAuthFilter.ATTR_AUTH, auth("T1"));
        MockHttpServletResponse first = new MockHttpServletResponse();
        AtomicBoolean firstCalled = new AtomicBoolean(false);
        filter.doFilter(request, first, (req, res) -> firstCalled.set(true));

        MockHttpServletResponse second = new MockHttpServletResponse();
        AtomicBoolean secondCalled = new AtomicBoolean(false);
        filter.doFilter(request, second, (req, res) -> secondCalled.set(true));

        assertTrue(firstCalled.get());
        assertFalse(secondCalled.get());
        assertEquals(429, second.getStatus());
        assertEquals("60", second.getHeader("Retry-After"));
    }
}