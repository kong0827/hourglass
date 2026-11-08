package com.hourglass.dto;

import lombok.Data;

import java.time.LocalDateTime;

/** 计划详情的用例行：圈选状态 + 用例本体关键信息。 */
@Data
public class TestPlanCaseView {

    private String id;          // test_plan_case.id
    private String planId;
    private String caseId;
    private String result;      // 计划内最近结果，空=未执行
    private String note;
    private String executedBy;
    private LocalDateTime executedAt;

    private String title;
    private String module;
    private String priority;
    private String demandId;
    /** 用例全局最近结果（与计划内结果可能不同轮，列表并列展示） */
    private String latestStatus;
    private String latestBugTaskId;
}
