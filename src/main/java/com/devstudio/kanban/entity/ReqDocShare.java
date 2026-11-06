package com.devstudio.kanban.entity;

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
}
