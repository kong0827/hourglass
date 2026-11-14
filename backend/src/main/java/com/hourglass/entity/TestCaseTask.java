package com.hourglass.entity;

import lombok.Data;

import java.time.LocalDateTime;

/** 用例验证的工作项：一条用例可验证多个工作项，工作项必须属于用例的主需求。 */
@Data
public class TestCaseTask {

    private String id;
    private String workspaceId;
    private String caseId;
    private String taskId;
    private String createdBy;
    private LocalDateTime createdAt;
}
