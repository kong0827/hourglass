package com.devstudio.kanban.entity;

import lombok.Data;

import java.time.LocalDate;

/**
 * 看板 meta / 到期计数的窄列投影：只读参与统计的字段，避免为拼 meta 加载整行任务。
 */
@Data
public class TaskFacetRow {

    private String owner;
    private String priority;
    private String category;
    private String reqId;
    private String boardColumn;
    private LocalDate dueDate;
    private String itemType;
    /** 影响版本ID（LEFT JOIN version_task，未绑定为 null） */
    private String versionId;
}
