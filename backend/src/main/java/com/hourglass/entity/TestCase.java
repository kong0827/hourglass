package com.hourglass.entity;

import lombok.Data;

import java.time.LocalDateTime;

/** 测试用例：结构化步骤 + 最近一轮执行结果（冗余字段便于列表展示）。 */
@Data
public class TestCase {

    private String id;
    private String workspaceId;
    /** 所属项目 ID（requirement.id） */
    private String reqId;
    private String title;
    private String precondition;
    /** 执行步骤 JSON：[{"action":"操作","expected":"预期结果"}] */
    private String steps;
    /** 最近执行结果：passed / failed / blocked，空 = 未执行 */
    private String latestStatus;
    private String latestNote;
    private String latestBy;
    private String latestByUserId;
    private LocalDateTime latestAt;
    /** 最近失败转出的缺陷任务 ID */
    private String latestBugTaskId;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
