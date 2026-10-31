package com.devstudio.kanban.dto;

import lombok.Data;

import java.time.LocalDate;

/** 甘特负载：按时计人 × 周聚合的实际工时 */
@Data
public class UserWeekRow {

    private String userId;
    /** 该周周一 */
    private LocalDate weekStart;
    private Integer totalMinutes;
}
