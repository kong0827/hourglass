package com.hourglass.dto;

import lombok.Data;

import java.time.LocalDateTime;

/** 创建令牌的响应：token 字段只出现这一次 */
@Data
public class ApiTokenCreated {

    private String id;
    private String name;
    /** 完整令牌，仅创建响应返回 */
    private String token;
    private String prefix;
    private String scope;
    private LocalDateTime expiresAt;
}