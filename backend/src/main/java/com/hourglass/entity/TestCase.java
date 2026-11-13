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
    /** 关联需求 ID（demand.id，选填） */
    private String demandId;
    /** 项目内用例编号：创建时顺序分配，展示为 TC-001，创建后不变 */
    private Integer caseNo;
    private String title;
    private String precondition;
    /** 测试数据：执行时要准备或输入的数据（账号、金额、边界值等） */
    private String testData;
    /** 功能模块：自由填写，列表筛选用 */
    private String module;
    /** 优先级档位：P0/P1/P2/P3，空 = 未设置 */
    private String priority;
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
