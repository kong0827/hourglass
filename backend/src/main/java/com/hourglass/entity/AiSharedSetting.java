package com.hourglass.entity;

import com.fasterxml.jackson.annotation.JsonIgnore;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * 团队 / 空间共享 AI 配置。
 *
 * <p>一行一个作用域：P0 只用 scope=platform（scope_id 固定 0），
 * scope=workspace 预留给后续空间级覆盖。api_key 为 AES-GCM 密文，绝不能经接口返回。
 */
@Data
public class AiSharedSetting {

    private Long id;
    /** platform / workspace */
    private String scope;
    /** platform 固定为 0；workspace 存空间 ID */
    private String scopeId;
    private String provider;
    private String baseUrl;
    private String model;
    @JsonIgnore
    private String apiKey;
    private Boolean enabled;
    /** 是否允许成员改用个人 Key（仅 platform 行生效） */
    private Boolean allowPersonal;
    /** 最近修改人显示名 */
    private String updatedBy;
    private LocalDateTime updatedAt;
}
