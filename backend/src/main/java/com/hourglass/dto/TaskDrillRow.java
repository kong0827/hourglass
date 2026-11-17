package com.hourglass.dto;

import lombok.Data;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

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
    private LocalDateTime completedAt;
    /* 发布事实投影：与管理页/工作页明细同一口径，前端据此渲染发布徽标 */
    private LocalDate publishedAt;
    private Boolean everPublished;
    private String publicationState;
    private List<String> publicationTargets;
    private Boolean manualPublished;
    private LocalDate manualPublishedAt;
}
