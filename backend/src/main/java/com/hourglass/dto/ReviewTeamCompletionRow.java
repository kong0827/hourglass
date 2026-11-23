package com.hourglass.dto;

import lombok.Data;

import java.time.LocalDateTime;

/** 本周完成工作项：完成列表比通用明细多带工时、耗时与发布态。 */
@Data
public class ReviewTeamCompletionRow {
    private String taskId;
    private String title;
    private String type;
    private String projectName;
    private String demandTitle;
    private LocalDateTime at;
    private java.time.LocalDate dueDate;
    private Integer minutes;
    private Integer durationDays;
    private Integer onTime;
    private Integer released;
}
