package com.hourglass.dto;

import lombok.Data;

import java.time.LocalDateTime;

/** 交付说明快照分享：编制侧看到的令牌与访问统计。 */
@Data
public class DeliveryShareResponse {

    private String snapshotId;
    private String docNo;
    private String token;
    private Boolean allowDownload;
    private Boolean passwordRequired;
    /** 域名白名单（原样回显，便于分享者确认） */
    private String allowedDomains;
    private String watermarkText;
    private Integer viewCount;
    /** 近 7 天成功打开次数 */
    private Integer visits7d;
    private LocalDateTime lastViewedAt;
    private LocalDateTime createdAt;
    private LocalDateTime expiresAt;
}