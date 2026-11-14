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
    private Integer viewCount;
    private LocalDateTime createdAt;
    private LocalDateTime expiresAt;
}