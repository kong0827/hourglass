package com.hourglass.service;

import com.hourglass.common.Texts;
import com.hourglass.entity.AppUser;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/**
 * 账号安全邮件：密码被重置/修改、登录邮箱变更时通知本人。
 * 只走 outbox，不写站内通知——账号级事件不属于某个空间。
 * SMTP 未启用或账号未填邮箱时，由 {@link MailDeliveryService#enqueue} 统一丢弃。
 */
@Service
public class AccountSecurityMailService {

    /** outbox 事件类型，便于排查"这封安全邮件从哪来" */
    public static final String EVENT_TYPE = "account_security";

    private static final String PASSWORD_RESET_SUBJECT = "你的登录密码已被管理员重置";
    private static final String PASSWORD_RESET_BODY =
            "管理员已重置你的登录密码。请使用新密码重新登录，并尽快在「个人设置」中修改为自己的密码。如非本人授权，请联系管理员。";
    private static final String PASSWORD_CHANGED_SUBJECT = "你的登录密码已修改";
    private static final String PASSWORD_CHANGED_BODY =
            "你的登录密码刚刚被修改，其他设备的登录会话已失效。如非本人操作，请立即联系管理员。";
    private static final String EMAIL_CHANGED_SUBJECT = "你的登录邮箱已变更";
    private static final String EMAIL_CHANGED_BODY = "你的账号登录邮箱已变更为 %s。如非本人操作，请立即联系管理员。";
    private static final String EMAIL_REMOVED_TEXT = "（已解除绑定）";
    private static final String WELCOME_SUBJECT = "你的账号已创建";
    private static final String WELCOME_BODY =
            "管理员已为你创建账号。请使用分配的登录名与密码访问系统，并在登录后尽快修改密码。";

    private final MailDeliveryService mailDeliveryService;

    /** 站点根地址（含 context-path，如 https://host/hourglass/）；为空时不附登录链接 */
    @Value("${app.mail.base-url:}")
    private String mailBaseUrl;

    public AccountSecurityMailService(MailDeliveryService mailDeliveryService) {
        this.mailDeliveryService = mailDeliveryService;
    }

    public void passwordReset(AppUser user) {
        enqueue(emailOf(user), PASSWORD_RESET_SUBJECT, PASSWORD_RESET_BODY);
    }

    public void passwordChanged(AppUser user) {
        enqueue(emailOf(user), PASSWORD_CHANGED_SUBJECT, PASSWORD_CHANGED_BODY);
    }

    /** 旧邮箱提示"不是你改的"，新邮箱确认绑定成功；解除绑定时只通知旧邮箱 */
    public void emailChanged(String oldEmail, String newEmail) {
        String oldTo = Texts.trimToNull(oldEmail);
        String newTo = Texts.trimToNull(newEmail);
        String body = String.format(EMAIL_CHANGED_BODY, newTo == null ? EMAIL_REMOVED_TEXT : newTo);
        if (oldTo != null && !oldTo.equalsIgnoreCase(newTo == null ? "" : newTo)) {
            enqueue(oldTo, EMAIL_CHANGED_SUBJECT, body);
        }
        if (newTo != null) {
            enqueue(newTo, EMAIL_CHANGED_SUBJECT, body);
        }
    }

    public void welcome(AppUser user) {
        enqueue(emailOf(user), WELCOME_SUBJECT, WELCOME_BODY + loginLink());
    }

    private String loginLink() {
        String base = Texts.trimToNull(mailBaseUrl);
        if (base == null) {
            return "";
        }
        if (!base.endsWith("/")) {
            base = base + "/";
        }
        return "\n\n登录地址：" + base + "login.html";
    }

    private static String emailOf(AppUser user) {
        return user == null ? null : user.getEmail();
    }

    private void enqueue(String recipient, String subject, String body) {
        mailDeliveryService.enqueue(recipient, subject, body, EVENT_TYPE, null);
    }
}
