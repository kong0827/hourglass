package com.devstudio.kanban.entity;

import lombok.Data;

import java.time.LocalDateTime;

/** 空间级甘特图只读分享令牌 */
@Data
public class GanttShare {

    private String workspaceId;
    private String token;
    private LocalDateTime createdAt;
    private LocalDateTime expiresAt;
}
