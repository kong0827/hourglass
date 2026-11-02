package com.devstudio.kanban.dto;

import lombok.Data;

import java.time.LocalDateTime;

/** 项目最后活动时间（task/task_log/task_comment/requirement_doc 聚合）。 */
@Data
public class ManagementActivityRow {
    private String reqId;
    private LocalDateTime lastAt;
}
