package com.devstudio.kanban.dto;

import lombok.Data;

import java.time.LocalDate;

/**
 * 公开分享用的任务白名单。
 * 只暴露时间轴必须的字段：以后给 Task 加字段不会自动泄露到公开链接。
 */
@Data
public class PublicGanttTask {

    private String id;
    private String title;
    private String priority;
    private String owner;
    private String boardColumn;
    private LocalDate startDate;
    private LocalDate dueDate;
    private Integer progress;
    private Boolean isMilestone;
    private Boolean blocked;
    private Integer estimateMinutes;
    private Integer totalMinutes;
}
