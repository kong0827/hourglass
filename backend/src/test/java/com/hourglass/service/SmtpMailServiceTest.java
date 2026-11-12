package com.hourglass.service;

import com.hourglass.common.AiCrypto;
import com.hourglass.entity.MailSetting;
import org.junit.jupiter.api.Test;
import org.springframework.mail.javamail.JavaMailSenderImpl;

import javax.mail.internet.InternetAddress;
import javax.mail.internet.MimeMessage;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.mock;

class SmtpMailServiceTest {

    private final MailSettingService settingService = mock(MailSettingService.class);
    private final AiCrypto crypto = mock(AiCrypto.class);
    private final SmtpMailService service = new SmtpMailService(settingService, crypto, "沙漏");

    @Test
    void fromHeaderKeepsMailAddressAndAddsDisplayName() throws Exception {
        MailSetting s = new MailSetting();
        s.setPort(465);
        JavaMailSenderImpl sender = service.createSender(s, "pwd");

        MimeMessage message = service.buildMessage(sender, "operations_service@orientfutures.com",
                "someone@example.com", "测试主题", "测试正文");

        InternetAddress from = (InternetAddress) message.getFrom()[0];
        assertEquals("operations_service@orientfutures.com", from.getAddress());
        assertEquals("沙漏", from.getPersonal());
    }

    @Test
    void blankFromNameKeepsBareAddress() throws Exception {
        SmtpMailService plain = new SmtpMailService(settingService, crypto, "  ");
        JavaMailSenderImpl sender = plain.createSender(new MailSetting(), "pwd");

        MimeMessage message = plain.buildMessage(sender, "operations_service@orientfutures.com",
                "someone@example.com", "s", "b");

        InternetAddress from = (InternetAddress) message.getFrom()[0];
        assertEquals("operations_service@orientfutures.com", from.getAddress());
    }

    @Test
    void mapsSenderMismatchToActionableMessage() {
        Exception e = new RuntimeException("nested",
                new RuntimeException("501 mail from address must be same as authorization user"));

        assertEquals("发件人邮箱必须与 SMTP 用户名一致（501 mail from address must be same as authorization user）",
                SmtpMailService.errorMessage(e));
    }
}
