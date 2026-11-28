package com.hourglass.config;

import com.hourglass.common.LoginUser;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextImpl;
import org.springframework.security.web.context.HttpRequestResponseHolder;

import javax.servlet.http.HttpServletResponse;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotSame;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

class BearerAwareSecurityContextRepositoryTest {

    @Test
    void tokenRequestDoesNotCreateSession() {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/tasks");
        request.addHeader("Authorization", "Bearer hg_raw");
        BearerAwareSecurityContextRepository repository = new BearerAwareSecurityContextRepository();

        repository.saveContext(context(), request, new MockHttpServletResponse());

        assertNull(request.getSession(false));
    }

    @Test
    void sessionRequestStillPersistsContext() {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/tasks");
        BearerAwareSecurityContextRepository repository = new BearerAwareSecurityContextRepository();

        repository.saveContext(context(), request, new MockHttpServletResponse());

        assertNotNull(request.getSession(false));
        assertNotNull(request.getSession(false).getAttribute("SPRING_SECURITY_CONTEXT"));
    }

    @Test
    void tokenRequestDropsResponseSaveWrapper() {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/tasks");
        request.addHeader("Authorization", "Bearer hg_raw");
        MockHttpServletResponse response = new MockHttpServletResponse();
        HttpRequestResponseHolder holder = new HttpRequestResponseHolder(request, response);
        BearerAwareSecurityContextRepository repository = new BearerAwareSecurityContextRepository();

        SecurityContext loaded = repository.loadContext(holder);

        assertNotNull(loaded);
        HttpServletResponse holderResponse = holder.getResponse();
        assertNotSame(response, holderResponse);
        assertEquals(response, ((javax.servlet.http.HttpServletResponseWrapper) holderResponse).getResponse());
        assertNull(request.getSession(false));
    }

    private SecurityContext context() {
        LoginUser user = new LoginUser("U1", "u1", "x", "用户一", "user");
        SecurityContext context = new SecurityContextImpl();
        context.setAuthentication(new UsernamePasswordAuthenticationToken(user, null, user.getAuthorities()));
        return context;
    }
}