package com.hourglass.config;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

import javax.servlet.http.Cookie;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class TokenAwareCsrfRequestMatcherTest {

    private final TokenAwareCsrfRequestMatcher matcher = new TokenAwareCsrfRequestMatcher();

    @Test
    void safeMethodsNeverRequireCsrf() {
        for (String method : new String[]{"GET", "HEAD", "OPTIONS", "TRACE"}) {
            assertFalse(matcher.matches(new MockHttpServletRequest(method, "/api/tasks")));
        }
    }

    @Test
    void sessionPostWithoutTokenStillRequiresCsrf() {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/tasks");
        assertTrue(matcher.matches(request));
    }

    @Test
    void pureBearerPostSkipsCsrf() {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/tasks");
        request.addHeader("Authorization", "Bearer hg_raw");
        assertFalse(matcher.matches(request));
    }

    @Test
    void bearerWithSessionCookieStillRequiresCsrf() {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/tasks");
        request.addHeader("Authorization", "Bearer hg_raw");
        request.setCookies(new Cookie("JSESSIONID", "s1"));
        assertTrue(matcher.matches(request));
    }

    @Test
    void bearerHeaderIsCaseInsensitive() {
        MockHttpServletRequest request = new MockHttpServletRequest("DELETE", "/api/tasks/1");
        request.addHeader("Authorization", "bearer hg_raw");
        assertFalse(matcher.matches(request));
    }
}