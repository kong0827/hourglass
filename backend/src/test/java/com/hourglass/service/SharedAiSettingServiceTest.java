package com.hourglass.service;

import com.hourglass.common.AiClient;
import com.hourglass.common.AiCrypto;
import com.hourglass.common.AppException;
import com.hourglass.dto.SharedAiSettingsRequest;
import com.hourglass.entity.AiSharedSetting;
import com.hourglass.mapper.AiSharedSettingMapper;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 团队 AI 属于平台凭证：启用前必须完整，审计只记改动项。 */
class SharedAiSettingServiceTest {

    private final AiSharedSettingMapper mapper = mock(AiSharedSettingMapper.class);
    private final AuditService auditService = mock(AuditService.class);
    private final AiCrypto crypto = new AiCrypto("test-key");
    private final SharedAiSettingService service = new SharedAiSettingService(
            mapper, crypto, mock(AiClient.class), auditService);

    @Test
    void firstSaveAuditsWithoutStoringKey() {
        when(mapper.select("platform", "0")).thenReturn(null);

        service.update(request("sk-team-secret", true, null), "管理员");

        ArgumentCaptor<String> detail = ArgumentCaptor.forClass(String.class);
        verify(auditService).recordCurrent(isNull(),
                org.mockito.ArgumentMatchers.eq("ai_shared_config_update"),
                org.mockito.ArgumentMatchers.eq("ai_shared_setting"),
                org.mockito.ArgumentMatchers.eq("platform"),
                org.mockito.ArgumentMatchers.eq("团队 AI"),
                org.mockito.ArgumentMatchers.eq(true), detail.capture(), isNull());
        assertTrue(detail.getValue().contains("首次配置"), detail.getValue());
        assertFalse(detail.getValue().contains("sk-team-secret"), "审计不能落地 Key 明文");
        assertFalse(detail.getValue().contains("v1:"), "审计不能落地 Key 密文");
    }

    @Test
    void enablingWithoutKeyIsRejected() {
        when(mapper.select("platform", "0")).thenReturn(null);

        AppException ex = assertThrows(AppException.class,
                () -> service.update(request(null, true, null), "管理员"));

        assertTrue(ex.getMessage().contains("API Key"), ex.getMessage());
        verify(mapper, org.mockito.Mockito.never()).upsert(any(AiSharedSetting.class));
    }

    @Test
    void brokenKeyIsReportedAsUnavailable() {
        AiSharedSetting s = setting(new AiCrypto("another-deploy-key").encrypt("sk-team"));

        assertFalse(service.decryptable(s), "换过部署密钥后旧密文解不开");
        assertTrue(service.blockedReason(s).contains("无法解密"), service.blockedReason(s));
    }

    @Test
    void readyConfigHasNoBlockedReason() {
        AiSharedSetting s = setting(crypto.encrypt("sk-team"));

        assertTrue(service.decryptable(s));
        assertTrue(service.usable(s));
        org.junit.jupiter.api.Assertions.assertNull(service.blockedReason(s));
    }

    @Test
    void turningOffPersonalKeysIsAudited() {        AiSharedSetting saved = new AiSharedSetting();
        saved.setScope("platform");
        saved.setScopeId("0");
        saved.setProvider("deepseek");
        saved.setModel("deepseek-chat");
        saved.setApiKey(crypto.encrypt("sk-team-secret"));
        saved.setEnabled(true);
        saved.setAllowPersonal(true);
        when(mapper.select("platform", "0")).thenReturn(saved);

        service.update(request(null, null, false), "管理员");

        ArgumentCaptor<String> detail = ArgumentCaptor.forClass(String.class);
        verify(auditService).recordCurrent(isNull(),
                org.mockito.ArgumentMatchers.eq("ai_shared_config_update"),
                org.mockito.ArgumentMatchers.eq("ai_shared_setting"),
                org.mockito.ArgumentMatchers.eq("platform"),
                org.mockito.ArgumentMatchers.eq("团队 AI"),
                org.mockito.ArgumentMatchers.eq(true), detail.capture(), isNull());
        assertTrue(detail.getValue().contains("允许个人 Key"), detail.getValue());
    }

    private static AiSharedSetting setting(String cipher) {
        AiSharedSetting s = new AiSharedSetting();
        s.setScope("platform");
        s.setScopeId("0");
        s.setProvider("deepseek");
        s.setModel("deepseek-chat");
        s.setApiKey(cipher);
        s.setEnabled(true);
        s.setAllowPersonal(true);
        return s;
    }

    private static SharedAiSettingsRequest request(String key, Boolean enabled, Boolean allowPersonal) {
        SharedAiSettingsRequest req = new SharedAiSettingsRequest();
        req.setProvider("deepseek");
        req.setModel("deepseek-chat");
        req.setApiKey(key);
        req.setEnabled(enabled);
        req.setAllowPersonal(allowPersonal);
        return req;
    }
}
