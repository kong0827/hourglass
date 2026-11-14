package com.hourglass.dto;

import com.hourglass.common.AiProviders;
import lombok.Data;

import java.util.List;

/**
 * 返回给前端的 AI 配置视图。
 * <b>绝不含明文 key</b> —— 只有掩码和"有没有配过"的布尔值。
 */
@Data
public class AiConfigView {

    private String provider;
    private String baseUrl;
    private String model;
    private boolean hasKey;
    /** 形如 sk-****a1b2，没配过为 null */
    private String apiKeyMasked;
    private boolean enabled;
    /** 密钥解不开时为 true：提示用户重填（换过部署密钥会出现） */
    private boolean keyBroken;
    /** 可选厂商清单，由后端下发，前端不硬编码 */
    private List<AiProviders.Preset> presets;
    /** 一句话说明当前能不能用 */
    private String status;
    /** 来源偏好：auto / personal */
    private String prefer;
    /** 解析后的实际来源：team / workspace / personal / none */
    private String source;
    /** 实际来源展示名：团队 AI / 本空间 AI / 我的 API Key / 未配置 */
    private String sourceName;
    /** 平台是否允许成员改用个人 Key */
    private boolean allowPersonal;
    /** 共享 AI 的只读信息（团队成员看不到 Key 与掩码） */
    private AiTeamView team;
}
