package com.hourglass.dto;

import lombok.Data;

import java.time.LocalDateTime;

/** 任务最近一次进入阻塞的时间（来自 task_log），用于手机风险列表展示阻塞时长。 */
@Data
public class TaskBlockedAt {

    private String taskId;
    private LocalDateTime blockedAt;
}
