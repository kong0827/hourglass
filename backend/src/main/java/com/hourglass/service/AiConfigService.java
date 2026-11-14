package com.hourglass.service;

import com.hourglass.common.AiClient;
import com.hourglass.common.AiCrypto;
import com.hourglass.common.AiProviders;
import com.hourglass.common.AppException;
import com.hourglass.common.OutboundUrlGuard;
import com.hourglass.dto.AiConfig;
import com.hourglass.dto.AiConfigRequest;
import com.hourglass.dto.AiConfigView;
import com.hourglass.dto.AiTeamView;
import com.hourglass.entity.AiSharedSetting;
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
 * AI 配置解析：团队共享 → 空间共享（预留）→ 个人。
 *
 * <p>个人配置仍在账号上（app_user.ai_*）；共享配置由管理员在 ai_shared_setting 维护。
 * 解析顺序里只有「是否配置并启用」，不看调用是否成功：团队 Key 失效时直接报错，
 * 不会静默改用个人 Key —— 否则账单和数据去向都变得不可解释。
 */
@Service
public class AiConfigService {

    private static final String PREF_PERSONAL = "personal";
    private static final String PREF_AUTO = "auto";

    private final UserMapper userMapper;
    private final AiCrypto crypto;
    private final AiClient aiClient;
    private final SharedAiSettingService sharedService;
    /** 账号凭证变更：审计只记改了哪些项，不写 Key 明文或密文 */
    private final AuditService auditService;
    @Value("${app.ai.allow-private-network:false}")
    private boolean allowPrivateNetwork;

    public AiConfigService(UserMapper userMapper, AiCrypto crypto, AiClient aiClient,
                           AuditService auditService, SharedAiSettingService sharedService) {
        this.userMapper = userMapper;
        this.crypto = crypto;
        this.aiClient = aiClient;
        this.auditService = auditService;
        this.sharedService = sharedService;
    }

    /**
     * 测试连通：用实际解析到的来源发一次极小的请求。
     * 这是唯一能在保存前确认"key 能用、地址对、模型名存在"的办法 —— 否则用户要等到第一次拆需求才知道配错了。
     */
    public Map<String, Object> test(String userId, String workspaceId) {
        AiConfig cfg = resolveForTest(userId, workspaceId);
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
        m.put("source", cfg.getSource());
        m.put("sourceLabel", cfg.getSourceLabel());
        return m;
    }

    /** 给前端看的视图：个人 Key 只给掩码，团队只给厂商 / 模型 / 状态。 */
    public AiConfigView view(String userId, String workspaceId) {
        AppUser u = requireUser(userId);
        AiSharedSetting wsRow = workspaceId == null
                ? null : sharedService.find(SharedAiSettingService.SCOPE_WORKSPACE, workspaceId);
        AiSharedSetting pfRow = sharedService.findPlatform();
        boolean allowPersonal = pfRow == null || !Boolean.FALSE.equals(pfRow.getAllowPersonal());
        String prefer = preferOf(u);

        AiConfigView v = new AiConfigView();
        v.setProvider(u.getAiProvider());
        v.setBaseUrl(AiProviders.baseUrlOr(u.getAiProvider(), u.getAiBaseUrl()));
        v.setModel(AiProviders.modelOr(u.getAiProvider(), u.getAiModel()));
        v.setEnabled(Boolean.TRUE.equals(u.getAiEnabled()));
        v.setPresets(AiProviders.all());
        v.setPrefer(prefer);
        v.setAllowPersonal(allowPersonal);

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

        AiSharedSetting effective = effectiveShared(wsRow, pfRow);
        AiSharedSetting shown = enabled(wsRow) ? wsRow : (enabled(pfRow) ? pfRow : null);
        /* Key 解不开时不能算「可用」：解析调用会报错，这里也必须如实显示未配置 */
        AiSharedSetting ready = effective != null && sharedService.decryptable(effective)
                ? effective : null;
        v.setTeam(teamView(ready, shown));
        applySource(v, u, prefer, allowPersonal, ready, shown != null && ready == null);
        v.setStatus(statusOf(v, u, prefer, allowPersonal, shown));
        return v;
    }

    private void applySource(AiConfigView v, AppUser u, String prefer, boolean allowPersonal,
                             AiSharedSetting effective, boolean sharedBlocked) {
        if (PREF_PERSONAL.equals(prefer) && allowPersonal) {
            v.setSource("personal");
            v.setSourceName("我的 API Key");
            return;
        }
        if (effective != null) {
            boolean workspace = SharedAiSettingService.SCOPE_WORKSPACE.equals(effective.getScope());
            v.setSource(workspace ? "workspace" : "team");
            v.setSourceName(sharedService.sourceLabel(effective.getScope()));
            return;
        }
        if (allowPersonal && personalComplete(u) && !sharedBlocked) {
            v.setSource("personal");
            v.setSourceName("我的 API Key");
            return;
        }
        v.setSource("none");
        v.setSourceName("未配置");
    }

