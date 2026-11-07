package com.hourglass.dto;

import lombok.Data;

import java.time.LocalDate;

/** 阶段统计用：项目内工时按「计时人 × 自然日」的一行聚合 */
@Data
public class UserDayRow {

    private String userId;
    private LocalDate day;
    private Integer totalMinutes;
}
