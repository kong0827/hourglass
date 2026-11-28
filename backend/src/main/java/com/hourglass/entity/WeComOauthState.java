package com.hourglass.entity;

import lombok.Data;

import java.time.LocalDateTime;

/** 企微 OAuth 一次性 state；回调时原子消费。 */
@Data
public class WeComOauthState {

    private String state;
    /** login/bind */
    private String purpose;
    private String corpId;
    /** bind 用途：发起绑定的本地账号 */
    private String userId;
    private String target;
    private String workspaceId;
    private LocalDateTime expiresAt;
    private LocalDateTime consumedAt;
    private String clientIp;
    private LocalDateTime createdAt;
}