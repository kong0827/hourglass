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
    /** 所属项目目录节点 ID（category.id）；module 文本是它的展示快照 */
    private String moduleId;
    /** 优先级档位：P0/P1/P2/P3，空 = 未设置 */
    private String priority;
    /** 执行步骤 JSON：[{"action":"操作","expected":"预期结果"}] */
    private String steps;
    /** 手动排序序号（项目内递增，小在前）；选择「手动排序」时使用 */
    private Integer sortOrder;
    /** 最近执行结果：passed / failed / blocked，空 = 未执行 */
    private String latestStatus;
    private String latestNote;
    private String latestBy;
    private String latestByUserId;
    private LocalDateTime latestAt;
    /** 最近失败转出的缺陷任务 ID */
    private String latestBugTaskId;
    /** 创建人显示名：创建时写入，不随执行变化 */
    private String createdBy;
    private String createdByUserId;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
