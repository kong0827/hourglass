package com.hourglass.service;

import com.hourglass.common.AiCrypto;
import com.hourglass.common.AppException;
import com.hourglass.common.Texts;
import com.hourglass.entity.MailSetting;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.javamail.JavaMailSenderImpl;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.stereotype.Service;

import javax.mail.MessagingException;
import javax.mail.internet.InternetAddress;
import javax.mail.internet.MimeMessage;
import java.io.UnsupportedEncodingException;
import java.nio.charset.StandardCharsets;
import java.util.Properties;

/** 根据数据库中的当前配置动态构造邮件发送器，不使用启动时静态 spring.mail 配置。 */
@Service
public class SmtpMailService {

    private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(SmtpMailService.class);

    private final MailSettingService settingService;
    private final AiCrypto crypto;
    /** 只影响收件人看到的名称，MAIL FROM 仍是配置里的发件邮箱，不改变企业邮的账号一致性要求。 */
    private final String fromName;

    public SmtpMailService(MailSettingService settingService, AiCrypto crypto,
                           @Value("${app.mail.from-name:沙漏}") String fromName) {
        this.settingService = settingService;
        this.crypto = crypto;
        this.fromName = Texts.trimToNull(fromName);
    }

    public boolean isEnabled() {
        MailSetting s = settingService.get();
        return s != null && Boolean.TRUE.equals(s.getEnabled());
    }

    /** 发送失败原样抛出，由测试接口转换为明确错误，或由 outbox 记录重试。 */
    public void send(String recipient, String subject, String body) {
        MailSetting s = settingService.get();
        if (s == null || !Boolean.TRUE.equals(s.getEnabled())) {
            throw AppException.badRequest("SMTP 尚未启用");
        }
        if (Texts.trimToNull(recipient) == null) {
            throw AppException.badRequest("当前账号未填写邮箱");
        }
        String password = null;
        if (s.getPassword() != null && !s.getPassword().isEmpty()) {
            password = crypto.decrypt(s.getPassword());
            if (password == null) {
                throw AppException.badRequest("SMTP 密码无法解密，请重新保存密码");
            }
        }
        JavaMailSenderImpl sender = createSender(s, password);
        /* 报文组装属于参数校验，放到计时区外：地址格式错误不该记成 SMTP 发送失败 */
        MimeMessage message = buildMessage(sender, s.getFromEmail(), recipient, subject, body);
        long startedAt = System.currentTimeMillis();
        try {
            sender.send(message);
            log.info("SMTP 发送成功：host={} port={} to={} 耗时={}ms",
                    s.getHost(), sender.getPort(), maskEmail(recipient), System.currentTimeMillis() - startedAt);
        } catch (RuntimeException e) {
            log.warn("SMTP 发送失败：host={} port={} to={} 耗时={}ms - {}",
                    s.getHost(), sender.getPort(), maskEmail(recipient),
                    System.currentTimeMillis() - startedAt, errorMessage(e));
            throw e;
        }
    }

    /** 日志只留域名与首字母，不把完整收件人写进文件 */
    static String maskEmail(String email) {
        String value = Texts.trimToNull(email);
        if (value == null) {
            return "-";
        }
        int at = value.indexOf('@');
        if (at <= 0) {
            return value.length() <= 2 ? "**" : value.charAt(0) + "***";
        }
        return value.charAt(0) + "***" + value.substring(at);
    }

    /** 独立成方法便于针对性测试报文头，不连接真实 SMTP。 */
    protected MimeMessage buildMessage(JavaMailSenderImpl sender, String fromEmail, String recipient,
                                       String subject, String body) {
        MimeMessage message = sender.createMimeMessage();
        try {
            MimeMessageHelper helper = new MimeMessageHelper(message, false, StandardCharsets.UTF_8.name());
            helper.setFrom(new InternetAddress(fromEmail, fromName, StandardCharsets.UTF_8.name()));
            helper.setTo(recipient);
            helper.setSubject(subject == null ? "" : subject);
            helper.setText(body == null ? "" : body, false);
        } catch (MessagingException | UnsupportedEncodingException e) {
            throw AppException.badRequest("邮件地址格式不正确：" + errorMessage(e));
        }
        return message;
    }

    /** 独立成方法便于针对性测试邮件属性，不连接真实 SMTP。 */
    protected JavaMailSenderImpl createSender(MailSetting s, String password) {
        JavaMailSenderImpl sender = new JavaMailSenderImpl();
        sender.setHost(s.getHost());
        sender.setPort(s.getPort() == null ? 587 : s.getPort());
        sender.setUsername(s.getUsername());
        sender.setPassword(password);
        sender.setDefaultEncoding(StandardCharsets.UTF_8.name());
        Properties p = sender.getJavaMailProperties();
        p.put("mail.smtp.auth", Boolean.toString(Texts.trimToNull(s.getUsername()) != null));
        p.put("mail.smtp.connectiontimeout", "5000");
        p.put("mail.smtp.timeout", "8000");
        p.put("mail.smtp.writetimeout", "8000");
        boolean ssl = s.getPort() != null && s.getPort() == 465;
        p.put("mail.smtp.ssl.enable", Boolean.toString(ssl));
        p.put("mail.smtp.starttls.enable", Boolean.toString(!ssl));
        return sender;
    }

    public static String errorMessage(Exception e) {
        Throwable current = e;
        while (current.getCause() != null && current.getCause() != current) {
            current = current.getCause();
        }
        String message = Texts.trimToNull(current.getMessage());
        if (message == null) {
            return current.getClass().getSimpleName();
        }
        // 腾讯企业邮等要求 From 与认证账号完全相同，原始英文提示无法指导改哪一栏
        if (message.contains("must be same as authorization user")) {
            return "发件人邮箱必须与 SMTP 用户名一致（" + message + "）";
        }
        return message;
    }
}