    private AiTeamView teamView(AiSharedSetting effective, AiSharedSetting shown) {
        AiTeamView team = new AiTeamView();
        AiSharedSetting s = effective != null ? effective : shown;
        team.setAvailable(effective != null);
        if (s == null) {
            team.setScope(SharedAiSettingService.SCOPE_PLATFORM);
            team.setStatus("平台尚未开通团队 AI");
            return team;
        }
        team.setScope(s.getScope());
        team.setProvider(s.getProvider());
        team.setModel(AiProviders.modelOr(s.getProvider(), s.getModel()));
        if (effective != null) {
            team.setStatus(SharedAiSettingService.SCOPE_WORKSPACE.equals(s.getScope())
                    ? "由本空间管理员提供，费用由本空间承担"
                    : "由平台管理员提供，费用由团队承担");
        } else {
            team.setStatus(sharedService.blockedReason(s));
        }
        return team;
    }

    private String statusOf(AiConfigView v, AppUser u, String prefer, boolean allowPersonal,
                            AiSharedSetting shown) {
        String source = v.getSource();
        if ("team".equals(source) || "workspace".equals(source)) {
            return v.isEnabled()
                    ? "已就绪：调用走团队额度"
                    : SharedAiSettingService.SCOPE_WORKSPACE.equals(v.getTeam().getScope())
                    ? "本空间 AI 已就绪：打开开关即可使用"
                    : "团队 AI 已就绪：打开开关即可使用";
        }
        if ("personal".equals(source)) {
            if (v.isKeyBroken()) {
                return "已保存的 Key 无法解密（部署密钥变更过），请重新填写一次";
            }
            boolean noKeyOk = "ollama".equals(u.getAiProvider());
            if (!v.isHasKey() && !noKeyOk) {
                return "还没有配置 API Key，AI 功能不可用";
            }
            if (v.getBaseUrl() == null || v.getBaseUrl().isEmpty()
                    || v.getModel() == null || v.getModel().isEmpty()) {
                return "还缺接口地址或模型名";
            }
            if (!v.isEnabled()) {
                return "配置已保存，但 AI 总开关是关的";
            }
            return "已就绪：调用会走你自己的额度";
        }
        if (!allowPersonal && shown == null) {
            return "平台已关闭个人 API Key，且没有启用团队 AI，请联系平台管理员";
        }
        String blocked = shown == null ? null : sharedService.blockedReason(shown);
        if (blocked != null) {
            return blocked;
        }
        if (PREF_PERSONAL.equals(prefer) && allowPersonal) {
            return "你选择了「我的 API Key」，但配置不完整，请补全或切回团队 AI";
        }
        return "还没有可用的 AI：请联系平台管理员开通团队 AI，或在个人设置填写自己的 Key";
    }

