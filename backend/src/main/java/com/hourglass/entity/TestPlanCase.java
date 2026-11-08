package com.hourglass.entity;

import lombok.Data;

import java.time.LocalDateTime;

/** 测试计划圈选的用例：计划内最近结果回写在此，用例全局最近结果仍走 test_case。 */
@Data
public class TestPlanCase {

    private String id;
    private String planId;
    private String caseId;
    /** passed/failed/blocked，空=计划内未执行 */
    private String result;
    private String note;
    private String executedBy;
    private String executedByUserId;
    private LocalDateTime executedAt;
    private LocalDateTime createdAt;
}
