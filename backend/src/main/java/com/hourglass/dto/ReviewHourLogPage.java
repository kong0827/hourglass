package com.hourglass.dto;

import lombok.Data;

import java.util.List;

/** 周回顾工时下钻分页：合计与行数取全量汇总，明细按页下发。 */
@Data
public class ReviewHourLogPage {

    private int weekOffset;
    private String weekStart;
    private String weekEnd;
    private int total;
    private int offset;
    private int limit;
    private boolean hasMore;
    private int totalMinutes;
    private List<ReviewHourLog> items;
}
