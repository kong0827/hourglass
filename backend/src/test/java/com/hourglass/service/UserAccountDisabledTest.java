package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.common.LoginUser;
import com.hourglass.entity.AppUser;
import com.hourglass.mapper.UserMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.userdetails.UserDetails;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** A4：账号停用/启用（会话踢出与管理员保底） */
class UserAccountDisabledTest {

    private final UserMapper users = mock(UserMapper.class);
    private final SessionEpochService sessionEpochs = mock(SessionEpochService.class);
    private final UserService service = new UserService(users,
            mock(com.hourglass.mapper.WorkspaceMapper.class),
            mock(com.hourglass.mapper.WorkspaceMemberMapper.class),
            mock(com.hourglass.mapper.ProjectMemberMapper.class),
            mock(com.hourglass.mapper.TaskMapper.class),
            mock(com.hourglass.mapper.TaskWatchMapper.class),
            mock(com.hourglass.mapper.RequirementMapper.class),
            mock(com.hourglass.mapper.DevBranchMapper.class),
            mock(com.hourglass.mapper.RequirementDocMapper.class),
            mock(WorkspaceService.class),
            mock(org.springframework.security.crypto.password.PasswordEncoder.class),
            mock(WorkspaceMemberCache.class), sessionEpochs);

    @BeforeEach
    void loginAsAdmin() {
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(
                        new LoginUser("U9", "admin", "x", "管理员", "admin"), null,
                        new ArrayList<org.springframework.security.core.GrantedAuthority>()));
    }

    @AfterEach
    void logout() {
        SecurityContextHolder.clearContext();
    }

    private static AppUser user(String id, String name, String role, Boolean disabled) {
        AppUser u = new AppUser();
        u.setId(id);
        u.setUsername(name);
        u.setDisplayName(name);
        u.setRole(role);
        u.setDisabled(disabled);
        u.setPasswordHash("x");
        return u;
    }

    @Test
    void selfDisableIsRejected() {
        when(users.selectById("U9")).thenReturn(user("U9", "admin", "admin", false));
        AppException ex = assertThrows(AppException.class, () -> service.setDisabled("U9", true));
        assertTrue(ex.getMessage().contains("当前登录账号"));
        verify(users, never()).updateDisabled("U9", true);
    }

    @Test
    void lastActiveAdminCannotBeDisabled() {
        when(users.selectById("U1")).thenReturn(user("U1", "alice", "admin", false));
        when(users.lockAdmins()).thenReturn(new ArrayList<String>(Arrays.asList("U1", "U9")));
        /* U9（当前操作者）已停用，U1 是唯一可用管理员 */
        when(users.selectByIds(Arrays.asList("U1", "U9")))
                .thenReturn(Arrays.asList(user("U1", "alice", "admin", false), user("U9", "admin", "admin", true)));
        AppException ex = assertThrows(AppException.class, () -> service.setDisabled("U1", true));
        assertTrue(ex.getMessage().contains("至少保留"));
        verify(users, never()).updateDisabled("U1", true);
    }

    @Test
    void disableWritesFlagAndBumpsEpochEnableDoesNot() {
        when(users.selectById("U2")).thenReturn(user("U2", "bob", "user", false));
        when(users.lockAdmins()).thenReturn(new ArrayList<String>());

        service.setDisabled("U2", true);
        verify(users).updateDisabled("U2", true);
        verify(sessionEpochs).bump("U2");

        service.setDisabled("U2", false);
        verify(users).updateDisabled("U2", false);
        assertEquals(1, org.mockito.Mockito.mockingDetails(sessionEpochs).getInvocations().size(),
                "启用不需要踢会话");
    }

    @Test
    void disabledAccountLoadsAsEnabledFalse() {
        when(users.selectByUsername("bob")).thenReturn(user("U2", "bob", "user", true));
        UserDetails d = service.loadUserByUsername("bob");
        assertFalse(d.isEnabled(), "停用账号登录时应抛 DisabledException 的前置条件");

        when(users.selectByUsername("alice")).thenReturn(user("U3", "alice", "user", null));
        assertTrue(service.loadUserByUsername("alice").isEnabled(), "disabled 为 NULL 视为可用");
    }
}
