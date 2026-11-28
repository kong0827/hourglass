package com.hourglass.entity;

import com.fasterxml.jackson.annotation.JsonIgnore;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * 对外 API 个人访问令牌。
 *
 * <p>只存 SHA-256 哈希，明文只在创建响应里出现一次；epoch 绑定账号会话代次，
 * 密码 / 角色变更后旧令牌失效。
 */
@Data
public class ApiToken {

    private String id;
    private String userId;
    private String name;
    /** 展示前缀，如 hg_9f3a2c1b */
    private String prefix;
    @JsonIgnore
    private String tokenHash;
    /** read / write */
    private String scope;
    /** 签发时 app_user.session_version */
    private Long epoch;
    private LocalDateTime expiresAt;
    private LocalDateTime lastUsedAt;
    private LocalDateTime revokedAt;
    private LocalDateTime createdAt;
    private String createdIp;
}