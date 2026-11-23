package com.hourglass.entity;

import lombok.Data;

import java.time.LocalDateTime;

/** 交付说明快照的只读分享令牌：一份快照一个令牌，可撤销、可限下载。 */
@Data
public class DeliveryNoteShare {

    private String workspaceId;
    private String snapshotId;
    private String token;
    private Boolean allowDownload;
    /** BCrypt 哈希；空=打开链接无需密码 */
    private String passwordHash;
    /** 域名白名单，逗号分隔；空=不限制 */
    private String allowedDomains;
    /** 接收人页与打印水印；空=不加水印 */
    private String watermarkText;
    private Integer viewCount;
    private LocalDateTime createdAt;
    private LocalDateTime expiresAt;
}