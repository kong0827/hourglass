package com.hourglass.dto;

import lombok.Data;

import javax.validation.constraints.Size;

/**
 * 保存 AI 配置。
 *
 * <p>apiKey 的三种语义（前端据此决定怎么传）：
 * <ul>
 *   <li>有值 → 用新 key 覆盖</li>
 *   <li>空 + clearKey=false → <b>保持原值不变</b>（用户只改模型名时不该把 key 清掉）</li>
 *   <li>空 + clearKey=true → 删除已存的 key</li>
 * </ul>
 */
@Data
public class AiConfigRequest {

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
}
