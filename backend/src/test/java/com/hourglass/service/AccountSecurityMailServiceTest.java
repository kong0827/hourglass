package com.hourglass.service;

import com.hourglass.entity.AppUser;
import org.junit.jupiter.api.Test;

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

class AccountSecurityMailServiceTest {

    private final MailDeliveryService deliveries = mock(MailDeliveryService.class);
    private final AccountSecurityMailService service = new AccountSecurityMailService(deliveries);

    @Test
    void passwordResetNotifiesRegisteredEmail() {
        service.passwordReset(user("u2@example.com"));

        verify(deliveries).enqueue(eq("u2@example.com"), eq("你的登录密码已被管理员重置"),
                anyString(), eq(AccountSecurityMailService.EVENT_TYPE), isNull());
    }

    @Test
    void passwordChangedNotifiesRegisteredEmail() {
        service.passwordChanged(user("u2@example.com"));

        verify(deliveries).enqueue(eq("u2@example.com"), eq("你的登录密码已修改"),
                anyString(), eq(AccountSecurityMailService.EVENT_TYPE), isNull());
    }

    @Test
    void emailChangeNotifiesOldAndNewMailbox() {
        service.emailChanged("old@example.com", "new@example.com");

        verify(deliveries).enqueue(eq("old@example.com"), eq("你的登录邮箱已变更"),
                anyString(), eq(AccountSecurityMailService.EVENT_TYPE), isNull());
        verify(deliveries).enqueue(eq("new@example.com"), eq("你的登录邮箱已变更"),
                anyString(), eq(AccountSecurityMailService.EVENT_TYPE), isNull());
    }

    @Test
    void emailRemovedOnlyNotifiesOldMailbox() {
        service.emailChanged("old@example.com", null);

        verify(deliveries).enqueue(eq("old@example.com"), eq("你的登录邮箱已变更"),
                anyString(), eq(AccountSecurityMailService.EVENT_TYPE), isNull());
        verify(deliveries, never()).enqueue(isNull(), anyString(), anyString(), anyString(), isNull());
    }

    @Test
    void userWithoutEmailIsHandedToOutboxFilter() {
        service.passwordReset(user(null));

        verify(deliveries).enqueue(isNull(), eq("你的登录密码已被管理员重置"),
                anyString(), eq(AccountSecurityMailService.EVENT_TYPE), isNull());
    }

    @Test
    void welcomeNotifiesRegisteredEmail() {
        service.welcome(user("new@example.com"));

        verify(deliveries).enqueue(eq("new@example.com"), eq("你的账号已创建"),
                anyString(), eq(AccountSecurityMailService.EVENT_TYPE), isNull());
    }

    @Test
    void welcomeIncludesLoginLinkWhenBaseUrlConfigured() {
        org.springframework.test.util.ReflectionTestUtils.setField(service, "mailBaseUrl", "https://host/hourglass");
        org.mockito.ArgumentCaptor<String> body = org.mockito.ArgumentCaptor.forClass(String.class);

        service.welcome(user("new@example.com"));

        verify(deliveries).enqueue(eq("new@example.com"), eq("你的账号已创建"),
                body.capture(), eq(AccountSecurityMailService.EVENT_TYPE), isNull());
        org.junit.jupiter.api.Assertions.assertTrue(body.getValue()
                .endsWith("登录地址：https://host/hourglass/login.html"));
    }

    private AppUser user(String email) {
        AppUser u = new AppUser();
        u.setEmail(email);
        return u;
    }
}
