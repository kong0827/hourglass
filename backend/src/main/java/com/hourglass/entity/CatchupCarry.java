package com.hourglass.entity;

import lombok.Data;

import java.time.LocalDate;
import java.time.LocalDateTime;

/** 补记承接：本周未处理/跳过的工作项，下周草稿继续列出。 */
@Data
public class CatchupCarry {

    private Long id;
    private String fromSessionId;
    private LocalDate toWeekStart;
    private String taskId;
    private Integer itemNo;
    private String title;
    private String projectName;
    private String typeLabel;
    private String statusLabel;
    private Integer minutes;
    /** pending / skipped */
    private String reason;
    private LocalDateTime createdAt;
}
