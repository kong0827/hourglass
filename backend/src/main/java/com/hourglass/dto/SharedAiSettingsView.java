package com.hourglass.dto;

import com.hourglass.common.AiProviders;
import lombok.Data;

import java.util.List;

/** 平台管理员看到的团队 AI 配置；Key 只回掩码。 */
@Data
public class SharedAiSettingsView {

    private boolean enabled;
    private String provider;
    private String baseUrl;
    private String model;
    private boolean hasKey;
    /** 形如 sk-****a1b2，没配过为 null */
    private String apiKeyMasked;
    /** 密钥解不开时为 true：提示管理员重填（换过部署密钥会出现） */
    private boolean keyBroken;
    private boolean allowPersonal;
    /** 一句话说明当前状态 */
    private String status;
    private String updatedBy;
    private String updatedAt;
    /** 可选厂商清单，由后端下发，前端不硬编码 */
    private List<AiProviders.Preset> presets;
}
