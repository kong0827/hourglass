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
    private Integer viewCount;
    private LocalDateTime createdAt;
    private LocalDateTime expiresAt;
}