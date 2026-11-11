package com.hourglass.controller;

import com.hourglass.common.LoginUser;
import com.hourglass.dto.PasswordChangeRequest;
import com.hourglass.dto.ProfileUpdateRequest;
import com.hourglass.dto.WorkHoursRequest;
import com.hourglass.entity.AppUser;
import com.hourglass.mapper.UserMapper;
import com.hourglass.service.AccountSecurityMailService;
import com.hourglass.service.AuditService;
import com.hourglass.service.SessionEpochService;
import com.hourglass.service.UserNotificationPreferenceService;
import com.hourglass.service.UserService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpSession;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/** 账号安全事件必须进独立审计，且资料/计时只记字段不记值。 */
class AuthControllerAuditTest {

    private static final String USER = "U1";
    private static final String USERNAME = "u1";

    private final UserMapper userMapper = mock(UserMapper.class);
    private final UserService userService = mock(UserService.class);
    private final SessionEpochService sessionEpochs = mock(SessionEpochService.class);
    private final AuditService auditService = mock(AuditService.class);
    private final AuthController controller = new AuthController(userMapper, userService,
            mock(UserNotificationPreferenceService.class), sessionEpochs,
            mock(AccountSecurityMailService.class), auditService);

    @BeforeEach
    void setUp() {
        LoginUser user = new LoginUser(USER, USERNAME, "x", "我", "user");
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(user, null, user.getAuthorities()));
    }

    @AfterEach
    void tearDown() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void passwordChangeWritesAuditWithRequestIp() {
        HttpServletRequest request = mock(HttpServletRequest.class);
        HttpSession session = mock(HttpSession.class);
        when(request.getSession(true)).thenReturn(session);
        when(sessionEpochs.current(USER)).thenReturn(2L);

        controller.changePassword(new PasswordChangeRequest(), request);

        verify(auditService).recordCurrent(isNull(), eq("password_change"), eq("user"), eq(USER),
                eq(USERNAME), eq(true), eq("修改登录密码"), eq(request));
    }

    @Test
    void profileChangeAuditsOnlyChangedFieldNames() {
        AppUser before = user("a@example.com");
        AppUser after = user("b@example.com");
        when(userMapper.selectById(USER)).thenReturn(before);
        when(userService.updateProfile(USER, new ProfileUpdateRequest())).thenReturn(after);

        controller.updateProfile(new ProfileUpdateRequest());

        verify(auditService).recordCurrent(isNull(), eq("profile_update"), eq("user"), eq(USER),
                eq(USERNAME), eq(true), eq("修改个人资料：邮箱"), isNull());
    }

    @Test
    void workHoursChangeAuditsOldAndNewWindows() {
        AppUser before = user(null);
        before.setWorkStartHour(9);
        before.setWorkEndHour(18);
        before.setWorkMaxHours(8);
        AppUser after = user(null);
        after.setWorkStartHour(10);
        after.setWorkEndHour(19);
        after.setWorkMaxHours(7);
        when(userMapper.selectById(USER)).thenReturn(before);
        when(userService.updateWorkHours(USER, new WorkHoursRequest())).thenReturn(after);

        controller.updateWorkHours(new WorkHoursRequest());

        verify(auditService).recordCurrent(isNull(), eq("work_hours_update"), eq("user"), eq(USER),
                eq(USERNAME), eq(true),
                eq("计时设置：工作时段 9-18 → 10-19；每日上限 8 → 7 小时"), isNull());
    }

    @Test
    void unchangedProfileAndWorkHoursWriteNoAudit() {
        AppUser same = user("a@example.com");
        same.setWorkStartHour(9);
        same.setWorkEndHour(18);
        same.setWorkMaxHours(8);
        when(userMapper.selectById(USER)).thenReturn(same);
        when(userService.updateProfile(USER, new ProfileUpdateRequest())).thenReturn(same);
        when(userService.updateWorkHours(USER, new WorkHoursRequest())).thenReturn(same);

        controller.updateProfile(new ProfileUpdateRequest());
        controller.updateWorkHours(new WorkHoursRequest());

        verifyNoInteractions(auditService);
    }

    private static AppUser user(String email) {
        AppUser u = new AppUser();
        u.setId(USER);
        u.setUsername(USERNAME);
        u.setDisplayName("我");
        u.setEmail(email);
        return u;
    }
}
