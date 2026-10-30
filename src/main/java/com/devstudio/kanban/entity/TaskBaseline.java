package com.devstudio.kanban.entity;

import lombok.Data;

import java.time.LocalDate;
import java.time.LocalDateTime;

/** 甘特图基线：某空间某任务在快照时刻的计划起止 */
@Data
public class TaskBaseline {

    private String workspaceId;
    private String taskId;
    private LocalDate startDate;
    private LocalDate dueDate;
    private LocalDateTime capturedAt;
}
