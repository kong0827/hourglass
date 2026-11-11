package com.hourglass.service;

import com.hourglass.common.AiClient;
import com.hourglass.common.AiCrypto;
import com.hourglass.common.AiProviders;
import com.hourglass.common.AppException;
import com.hourglass.common.OutboundUrlGuard;
import com.hourglass.dto.AiConfig;
import com.hourglass.dto.AiConfigRequest;
import com.hourglass.dto.AiConfigView;
import com.hourglass.entity.AppUser;
import com.hourglass.mapper.UserMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * 每个账号自己的 AI 配置（厂商 / 地址 / 模型 / Key）。
 *
 * <p>放在账号级而不是空间级：额度是按人买的，换空间不该让他重填。
 * 共享空间里每个人的 AI 调用各走各的额度，互不影响。
 */
@Service
public class AiConfigService {

    private final UserMapper userMapper;
    private final AiCrypto crypto;
    private final AiClient aiClient;
    /** 账号凭证变更：审计只记改了哪些项，不写 Key 明文或密文 */
    private final AuditService auditService;
    @Value("${app.ai.allow-private-network:false}")
    private boolean allowPrivateNetwork;

    public AiConfigService(UserMapper userMapper, AiCrypto crypto, AiClient aiClient, AuditService auditService) {
        this.userMapper = userMapper;
        this.crypto = crypto;
        this.aiClient = aiClient;
        this.auditService = auditService;
    }

    /**
     * 测试连通：用真实配置发一次极小的请求。
     * 这是唯一能在保存前确认"key 能用、地址对、模型名存在"的办法 —— 否则用户要等到第一次拆需求才知道配错了。
     */
    public Map<String, Object> test(String userId) {
        AiConfig cfg = resolveForTest(userId);
        long t0 = System.currentTimeMillis();
        AiClient.Reply r = aiClient.chat(cfg,
                "你是连通性测试端点，不需要解释任何东西。", "只回复两个字：正常", false);
        long ms = System.currentTimeMillis() - t0;
        Map<String, Object> m = new LinkedHashMap<String, Object>();
        m.put("ok", true);
        m.put("latencyMs", ms);
        m.put("model", r.model);
        m.put("reply", r.content == null ? "" : r.content.trim());
        m.put("tokens", r.promptTokens + r.completionTokens);
        return m;
    }

    /** 给前端看的视图（key 只给掩码） */
    public AiConfigView view(String userId) {
        AppUser u = userMapper.selectById(userId);
        if (u == null) {
            throw AppException.notFound("账号不存在");
        }
        AiConfigView v = new AiConfigView();
        v.setProvider(u.getAiProvider());
        v.setBaseUrl(AiProviders.baseUrlOr(u.getAiProvider(), u.getAiBaseUrl()));
        v.setModel(AiProviders.modelOr(u.getAiProvider(), u.getAiModel()));
        v.setEnabled(Boolean.TRUE.equals(u.getAiEnabled()));
        v.setPresets(AiProviders.all());

        boolean hasStored = u.getAiApiKey() != null && !u.getAiApiKey().isEmpty();
        if (hasStored) {
            String plain = crypto.decrypt(u.getAiApiKey());
            if (plain == null) {
                /* 换过部署密钥：密文还在但解不开。不隐瞒，直接让用户重填 */
                v.setHasKey(false);
                v.setKeyBroken(true);
            } else {
                v.setHasKey(true);
                v.setApiKeyMasked(AiCrypto.mask(plain));
            }
        }
        v.setStatus(statusOf(v, u));
        return v;
    }

    private String statusOf(AiConfigView v, AppUser u) {
        if (v.isKeyBroken()) {
            return "已保存的 Key 无法解密（部署密钥变更过），请重新填写一次";
        }
        boolean noKeyOk = "ollama".equals(u.getAiProvider());
        if (!v.isHasKey() && !noKeyOk) {
            return "还没有配置 API Key，AI 功能不可用";
        }
        if (v.getBaseUrl() == null || v.getBaseUrl().isEmpty() || v.getModel() == null || v.getModel().isEmpty()) {
            return "还缺接口地址或模型名";
        }
        if (!v.isEnabled()) {
            return "配置已保存，但 AI 总开关是关的";
        }
        return "已就绪：调用会走你自己的额度";
    }

