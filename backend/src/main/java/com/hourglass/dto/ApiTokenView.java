package com.hourglass.dto;

import lombok.Data;

import java.time.LocalDateTime;

/** 令牌列表视图：不含令牌本身，可安全返回给前端 */
@Data
public class ApiTokenView {

    private String id;
    private String name;
    private String prefix;
    private String scope;
    private LocalDateTime expiresAt;
    private LocalDateTime lastUsedAt;
    private LocalDateTime revokedAt;
    private LocalDateTime createdAt;
}