package com.hourglass.entity;

import lombok.Data;

import java.time.LocalDateTime;

/** 应用内通知（N-1：不依赖外部 IM 的定向提醒） */
@Data
public class AppNotification {

    private Long id;
    private String userId;
    private String workspaceId;
    /** task_remind / task_due / task_assigned / task_comment */
    private String type;
    private String title;
    private String body;
    private String refTaskId;
    private LocalDateTime readAt;
    private LocalDateTime createdAt;

    /** 非表字段：来源空间名 */
    private String workspaceName;
}
