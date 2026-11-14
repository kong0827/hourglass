package com.hourglass.dto;

import lombok.Data;

import javax.validation.constraints.Size;

/**
 * 保存 / 测试团队 AI 配置。
 *
 * <p>apiKey 语义与个人配置一致：有值=覆盖，空=保持原值，空且 clearKey=true=清除。
 * 测试接口用表单当前值，不落库。
 */
@Data
public class SharedAiSettingsRequest {

    @Size(max = 24, message = "厂商标识不合法")
    private String provider;

    @Size(max = 255, message = "接口地址太长")
    private String baseUrl;

    @Size(max = 64, message = "模型名太长")
    private String model;

    @Size(max = 256, message = "API Key 太长")
    private String apiKey;

    private Boolean clearKey;

    private Boolean enabled;

    private Boolean allowPersonal;
}
