package com.hourglass.service;

import com.hourglass.common.AiClient;
import com.hourglass.common.AiCrypto;
import com.hourglass.common.AiProviders;
import com.hourglass.common.AppException;
import com.hourglass.common.OutboundUrlGuard;
import com.hourglass.dto.AiConfig;
import com.hourglass.dto.SharedAiSettingsRequest;
import com.hourglass.dto.SharedAiSettingsView;
import com.hourglass.entity.AiSharedSetting;
import com.hourglass.mapper.AiSharedSettingMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * 团队 / 空间共享 AI 配置的读写、测试与审计。
 *
 * <p>P0 只有平台行（scope=platform，scope_id=0）。Key 复用个人配置的加密方式，
 * 接口只回掩码；审计只记改了哪些项，不落明文或密文。
 */
@Service
public class SharedAiSettingService {

    public static final String SCOPE_PLATFORM = "platform";
    public static final String SCOPE_WORKSPACE = "workspace";
    public static final String PLATFORM_ID = "0";

    private static final DateTimeFormatter TIME_FMT = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm");

    private final AiSharedSettingMapper mapper;
    private final AiCrypto crypto;
    private final AiClient aiClient;
    private final AuditService auditService;
    @Value("${app.ai.allow-private-network:false}")
    private boolean allowPrivateNetwork;

    public SharedAiSettingService(AiSharedSettingMapper mapper, AiCrypto crypto, AiClient aiClient,
                                  AuditService auditService) {
        this.mapper = mapper;
        this.crypto = crypto;
        this.aiClient = aiClient;
        this.auditService = auditService;
    }

    public AiSharedSetting find(String scope, String scopeId) {
        return mapper.select(scope, scopeId);
    }

    public AiSharedSetting findPlatform() {
        return find(SCOPE_PLATFORM, PLATFORM_ID);
    }

    /** 平台是否允许成员改用个人 Key；没有配置时默认允许。 */
    public boolean allowPersonal() {
        AiSharedSetting s = findPlatform();
        return s == null || !Boolean.FALSE.equals(s.getAllowPersonal());
    }

    /**
     * 配置是否可直接参与解析：已启用、地址/模型齐全，且 Key 已保存（Ollama 除外）。
     * 不校验 Key 能否解密 —— 解不开时要用「联系管理员」的明确错误，而不是静默回落个人。
     */
    public boolean usable(AiSharedSetting s) {
        if (s == null || !Boolean.TRUE.equals(s.getEnabled())) {
            return false;
        }
        String baseUrl = AiProviders.baseUrlOr(s.getProvider(), s.getBaseUrl());
        String model = AiProviders.modelOr(s.getProvider(), s.getModel());
        if (baseUrl == null || model == null) {
            return false;
        }
        return "ollama".equals(s.getProvider()) || hasStoredKey(s);
    }

    /** 已启用但配置不完整（缺地址 / 模型 / Key）。 */
    public boolean incomplete(AiSharedSetting s) {
        return s != null && Boolean.TRUE.equals(s.getEnabled()) && !usable(s);
    }

    /** Key 能否真正解密；Ollama 不需要 Key。 */
    public boolean decryptable(AiSharedSetting s) {
        return s != null
                && ("ollama".equals(s.getProvider()) || crypto.decrypt(s.getApiKey()) != null);
    }

    /**
     * 已启用但不能参与解析的原因；可用或未启用时返回 null。
     * 成员页据此说明「为什么团队 AI 现在用不了」，不把问题说成「已就绪」。
     */
    public String blockedReason(AiSharedSetting s) {
        if (s == null || !Boolean.TRUE.equals(s.getEnabled())) {
            return null;
        }
        String label = sourceLabel(s.getScope());
        if (usable(s) && !decryptable(s)) {
            return label + " 的 Key 无法解密（部署密钥变更过），请联系平台管理员重新填写";
        }
        if (!usable(s)) {
            return label + " 配置不完整，请联系平台管理员";
        }
        return null;
    }

    public String sourceLabel(String scope) {
        return SCOPE_WORKSPACE.equals(scope) ? "本空间 AI" : "团队 AI";
    }

    /** 解密后的调用配置；Key 缺失 / 解不开时抛出可执行的提示，绝不回落到个人 Key。 */
    public AiConfig toConfig(AiSharedSetting s) {
        String label = sourceLabel(s.getScope());
        AiConfig c = new AiConfig();
        c.setProvider(s.getProvider());
        c.setBaseUrl(AiProviders.baseUrlOr(s.getProvider(), s.getBaseUrl()));
        c.setModel(AiProviders.modelOr(s.getProvider(), s.getModel()));
        c.setSource(SCOPE_WORKSPACE.equals(s.getScope()) ? "workspace" : "team");
        c.setSourceLabel(label);

        String plain = crypto.decrypt(s.getApiKey());
        if (plain == null && !"ollama".equals(s.getProvider())) {
            throw AppException.badRequest(hasStoredKey(s)
                    ? label + " 的 Key 无法解密（部署密钥变更过），请联系平台管理员重新填写"
                    : label + " 配置不完整（缺少 API Key），请联系平台管理员");
        }
        c.setApiKey(plain);
        if (!c.usable()) {
            throw AppException.badRequest(label + " 配置不完整（接口地址或模型名为空），请联系平台管理员");
        }
        return c;
    }