    /** 保存（apiKey 为空表示不改，clearKey 才删） */
    public AiConfigView save(String userId, AiConfigRequest req) {
        AppUser u = userMapper.selectById(userId);
        if (u == null) {
            throw AppException.notFound("账号不存在");
        }
        String provider = req.getProvider() == null ? null : req.getProvider().trim();
        if (provider != null && !provider.isEmpty() && AiProviders.get(provider) == null) {
            throw AppException.badRequest("不认识的厂商：" + provider);
        }

        String baseUrl = AiProviders.baseUrlOr(provider, req.getBaseUrl());
        String model = AiProviders.modelOr(provider, req.getModel());
        /* 只校验用户显式填写的地址；厂商预设地址是代码内常量，不因 DNS 抖动阻止保存 */
        String customBase = req.getBaseUrl() == null ? null : req.getBaseUrl().trim();
        if (customBase != null && !customBase.isEmpty()) {
            try {
                OutboundUrlGuard.validate(customBase, allowPrivateNetwork || "ollama".equals(provider));
            } catch (IllegalArgumentException e) {
                throw AppException.badRequest(e.getMessage());
            }
        }

        String cipher;
        if (Boolean.TRUE.equals(req.getClearKey())) {
            cipher = null;
        } else if (req.getApiKey() != null && !req.getApiKey().trim().isEmpty()) {
            cipher = crypto.encrypt(req.getApiKey().trim());
        } else {
            cipher = u.getAiApiKey();
        }

        boolean enabled = req.getEnabled() == null
                ? Boolean.TRUE.equals(u.getAiEnabled())
                : req.getEnabled();

        userMapper.updateAiConfig(userId, emptyToNull(provider), emptyToNull(baseUrl),
                emptyToNull(model), cipher, enabled);

        List<String> changed = new ArrayList<String>();
        if (!Objects.equals(emptyToNull(u.getAiProvider()), emptyToNull(provider))) {
            changed.add("服务商");
        }
        if (!Objects.equals(emptyToNull(AiProviders.baseUrlOr(u.getAiProvider(), u.getAiBaseUrl())),
                emptyToNull(baseUrl))) {
            changed.add("接口地址");
        }
        if (!Objects.equals(emptyToNull(AiProviders.modelOr(u.getAiProvider(), u.getAiModel())),
                emptyToNull(model))) {
            changed.add("模型");
        }
        if (Boolean.TRUE.equals(u.getAiEnabled()) != enabled) {
            changed.add("总开关");
        }
        if (Boolean.TRUE.equals(req.getClearKey())) {
            if (u.getAiApiKey() != null && !u.getAiApiKey().isEmpty()) {
                changed.add("API Key（已清空）");
            }
        } else if (req.getApiKey() != null && !req.getApiKey().trim().isEmpty()) {
            changed.add("API Key（已更新）");
        }
        if (!changed.isEmpty()) {
            auditService.recordCurrent(null, "ai_config_update", "user", userId, u.getUsername(), true,
                    "修改 AI 配置：" + String.join("、", changed), null);
        }
        return view(userId);
    }

    /**
     * 内部取用：解密后的完整配置。
     * 任何 AI 调用前都必须过这里 —— 保证"没配就是没配"，不会静默用别人的额度。
     */
    public AiConfig resolve(String userId) {
        AppUser u = userMapper.selectById(userId);
        if (u == null) {
            throw AppException.notFound("账号不存在");
        }
        if (!Boolean.TRUE.equals(u.getAiEnabled())) {
            boolean neverConfigured = u.getAiProvider() == null && u.getAiApiKey() == null;
            throw AppException.badRequest(neverConfigured
                    ? "你还没配置 AI：请先在「个人设置 → AI 设置」里选模型、填 API Key 并打开开关"
                    : "你的 AI 开关是关的，请先在「个人设置 → AI 设置」里打开");
        }
        return resolveRaw(u);
    }

    /** 不看总开关的取用（「测试连接」要用：还没启用也得能测通再决定启用） */
    public AiConfig resolveForTest(String userId) {
        AppUser u = userMapper.selectById(userId);
        if (u == null) {
            throw AppException.notFound("账号不存在");
        }
        return resolveRaw(u);
    }

    private AiConfig resolveRaw(AppUser u) {
        AiConfig c = new AiConfig();
        c.setProvider(u.getAiProvider());
        c.setBaseUrl(AiProviders.baseUrlOr(u.getAiProvider(), u.getAiBaseUrl()));
        c.setModel(AiProviders.modelOr(u.getAiProvider(), u.getAiModel()));
        String plain = crypto.decrypt(u.getAiApiKey());
        if (plain == null && !"ollama".equals(u.getAiProvider())) {
            throw AppException.badRequest("还没有配置 API Key（或已保存的 Key 无法解密），请到「个人设置 → AI 设置」重新填写");
        }
        c.setApiKey(plain);
        if (!c.usable()) {
            throw AppException.badRequest("AI 配置不完整：请检查接口地址与模型名");
        }
        return c;
    }

    private static String emptyToNull(String s) {
        return s == null || s.trim().isEmpty() ? null : s.trim();
    }
}
