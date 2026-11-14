package com.hourglass.entity;

import lombok.Data;

import java.time.LocalDate;

/**
 * 看板 meta / 到期计数的窄列投影：只读参与统计的字段，避免为拼 meta 加载整行任务。
 */
@Data
public class TaskFacetRow {

    private String owner;
    /** 测试负责人显示名快照；front-end 用它做筛选候选 */
    private String testOwner;
    private String priority;
    private String categoryId;
    private String reqId;
    private String boardColumn;
    private String processingRule;
    private LocalDate dueDate;
    private String itemType;
    private String id;
    private java.util.List<String> versionIds = new java.util.ArrayList<String>();
}
