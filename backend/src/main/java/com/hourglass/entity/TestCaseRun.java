package com.hourglass.entity;

import lombok.Data;

import java.time.LocalDateTime;

/** 用例执行流水：每次执行一行，最近一轮结果冗余在 test_case。 */
@Data
public class TestCaseRun {

    private String id;
    private String caseId;
    private String workspaceId;
    /** passed / failed / blocked */
    private String status;
    private String note;
    /** 由本次失败转出的缺陷任务 ID */
    private String bugTaskId;
    /** 所属测试计划 ID（计划内批量执行时写入；空=单用例执行） */
    private String planId;
    private String executedBy;
    private String executedByUserId;
    private LocalDateTime createdAt;
}
