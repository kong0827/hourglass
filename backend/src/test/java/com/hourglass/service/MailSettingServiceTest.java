package com.hourglass.service;

import com.hourglass.common.AiCrypto;
import com.hourglass.dto.MailSettingsRequest;
import com.hourglass.dto.MailSettingsResponse;
import com.hourglass.entity.MailSetting;
import com.hourglass.mapper.MailSettingMapper;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class MailSettingServiceTest {

    private final MailSettingMapper mapper = mock(MailSettingMapper.class);
    private final AiCrypto crypto = new AiCrypto("test-key");
    private final AuditService auditService = mock(AuditService.class);
    private final MailSettingService service = new MailSettingService(mapper, crypto, auditService);

    @Test
    void blankPasswordRetainsCiphertextAndResponseOnlySaysPasswordSet() {
        MailSetting old = new MailSetting();
        old.setPassword(crypto.encrypt("old-secret"));
        when(mapper.select()).thenReturn(old);
        MailSettingsRequest req = request();
        req.setPassword("");

        MailSettingsResponse response = service.update(req);

        ArgumentCaptor<MailSetting> saved = ArgumentCaptor.forClass(MailSetting.class);
        verify(mapper).upsert(saved.capture());
        assertEquals(old.getPassword(), saved.getValue().getPassword());
        assertTrue(response.getPasswordSet());
        assertEquals("old-secret", crypto.decrypt(saved.getValue().getPassword()));
    }

    @Test
    void newPasswordIsEncryptedBeforePersistence() {
        MailSettingsRequest req = request();
        req.setPassword("new-secret");

        service.update(req);

        ArgumentCaptor<MailSetting> saved = ArgumentCaptor.forClass(MailSetting.class);
        verify(mapper).upsert(saved.capture());
        assertNotEquals("new-secret", saved.getValue().getPassword());
        assertEquals("new-secret", crypto.decrypt(saved.getValue().getPassword()));
    }

    @Test
    void auditListsChangedFieldsButNeverStoresSecrets() {
        MailSettingsRequest req = request();
        req.setPassword("new-secret");

        service.update(req);

        ArgumentCaptor<String> detail = ArgumentCaptor.forClass(String.class);
        verify(auditService).recordCurrent(any(), eq("mail_settings_update"), eq("mail_settings"),
                eq("smtp"), isNull(), eq(true), detail.capture(), isNull());
        assertTrue(detail.getValue().contains("密码"));
        assertFalse(detail.getValue().contains("new-secret"), "审计只记字段，不落地明文密码");
    }

    private MailSettingsRequest request() {
        MailSettingsRequest req = new MailSettingsRequest();
        req.setEnabled(true);
        req.setHost("smtp.example.com");
        req.setPort(587);
        req.setUsername("mailer@example.com");
        req.setFromEmail("mailer@example.com");
        return req;
    }
}
