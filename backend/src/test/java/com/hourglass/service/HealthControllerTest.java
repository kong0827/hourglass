package com.hourglass.service;

import com.hourglass.common.LoginUser;
import com.hourglass.controller.HealthController;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.ConnectionCallback;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

import java.sql.Connection;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class HealthControllerTest {

    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final HealthController controller = new HealthController(jdbc);

    @BeforeEach
    @AfterEach
    void clearAuthentication() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void anonymousHealthDoesNotExposeDatabaseName() {
        Map<String, Object> data = controller.health().getData();
        assertEquals("up", data.get("db"));
        assertFalse(data.containsKey("database"));
        verify(jdbc, never()).execute(any(ConnectionCallback.class));
    }

    @Test
    void ordinaryUserDoesNotExposeDatabaseName() {
        authenticate("user");
        Map<String, Object> data = controller.health().getData();
        assertEquals("up", data.get("db"));
        assertFalse(data.containsKey("database"));
        verify(jdbc, never()).execute(any(ConnectionCallback.class));
    }

    @Test
    @SuppressWarnings("unchecked")
    void administratorSeesActualConnectionCatalog() throws Exception {
        authenticate("admin");
        Connection connection = mock(Connection.class);
        when(connection.getCatalog()).thenReturn("hourglass_delivery_test");
        when(jdbc.execute(any(ConnectionCallback.class))).thenAnswer(invocation ->
                ((ConnectionCallback<String>) invocation.getArgument(0)).doInConnection(connection));
        Map<String, Object> data = controller.health().getData();
        assertEquals("up", data.get("db"));
        assertEquals("hourglass_delivery_test", data.get("database"));
        verify(connection).getCatalog();
    }

    @Test
    void connectionFailureRemainsExplicit() {
        when(jdbc.queryForObject("SELECT 1", Integer.class)).thenThrow(new IllegalStateException("unavailable"));
        Map<String, Object> data = controller.health().getData();
        assertEquals("down", data.get("db"));
        assertFalse(data.containsKey("database"));
    }

    private void authenticate(String role) {
        LoginUser user = new LoginUser("user-id", "tester", "unused", "Tester", role);
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(user, null, user.getAuthorities()));
    }
}
