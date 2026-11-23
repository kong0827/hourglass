package com.hourglass.entity;

import lombok.Data;

import java.time.LocalDateTime;

/** 发布准备逐项确认：一人一项一条；不外键到计划任务行，任务移出计划后仍可追溯。 */
@Data
public class ReleasePlanTaskCheck {
    private String workspaceId;
    private String planId;
    private String taskId;
    private String userId;
    /** ok / risk */
    private String state;
    private String note;
    private String scopeToken;
    private LocalDateTime plannedAtSnapshot;
    private LocalDateTime checkedAt;
}
