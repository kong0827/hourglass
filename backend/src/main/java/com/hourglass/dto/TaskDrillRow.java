package com.hourglass.dto;

import lombok.Data;

import java.time.LocalDate;

/** 下钻弹层的一行工作项，字段名称与前端 openTaskTable 的读取口径一致。 */
@Data
public class TaskDrillRow {

    private String id;
    private String title;
    private String itemType;
    private String owner;
    private String boardColumn;
    private LocalDate dueDate;
    private Integer estimateMinutes;
    private Integer totalMinutes;
    private String reqName;
    private LocalDate completedAt;
}
