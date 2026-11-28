package com.hourglass.config;

import com.hourglass.dto.ApiTokenAuth;
import com.hourglass.entity.ApiToken;
import com.hourglass.entity.AppUser;
import com.hourglass.service.ApiTokenService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;

import javax.servlet.FilterChain;
import java.util.concurrent.atomic.AtomicBoolean;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class ApiTokenAuthFilterTest {

    private ApiTokenService tokenService;
    private ApiTokenAuthFilter filter;
    private AppUser user;
    private ApiToken token;

    @BeforeEach
    void setUp() {
        tokenService = mock(ApiTokenService.class);
        filter = new ApiTokenAuthFilter(tokenService);

        user = new AppUser();
        user.setId("U1");
        user.setUsername("xiaoming");
        user.setDisplayName("小明");
        user.setRole("user");

        token = new ApiToken();
        token.setId("T1");
        token.setUserId("U1");
        token.setScope("read");
    }

    @AfterEach
    void clear() {
        SecurityContextHolder.clearContext();
    }

    private MockHttpServletRequest request(String method, String uri) {
        MockHttpServletRequest request = new MockHttpServletRequest(method, uri);
        request.setContextPath("/hourglass");
        request.setRequestURI("/hourglass" + uri);
        return request;
    }

    private FilterChain chain(AtomicBoolean called) {
        return (req, res) -> called.set(true);
    }

    @Test
    void passesThroughWithoutBearerHeader() throws Exception {
        AtomicBoolean called = new AtomicBoolean(false);
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(request("GET", "/api/tasks"), response, chain(called));

        assertTrue(called.get());
        assertEquals(200, response.getStatus());
    }

    @Test
    void rejectsEmptyAndInvalidToken() throws Exception {
        AtomicBoolean called = new AtomicBoolean(false);

        MockHttpServletRequest empty = request("GET", "/api/tasks");
        empty.addHeader("Authorization", "Bearer ");
        MockHttpServletResponse r1 = new MockHttpServletResponse();
        filter.doFilter(empty, r1, chain(called));
        assertEquals(401, r1.getStatus());

        MockHttpServletRequest invalid = request("GET", "/api/tasks");
        invalid.addHeader("Authorization", "Bearer hg_bad");
        MockHttpServletResponse r2 = new MockHttpServletResponse();
        filter.doFilter(invalid, r2, chain(called));
        assertEquals(401, r2.getStatus());
        assertTrue(r2.getContentAsString().contains("令牌无效"));
        assertEquals(false, called.get());
    }

    @Test
    void readTokenCannotWrite() throws Exception {
        when(tokenService.authenticate("hg_raw")).thenReturn(new ApiTokenAuth(token, user));
        MockHttpServletRequest request = request("POST", "/api/tasks");
        request.addHeader("Authorization", "Bearer hg_raw");
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(request, response, chain(new AtomicBoolean(false)));

        assertEquals(403, response.getStatus());
        assertTrue(response.getContentAsString().contains("只读令牌"));
        assertEquals(null, SecurityContextHolder.getContext().getAuthentication());
    }

    @Test
    void tokenCannotReachAdminTokenOrPasswordEndpoints() throws Exception {
        when(tokenService.authenticate("hg_raw")).thenReturn(new ApiTokenAuth(token, user));
        String[] paths = {"/api/admin/users", "/api/auth/tokens", "/api/auth/tokens/T1", "/api/auth/password"};
        for (String path : paths) {
            MockHttpServletRequest request = request("GET", path);
            request.addHeader("Authorization", "Bearer hg_raw");
            MockHttpServletResponse response = new MockHttpServletResponse();
            filter.doFilter(request, response, chain(new AtomicBoolean(false)));
            assertEquals(403, response.getStatus(), path);
        }
    }

    @Test
    void validTokenAuthenticatesWithApiTokenAuthority() throws Exception {
        when(tokenService.authenticate("hg_raw")).thenReturn(new ApiTokenAuth(token, user));
        MockHttpServletRequest request = request("GET", "/api/tasks");
        request.addHeader("Authorization", "Bearer hg_raw");
        MockHttpServletResponse response = new MockHttpServletResponse();
        AtomicBoolean called = new AtomicBoolean(false);

        filter.doFilter(request, response, chain(called));

        assertTrue(called.get());
        assertNotNull(request.getAttribute(ApiTokenAuthFilter.ATTR_AUTH));
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        assertNotNull(auth);
        assertEquals("xiaoming", auth.getName());
        boolean hasTokenAuthority = false;
        for (GrantedAuthority authority : auth.getAuthorities()) {
            if (ApiTokenAuthFilter.AUTHORITY.equals(authority.getAuthority())) {
                hasTokenAuthority = true;
            }
        }
        assertTrue(hasTokenAuthority);
    }

    @Test
    void writeTokenMayPost() throws Exception {
        token.setScope("write");
        when(tokenService.authenticate("hg_raw")).thenReturn(new ApiTokenAuth(token, user));
        MockHttpServletRequest request = request("POST", "/api/tasks");
        request.addHeader("Authorization", "Bearer hg_raw");
        MockHttpServletResponse response = new MockHttpServletResponse();
        AtomicBoolean called = new AtomicBoolean(false);

        filter.doFilter(request, response, chain(called));

        assertTrue(called.get());
        assertEquals(200, response.getStatus());
    }
}