package com.hourglass.dto;

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
    /** 目标列的处理规则：公开页据此判断「执行结束」列不计逾期 */
    private String processingRule;
    private LocalDate startDate;
    private LocalDate dueDate;
    private Integer progress;
    private Boolean isMilestone;
    private Boolean blocked;
    private Integer estimateMinutes;
    private Integer totalMinutes;
}
