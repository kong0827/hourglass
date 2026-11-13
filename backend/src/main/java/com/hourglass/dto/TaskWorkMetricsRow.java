package com.hourglass.dto;

import lombok.Data;

import java.time.LocalDate;

/** 列状态工作页的聚合行：一次扫描按条件求和，不把明细拉到内存 */
@Data
public class TaskWorkMetricsRow {

    private int cnt;
    private int overdue;
    private int blocked;
    /** P0 / P1 */
    private int high;
    private int noDue;
    private int lateCompleted;
    private int withDue;
    private int onTime;
    private long estimateMinutes;
    /** 未完成列取「创建到今天」，已完成列取「创建到完成」 */
    private Double avgAgeDays;
    private LocalDate lastCompletedAt;
}
