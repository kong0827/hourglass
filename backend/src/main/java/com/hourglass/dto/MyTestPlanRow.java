package com.hourglass.dto;

import lombok.Data;

import java.time.LocalDate;
import java.time.LocalDateTime;

/**
 * 「我的工作 → 待我执行」的一行：指派给我的测试计划 + 执行汇总。
 * 只放排队决策需要的字段，详情仍由测试计划详情接口提供。
 */
@Data
public class MyTestPlanRow {

    private String id;
    private String name;
    private String reqId;
    private String reqName;
    private String versionName;
    private String status;
    private LocalDate plannedStart;
    private LocalDate plannedEnd;
    private int caseCount;
    private int executedCount;
    private int passedCount;
    private int failedCount;
    private int blockedCount;
    private int skippedCount;
    private LocalDateTime createdAt;
}
