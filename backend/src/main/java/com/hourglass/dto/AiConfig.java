package com.hourglass.dto;

import lombok.Data;

/** 一次 AI 调用用的配置（已解密，只在 service 内部流转，不落日志） */
@Data
public class AiConfig {

    private String provider;
    private String baseUrl;
    private String model;
    private String apiKey;

    /** 配置是否够用（ollama 允许空 key） */
    public boolean usable() {
        boolean noKeyOk = "ollama".equals(provider);
        return baseUrl != null && !baseUrl.isEmpty()
                && model != null && !model.isEmpty()
                && (noKeyOk || (apiKey != null && !apiKey.isEmpty()));
    }
}
