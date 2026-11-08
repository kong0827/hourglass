package com.hourglass.dto;

import lombok.Data;

import java.time.LocalDate;
import java.time.LocalDateTime;

/** 计划列表/详情视图：计划本体 + 圈选与执行汇总（SQL 聚合一次带回）。 */
@Data
public class TestPlanView {

    private String id;
    private String workspaceId;
    private String reqId;
    private String name;
    private String versionId;
    private String versionName;
    private LocalDate plannedStart;
    private LocalDate plannedEnd;
    /** draft/running/done */
    private String status;
    private String note;
    private String createdBy;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    private int caseCount;
    private int executedCount;
    private int passedCount;
    private int failedCount;
    private int blockedCount;
    /** 计划内批量执行后转出缺陷的流水数（口径：test_case_run.plan_id 且 bug_task_id 非空） */
    private int defectCount;
}
