package com.hourglass.dto;

import lombok.Data;

/** 周回顾工时下钻的汇总：行数与合计分钟，由 SQL 与明细同口径算出。 */
@Data
public class ReviewHourLogSummary {

    private int total;
    private int totalMinutes;
}