    /** 平台管理员视图：Key 只回掩码，并给出可读状态。 */
    public SharedAiSettingsView view() {
        SharedAiSettingsView v = new SharedAiSettingsView();
        v.setPresets(AiProviders.all());
        AiSharedSetting s = findPlatform();
        if (s == null) {
            v.setAllowPersonal(true);
            v.setStatus("未启用：成员按各自配置的 Key 使用");
            return v;
        }
        v.setEnabled(Boolean.TRUE.equals(s.getEnabled()));
        v.setAllowPersonal(!Boolean.FALSE.equals(s.getAllowPersonal()));
        v.setProvider(s.getProvider());
        v.setBaseUrl(AiProviders.baseUrlOr(s.getProvider(), s.getBaseUrl()));
        v.setModel(AiProviders.modelOr(s.getProvider(), s.getModel()));
        v.setUpdatedBy(s.getUpdatedBy());
        v.setUpdatedAt(s.getUpdatedAt() == null ? null : s.getUpdatedAt().format(TIME_FMT));

        if (hasStoredKey(s)) {
            String plain = crypto.decrypt(s.getApiKey());
            if (plain == null) {
                v.setKeyBroken(true);
            } else {
                v.setHasKey(true);
                v.setApiKeyMasked(AiCrypto.mask(plain));
            }
        }
        v.setStatus(statusOf(s, v));
        return v;
    }

    private String statusOf(AiSharedSetting s, SharedAiSettingsView v) {
        if (v.isKeyBroken()) {
            return "已保存的 Key 无法解密（部署密钥变更过），请重新填写";
        }
        if (!v.isEnabled()) {
            return v.isHasKey() || "ollama".equals(s.getProvider())
                    ? "配置已保存，但团队 AI 开关是关的：成员按个人 Key 解析"
                    : "未启用：成员按各自配置的 Key 使用";
        }
        if (!v.isHasKey() && !"ollama".equals(s.getProvider())) {
            return "已启用但配置不完整（缺少 API Key），成员暂时无法使用";
        }
        if (v.getBaseUrl() == null || v.getModel() == null) {
            return "已启用但配置不完整（缺接口地址或模型名），成员暂时无法使用";
        }
        return "已就绪：全员调用走团队额度";
    }

    /** 保存平台共享配置；apiKey 为空表示不改，clearKey 才删。 */
    public SharedAiSettingsView update(SharedAiSettingsRequest req, String actorName) {
        AiSharedSetting saved = findPlatform();
        String provider = req.getProvider() != null
                ? emptyToNull(req.getProvider())
                : (saved == null ? null : saved.getProvider());
        if (provider != null && AiProviders.get(provider) == null) {
            throw AppException.badRequest("不认识的厂商：" + provider);
        }

        String rawBase = req.getBaseUrl() != null
                ? req.getBaseUrl()
                : (saved == null ? null : saved.getBaseUrl());
        String baseUrl = AiProviders.baseUrlOr(provider, rawBase);
        String model = AiProviders.modelOr(provider,
                req.getModel() != null ? req.getModel() : (saved == null ? null : saved.getModel()));
        validateBaseUrl(rawBase, provider);

        String cipher;
        if (Boolean.TRUE.equals(req.getClearKey())) {
            cipher = null;
        } else if (req.getApiKey() != null && !req.getApiKey().trim().isEmpty()) {
            cipher = crypto.encrypt(req.getApiKey().trim());
        } else {
            cipher = saved == null ? null : saved.getApiKey();
        }

        boolean enabled = req.getEnabled() == null
                ? saved != null && Boolean.TRUE.equals(saved.getEnabled())
                : req.getEnabled();
        boolean allowPersonal = req.getAllowPersonal() == null
                ? saved == null || !Boolean.FALSE.equals(saved.getAllowPersonal())
                : req.getAllowPersonal();

        if (enabled) {
            boolean noKeyOk = "ollama".equals(provider);
            if (baseUrl == null || model == null || (!noKeyOk && (cipher == null || cipher.isEmpty()))) {
                throw AppException.badRequest(Boolean.TRUE.equals(req.getClearKey())
                        ? "清除 Key 前请先关闭团队 AI"
                        : "启用前请先填好厂商、接口地址、模型与 API Key，并测试连接");
            }
        }

        AiSharedSetting s = new AiSharedSetting();
        s.setScope(SCOPE_PLATFORM);
        s.setScopeId(PLATFORM_ID);
        s.setProvider(provider);
        s.setBaseUrl(emptyToNull(baseUrl));
        s.setModel(emptyToNull(model));
        s.setApiKey(cipher);
        s.setEnabled(enabled);
        s.setAllowPersonal(allowPersonal);
        s.setUpdatedBy(actorName);
        mapper.upsert(s);

        List<String> changed = new ArrayList<String>();
        if (saved == null) {
            changed.add("首次配置");
        } else {
            if (!Objects.equals(emptyToNull(saved.getProvider()), emptyToNull(provider))) {
                changed.add("服务商");
            }
            if (!Objects.equals(emptyToNull(AiProviders.baseUrlOr(saved.getProvider(), saved.getBaseUrl())),
                    emptyToNull(baseUrl))) {
                changed.add("接口地址");
            }
            if (!Objects.equals(emptyToNull(AiProviders.modelOr(saved.getProvider(), saved.getModel())),
                    emptyToNull(model))) {
                changed.add("模型");
            }
            if (Boolean.TRUE.equals(saved.getEnabled()) != enabled) {
                changed.add("总开关");
            }
            boolean savedAllowPersonal = !Boolean.FALSE.equals(saved.getAllowPersonal());
            if (savedAllowPersonal != allowPersonal) {
                changed.add("允许个人 Key");
            }
            if (Boolean.TRUE.equals(req.getClearKey())) {
                if (hasStoredKey(saved)) {
                    changed.add("API Key（已清空）");
                }
            } else if (req.getApiKey() != null && !req.getApiKey().trim().isEmpty()) {
                changed.add("API Key（已更新）");
            }
        }
        if (!changed.isEmpty()) {
            auditService.recordCurrent(null, "ai_shared_config_update", "ai_shared_setting",
                    SCOPE_PLATFORM, "团队 AI", true,
                    "修改团队 AI 配置：" + String.join("、", changed), null);
        }
        return view();
    }

