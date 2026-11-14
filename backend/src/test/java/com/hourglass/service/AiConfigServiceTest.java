package com.hourglass.service;

import com.hourglass.common.AiClient;
import com.hourglass.common.AiCrypto;
import com.hourglass.common.AppException;
import com.hourglass.dto.AiConfig;
import com.hourglass.dto.AiConfigRequest;
import com.hourglass.entity.AiSharedSetting;
import com.hourglass.entity.AppUser;
import com.hourglass.mapper.UserMapper;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/** AI 配置属于账号凭证：审计只记改动项，Key 的明文/密文都不能进详情。 */
class AiConfigServiceTest {

    private static final String USER = "U1";

    private final UserMapper users = org.mockito.Mockito.mock(UserMapper.class);
    private final AiCrypto crypto = new AiCrypto("test-key");
    private final AuditService auditService = org.mockito.Mockito.mock(AuditService.class);
    private final SharedAiSettingService shared =
            org.mockito.Mockito.mock(SharedAiSettingService.class);
    private final AiConfigService service =
            new AiConfigService(users, crypto, org.mockito.Mockito.mock(AiClient.class), auditService, shared);

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

        service.save(USER, req, null);

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

        service.save(USER, req, null);

        verifyNoInteractions(auditService);
        verify(users).updateAiConfig(org.mockito.ArgumentMatchers.eq(USER), any(), any(), any(), any(),
                anyBoolean(), any());
    }

    @Test
    void readyTeamConfigIsUsedBeforePersonalKey() {
        AppUser u = personalUser();
        AiSharedSetting team = shared(true, true, "sk-team-secret");
        when(shared.findPlatform()).thenReturn(team);
        when(shared.usable(team)).thenReturn(true);
        AiConfig teamConfig = new AiConfig();
        teamConfig.setProvider("deepseek");
        teamConfig.setModel("deepseek-chat");
        teamConfig.setApiKey("sk-team-secret");
        teamConfig.setSource("team");
        teamConfig.setSourceLabel("团队 AI");
        when(shared.toConfig(team)).thenReturn(teamConfig);

        AiConfig out = service.resolve(USER, null);

        assertEquals("team", out.getSource(), "auto 偏好下团队额度优先");
        assertEquals("sk-team-secret", out.getApiKey());
        verify(shared).toConfig(team);
    }

    @Test
    void explicitPersonalPreferenceKeepsPersonalKey() {
        AppUser u = personalUser();
        u.setAiPrefer("personal");
        AiSharedSetting team = shared(true, true, "sk-team-secret");
        when(shared.findPlatform()).thenReturn(team);
        when(shared.usable(team)).thenReturn(true);

        AiConfig out = service.resolve(USER, null);

        assertEquals("personal", out.getSource());
        assertEquals("sk-mine", out.getApiKey());
        verify(shared, never()).toConfig(team);
    }

    @Test
    void adminDisallowingPersonalWithoutTeamBlocksEveryone() {
        AppUser u = personalUser();
        AiSharedSetting platform = shared(false, false, null);
        when(shared.findPlatform()).thenReturn(platform);
        when(shared.usable(platform)).thenReturn(false);

        AppException ex = assertThrows(AppException.class, () -> service.resolve(USER, null));

        assertTrue(ex.getMessage().contains("平台已关闭个人 API Key"), ex.getMessage());
    }

    @Test
    void enabledButIncompleteTeamDoesNotFallBackToPersonal() {
        AppUser u = personalUser();
        AiSharedSetting platform = shared(true, true, null);
        when(shared.findPlatform()).thenReturn(platform);
        when(shared.usable(platform)).thenReturn(false);

        AppException ex = assertThrows(AppException.class, () -> service.resolve(USER, null));

        assertTrue(ex.getMessage().contains("团队 AI 配置不完整"), ex.getMessage());
    }

    @Test
    void brokenTeamKeySurfacesAdminErrorInsteadOfUsingPersonal() {
        AppUser u = personalUser();
        AiSharedSetting platform = shared(true, true, "v1:broken");
        when(shared.findPlatform()).thenReturn(platform);
        when(shared.usable(platform)).thenReturn(true);
        when(shared.toConfig(platform)).thenThrow(
                AppException.badRequest("团队 AI 的 Key 无法解密（部署密钥变更过），请联系平台管理员重新填写"));

        AppException ex = assertThrows(AppException.class, () -> service.resolve(USER, null));

        assertTrue(ex.getMessage().contains("团队 AI"), ex.getMessage());
        verify(shared).toConfig(platform);
    }

    @Test
    void viewShowsTeamSourceWhenSharedConfigIsReady() {
        personalUser();
        AiSharedSetting platform = shared(true, true, "sk-team-secret");
        when(shared.findPlatform()).thenReturn(platform);
        when(shared.usable(platform)).thenReturn(true);
        when(shared.decryptable(platform)).thenReturn(true);
        when(shared.sourceLabel("platform")).thenReturn("团队 AI");

        com.hourglass.dto.AiConfigView v = service.view(USER, null);

        assertEquals("team", v.getSource());
        assertEquals("团队 AI", v.getSourceName());
        assertTrue(v.getTeam().isAvailable());
        assertTrue(v.getStatus().contains("团队额度"), v.getStatus());
    }

    @Test
    void viewDoesNotClaimPersonalSourceWhenTeamIsIncomplete() {
        personalUser();
        AiSharedSetting platform = shared(true, true, null);
        when(shared.findPlatform()).thenReturn(platform);
        when(shared.usable(platform)).thenReturn(false);
        when(shared.decryptable(platform)).thenReturn(false);
        when(shared.blockedReason(platform)).thenReturn("团队 AI 配置不完整，请联系平台管理员");

        com.hourglass.dto.AiConfigView v = service.view(USER, null);

        assertEquals("none", v.getSource(), "团队已启用但不可用时不能显示成个人来源");
        assertFalse(v.getTeam().isAvailable());
        assertTrue(v.getStatus().contains("配置不完整"), v.getStatus());
    }

    @Test
    void viewReportsBrokenTeamKeyInsteadOfReady() {
        personalUser();
        AiSharedSetting platform = shared(true, true, "v1:broken");
        when(shared.findPlatform()).thenReturn(platform);
        when(shared.usable(platform)).thenReturn(true);
        when(shared.decryptable(platform)).thenReturn(false);
        when(shared.blockedReason(platform))
                .thenReturn("团队 AI 的 Key 无法解密（部署密钥变更过），请联系平台管理员重新填写");

        com.hourglass.dto.AiConfigView v = service.view(USER, null);

        assertEquals("none", v.getSource());
        assertFalse(v.getTeam().isAvailable());
        assertTrue(v.getStatus().contains("无法解密"), v.getStatus());
    }

    private AppUser personalUser() {
        AppUser u = user("gpt-4o-mini");
        u.setAiApiKey(crypto.encrypt("sk-mine"));
        when(users.selectById(USER)).thenReturn(u);
        return u;
    }

    private static AiSharedSetting shared(boolean enabled, boolean allowPersonal, String key) {
        AiSharedSetting s = new AiSharedSetting();
        s.setScope("platform");
        s.setScopeId("0");
        s.setProvider("deepseek");
        s.setModel("deepseek-chat");
        s.setApiKey(key);
        s.setEnabled(enabled);
        s.setAllowPersonal(allowPersonal);
        return s;
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
