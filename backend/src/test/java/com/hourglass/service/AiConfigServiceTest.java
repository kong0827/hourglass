package com.hourglass.service;

import com.hourglass.common.AiClient;
import com.hourglass.common.AiCrypto;
import com.hourglass.dto.AiConfigRequest;
import com.hourglass.entity.AppUser;
import com.hourglass.mapper.UserMapper;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/** AI 配置属于账号凭证：审计只记改动项，Key 的明文/密文都不能进详情。 */
class AiConfigServiceTest {

    private static final String USER = "U1";

    private final UserMapper users = org.mockito.Mockito.mock(UserMapper.class);
    private final AiCrypto crypto = new AiCrypto("test-key");
    private final AuditService auditService = org.mockito.Mockito.mock(AuditService.class);
    private final AiConfigService service =
            new AiConfigService(users, crypto, org.mockito.Mockito.mock(AiClient.class), auditService);

    @Test
    void changedConfigAuditsFieldNamesButNeverStoresKey() {
        AppUser before = user("gpt-4o-mini");
        before.setAiApiKey(crypto.encrypt("sk-old-secret"));
        AppUser after = user("gpt-4.1-mini");
        after.setAiApiKey(crypto.encrypt("sk-new-secret"));
        when(users.selectById(USER)).thenReturn(before, after);

        AiConfigRequest req = new AiConfigRequest();
        req.setProvider("openai");
        req.setModel("gpt-4.1-mini");
        req.setApiKey("sk-new-secret");
        req.setEnabled(true);

        service.save(USER, req);

        ArgumentCaptor<String> detail = ArgumentCaptor.forClass(String.class);
        verify(auditService).recordCurrent(isNull(), org.mockito.ArgumentMatchers.eq("ai_config_update"),
                org.mockito.ArgumentMatchers.eq("user"), org.mockito.ArgumentMatchers.eq(USER),
                org.mockito.ArgumentMatchers.eq("u1"), org.mockito.ArgumentMatchers.eq(true),
                detail.capture(), isNull());
        assertTrue(detail.getValue().contains("模型"));
        assertTrue(detail.getValue().contains("API Key（已更新）"));
        assertFalse(detail.getValue().contains("sk-new-secret"), "审计不能落地 Key 明文");
        assertFalse(detail.getValue().contains("v1:"), "审计不能落地 Key 密文");
    }

    @Test
    void unchangedConfigWritesNoAudit() {
        AppUser before = user("gpt-4o-mini");
        before.setAiApiKey(crypto.encrypt("sk-old-secret"));
        when(users.selectById(USER)).thenReturn(before, before);

        AiConfigRequest req = new AiConfigRequest();
        req.setProvider("openai");
        req.setModel("gpt-4o-mini");
        req.setEnabled(true);

        service.save(USER, req);

        verifyNoInteractions(auditService);
        verify(users).updateAiConfig(org.mockito.ArgumentMatchers.eq(USER), any(), any(), any(), any(), anyBoolean());
    }

    private static AppUser user(String model) {
        AppUser u = new AppUser();
        u.setId(USER);
        u.setUsername("u1");
        u.setDisplayName("我");
        u.setAiProvider("openai");
        u.setAiModel(model);
        u.setAiEnabled(true);
        return u;
    }
}