    /** 保存个人配置（apiKey 为空表示不改，clearKey 才删）。 */
    public AiConfigView save(String userId, AiConfigRequest req, String workspaceId) {
        AppUser u = requireUser(userId);
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
        String prefer = req.getPrefer() == null ? u.getAiPrefer() : normalizePrefer(req.getPrefer());

        userMapper.updateAiConfig(userId, emptyToNull(provider), emptyToNull(baseUrl),
                emptyToNull(model), cipher, enabled, prefer);

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
        if (!Objects.equals(preferOf(u), prefer == null ? PREF_AUTO : prefer)) {
            changed.add("来源偏好");
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
        return view(userId, workspaceId);
    }

    /**
     * 内部取用：按 空间 → 平台 → 个人 解析并解密。
     * 任何 AI 调用前都必须过这里 —— 保证"没配就是没配"，不会静默用别人的额度，
     * 团队 Key 失效时也不会偷偷改用个人 Key。
     */
    public AiConfig resolve(String userId, String workspaceId) {
        AppUser u = requireUser(userId);
        if (!Boolean.TRUE.equals(u.getAiEnabled())) {
            AiSharedSetting wsRow = workspaceId == null
                    ? null : sharedService.find(SharedAiSettingService.SCOPE_WORKSPACE, workspaceId);
            AiSharedSetting pfRow = sharedService.findPlatform();
            boolean anyConfigured = personalComplete(u) || effectiveShared(wsRow, pfRow) != null
                    || enabled(wsRow) || enabled(pfRow);
            throw AppException.badRequest(anyConfigured
                    ? "你的 AI 开关是关的，请先在「个人设置 → AI 设置」里打开"
                    : "你还没配置 AI：请先在「个人设置 → AI 设置」里选模型、填 API Key 并打开开关");
        }
        return resolveIgnoringSwitch(u, workspaceId);
    }

    /** 不看总开关的取用（「测试连接」要用：还没启用也得能测通再决定启用） */
    public AiConfig resolveForTest(String userId, String workspaceId) {
        return resolveIgnoringSwitch(requireUser(userId), workspaceId);
    }

    private AiConfig resolveIgnoringSwitch(AppUser u, String workspaceId) {
        AiSharedSetting wsRow = workspaceId == null
                ? null : sharedService.find(SharedAiSettingService.SCOPE_WORKSPACE, workspaceId);
        AiSharedSetting pfRow = sharedService.findPlatform();
        boolean allowPersonal = pfRow == null || !Boolean.FALSE.equals(pfRow.getAllowPersonal());
        AiSharedSetting effective = effectiveShared(wsRow, pfRow);
        String prefer = preferOf(u);

        if (PREF_PERSONAL.equals(prefer) && allowPersonal) {
            if (personalComplete(u)) {
                return personalConfig(u);
            }
            throw AppException.badRequest("你选择了「我的 API Key」，但配置不完整，请补全或切回团队 AI");
        }
        if (effective != null) {
            return sharedService.toConfig(effective);
        }
        /* 管理员启用了团队 AI 但配置不完整：直接报给成员，不偷偷回落到个人 Key ——
           否则管理员以为全员走团队额度，实际只有配了个人 Key 的人在花钱。 */
        if (enabled(wsRow) || enabled(pfRow)) {
            throw AppException.badRequest("团队 AI 配置不完整，请联系平台管理员");
        }
        if (allowPersonal && personalComplete(u)) {
            return personalConfig(u);
        }
        if (!allowPersonal) {
            throw AppException.badRequest("平台已关闭个人 API Key，且没有启用团队 AI，请联系平台管理员");
        }
        throw AppException.badRequest(
                "还没有可用的 AI：请联系平台管理员开通团队 AI，或在个人设置填写自己的 Key");
    }

    /** 已启用且可用的共享配置；空间行优先于平台行（P1 预留）。 */
    private AiSharedSetting effectiveShared(AiSharedSetting wsRow, AiSharedSetting pfRow) {
        if (sharedService.usable(wsRow)) {
            return wsRow;
        }
        return sharedService.usable(pfRow) ? pfRow : null;
    }

    private static boolean enabled(AiSharedSetting s) {
        return s != null && Boolean.TRUE.equals(s.getEnabled());
    }

    private static boolean personalComplete(AppUser u) {
        String baseUrl = AiProviders.baseUrlOr(u.getAiProvider(), u.getAiBaseUrl());
        String model = AiProviders.modelOr(u.getAiProvider(), u.getAiModel());
        boolean noKeyOk = "ollama".equals(u.getAiProvider());
        return baseUrl != null && model != null
                && (noKeyOk || (u.getAiApiKey() != null && !u.getAiApiKey().isEmpty()));
    }

    private AiConfig personalConfig(AppUser u) {
        AiConfig c = new AiConfig();
        c.setProvider(u.getAiProvider());
        c.setBaseUrl(AiProviders.baseUrlOr(u.getAiProvider(), u.getAiBaseUrl()));
        c.setModel(AiProviders.modelOr(u.getAiProvider(), u.getAiModel()));
        c.setSource("personal");
        c.setSourceLabel("我的 API Key");
        String plain = crypto.decrypt(u.getAiApiKey());
        if (plain == null && !"ollama".equals(u.getAiProvider())) {
            throw AppException.badRequest(
                    "还没有配置 API Key（或已保存的 Key 无法解密），请到「个人设置 → AI 设置」重新填写");
        }
        c.setApiKey(plain);
        if (!c.usable()) {
            throw AppException.badRequest("AI 配置不完整：请检查接口地址与模型名");
        }
        return c;
    }

    private AppUser requireUser(String userId) {
        AppUser u = userMapper.selectById(userId);
        if (u == null) {
            throw AppException.notFound("账号不存在");
        }
        return u;
    }

    private static String preferOf(AppUser u) {
        return PREF_PERSONAL.equals(u.getAiPrefer()) ? PREF_PERSONAL : PREF_AUTO;
    }

    private static String normalizePrefer(String raw) {
        String p = raw == null ? "" : raw.trim();
        if (p.isEmpty() || PREF_AUTO.equals(p)) {
            return null;
        }
        if (PREF_PERSONAL.equals(p)) {
            return PREF_PERSONAL;
        }
        throw AppException.badRequest("来源偏好只能是 auto 或 personal");
    }

    private static String emptyToNull(String s) {
        return s == null || s.trim().isEmpty() ? null : s.trim();
    }
}