    /** 用表单当前值测一次，不落库；apiKey 为空时用已保存的 Key。 */
    public Map<String, Object> test(SharedAiSettingsRequest req) {
        AiSharedSetting saved = findPlatform();
        String provider = req != null && req.getProvider() != null
                ? emptyToNull(req.getProvider())
                : (saved == null ? null : saved.getProvider());
        if (provider != null && AiProviders.get(provider) == null) {
            throw AppException.badRequest("不认识的厂商：" + provider);
        }
        String rawBase = req != null && req.getBaseUrl() != null
                ? req.getBaseUrl()
                : (saved == null ? null : saved.getBaseUrl());
        String baseUrl = AiProviders.baseUrlOr(provider, rawBase);
        String model = AiProviders.modelOr(provider,
                req != null && req.getModel() != null ? req.getModel()
                        : (saved == null ? null : saved.getModel()));
        validateBaseUrl(rawBase, provider);

        String cipher;
        if (req != null && req.getApiKey() != null && !req.getApiKey().trim().isEmpty()) {
            cipher = crypto.encrypt(req.getApiKey().trim());
        } else {
            cipher = saved == null ? null : saved.getApiKey();
        }
        String plain = crypto.decrypt(cipher);
        if (plain == null && !"ollama".equals(provider)) {
            throw AppException.badRequest(cipher == null || cipher.isEmpty()
                    ? "请先填写 API Key 再测试"
                    : "已保存的 Key 无法解密（部署密钥变更过），请重新填写");
        }

        AiConfig cfg = new AiConfig();
        cfg.setProvider(provider);
        cfg.setBaseUrl(baseUrl);
        cfg.setModel(model);
        cfg.setApiKey(plain);
        cfg.setSource("team");
        cfg.setSourceLabel("团队 AI");
        if (!cfg.usable()) {
            throw AppException.badRequest("配置不完整：请检查接口地址与模型名");
        }

        long t0 = System.currentTimeMillis();
        AiClient.Reply r = aiClient.chat(cfg,
                "你是连通性测试端点，不需要解释任何东西。", "只回复两个字：正常", false);
        Map<String, Object> m = new LinkedHashMap<String, Object>();
        m.put("ok", true);
        m.put("latencyMs", System.currentTimeMillis() - t0);
        m.put("model", r.model);
        m.put("reply", r.content == null ? "" : r.content.trim());
        m.put("tokens", r.promptTokens + r.completionTokens);
        m.put("source", "team");
        return m;
    }

    private void validateBaseUrl(String rawBase, String provider) {
        String custom = rawBase == null ? null : rawBase.trim();
        if (custom == null || custom.isEmpty()) {
            return;
        }
        try {
            OutboundUrlGuard.validate(custom, allowPrivateNetwork || "ollama".equals(provider));
        } catch (IllegalArgumentException e) {
            throw AppException.badRequest(e.getMessage());
        }
    }

    private static boolean hasStoredKey(AiSharedSetting s) {
        return s.getApiKey() != null && !s.getApiKey().isEmpty();
    }

    private static String emptyToNull(String s) {
        return s == null || s.trim().isEmpty() ? null : s.trim();
    }
}
