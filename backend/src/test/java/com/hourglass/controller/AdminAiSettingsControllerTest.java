package com.hourglass.controller;

import com.hourglass.common.AppException;
import com.hourglass.common.LoginUser;
import com.hourglass.dto.SharedAiSettingsView;
import com.hourglass.entity.AppUser;
import com.hourglass.entity.Workspace;
import com.hourglass.mapper.UserMapper;
import com.hourglass.service.AiUsageService;
import com.hourglass.service.SharedAiSettingService;
import com.hourglass.service.WorkspaceService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

import java.util.Collections;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 团队 AI 接口按数据库实时角色再校验一次，不能只依赖 SecurityConfig。 */
class AdminAiSettingsControllerTest {

    private final SharedAiSettingService settings = mock(SharedAiSettingService.class);
    private final UserMapper users = mock(UserMapper.class);
    private final WorkspaceService workspaces = mock(WorkspaceService.class);
    private final AiUsageService usage = mock(AiUsageService.class);
    private final AdminAiSettingsController controller =
            new AdminAiSettingsController(settings, users, workspaces, usage);

    @AfterEach
    void clearContext() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void nonAdminCannotReadOrChangeTeamAi() {
        login("U1");
        when(users.selectById("U1")).thenReturn(user("U1", "user"));

        AppException ex = assertThrows(AppException.class, controller::get);

        assertEquals(403, ex.getCode());
        verify(settings, never()).view();
    }

    @Test
    void adminReadsTeamAiSettings() {
        login("U9");
        when(users.selectById("U9")).thenReturn(user("U9", "admin"));
        SharedAiSettingsView view = new SharedAiSettingsView();
        when(settings.view()).thenReturn(view);

        SharedAiSettingsView out = controller.get().getData();

        assertEquals(view, out);
    }

    @Test
    void nonAdminCannotReadUsage() {
        login("U1");
        when(users.selectById("U1")).thenReturn(user("U1", "user"));

        AppException ex = assertThrows(AppException.class,
                () -> controller.usage(7, "W1"));

        assertEquals(403, ex.getCode());
        verify(usage, never()).dashboard("W1", 7);
    }

    @Test
    void adminReadsUsageForResolvedWorkspace() {
        login("U9");
        when(users.selectById("U9")).thenReturn(user("U9", "admin"));
        Workspace ws = new Workspace();
        ws.setId("W1");
        when(workspaces.resolve("U9", "W1")).thenReturn(ws);
        Map<String, Object> data = Collections.<String, Object>singletonMap("days", 7);
        when(usage.dashboard("W1", 7)).thenReturn(data);

        Map<String, Object> out = controller.usage(7, "W1").getData();

        assertEquals(data, out);
    }

    private static void login(String id) {
        LoginUser principal = new LoginUser(id, "user-" + id, "x", "我", "admin");
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(principal, null, principal.getAuthorities()));
    }

    private static AppUser user(String id, String role) {
        AppUser u = new AppUser();
        u.setId(id);
        u.setUsername("user-" + id);
        u.setDisplayName("我");
        u.setRole(role);
        return u;
    }
}
