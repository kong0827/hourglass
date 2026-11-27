package com.hourglass.entity;

import lombok.Data;

import java.time.LocalDateTime;

/** 文档级只读分享令牌（每文档一个，可重置/撤销） */
@Data
public class ReqDocShare {

    private String workspaceId;
    private String docId;
    private String token;
    private LocalDateTime createdAt;
    private LocalDateTime expiresAt;
    /** 1=允许复制与打印 / 0=仅在线阅读；NULL 按允许处理（兼容旧链接） */
    private Boolean allowCopy;
}
