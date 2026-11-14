package com.hourglass.dto;

import lombok.Data;

/** 一次 AI 调用用的配置（已解密，只在 service 内部流转，不落日志） */
@Data
public class AiConfig {

    private String provider;
    private String baseUrl;
    private String model;
    private String apiKey;
    /** 实际来源：team / workspace / personal */
    private String source;
    /** 来源展示名：团队 AI / 本空间 AI / 我的 API Key */
    private String sourceLabel;

    public boolean shared() {
        return "team".equals(source) || "workspace".equals(source);
    }

    /** 用量标签：让用户知道这次消耗的是团队额度还是自己的额度 */
    public String usageLabel() {
        return shared() ? "团队额度" : "我的额度";
    }

    /** 配置是否够用（ollama 允许空 key） */
    public boolean usable() {
        boolean noKeyOk = "ollama".equals(provider);
        return baseUrl != null && !baseUrl.isEmpty()
                && model != null && !model.isEmpty()
                && (noKeyOk || (apiKey != null && !apiKey.isEmpty()));
    }
}
