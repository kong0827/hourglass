package com.hourglass.entity;

import lombok.Data;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.ArrayList;

@Data
public class Task {

    private String id;
    private String workspaceId;
    private String title;
    private String description;
    /** P0/P1/P2/P3 */
    private String priority;
    private String owner;
    /** 模块ID（category.id；''=未指定，保存时服务层兜底为空间第一个模块） */
    private String categoryId;
    /** 看板列 id（board_column 表 + done） */
    private String boardColumn;
    /** 列处理规则（非表字段，查询时由 board_column 填充；built-in 列由调用方推断） */
    private String processingRule;
    /** 开始日期（日历按 [startDate, dueDate] 区间逐日展示；为空则只在截止日出现） */
    private LocalDate startDate;
    private LocalDate dueDate;
    private String reqId;
    /** 关联需求 ID（requirement_doc）；需求必须属于同一个项目 */
    private String reqDocId;
    /** 关联分支 ID（dev_branch，空间级分支池）；删分支时自动解绑 */
    private String branchId;
    /** 0-100 */
    private Integer progress;
    /** 里程碑：单日节点，甘特图用菱形展示；不参与逾期天数以外的排期计算 */
    private Boolean isMilestone = Boolean.FALSE;
    /** 预估耗时（分钟，空=没估过）。和 totalMinutes（实际投入）相除就是估时偏差 */
    private Integer estimateMinutes;
    private String note;
    private LocalDate completedAt;
    /** 测试负责人账号ID；为空表示「待领取」，与开发负责人相互独立 */
    private String testOwnerUserId;
    /** 测试负责人显示名快照；账号ID是权威绑定 */
    private String testOwner;
    /** 提测时间：进入「待测试」或新一轮直接进入「测试中」时记录 */
    private LocalDateTime testRequestedAt;
    /** 进入「测试中」的时间（可重复测试，每轮重新记录开始时刻） */
    private LocalDateTime testStartedAt;
    /** 离开「测试中」的时间：测试通过或退回 / 重开时记录 */
    private LocalDateTime testFinishedAt;
    /** Derived readonly projection of immutable formal records; never persisted by task writes. */
    @com.fasterxml.jackson.annotation.JsonProperty(access = com.fasterxml.jackson.annotation.JsonProperty.Access.READ_ONLY)
    private Boolean everPublished = Boolean.FALSE;
    @com.fasterxml.jackson.annotation.JsonProperty(access = com.fasterxml.jackson.annotation.JsonProperty.Access.READ_ONLY)
    private String publicationState = "unpublished";
    @com.fasterxml.jackson.annotation.JsonProperty(access = com.fasterxml.jackson.annotation.JsonProperty.Access.READ_ONLY)
    private List<String> publicationTargets = new ArrayList<String>();
    @com.fasterxml.jackson.annotation.JsonProperty(access = com.fasterxml.jackson.annotation.JsonProperty.Access.READ_ONLY)
    private LocalDate publishedAt;
    @com.fasterxml.jackson.annotation.JsonProperty(access = com.fasterxml.jackson.annotation.JsonProperty.Access.READ_ONLY)
    private String publishSource;
    @com.fasterxml.jackson.annotation.JsonProperty(access = com.fasterxml.jackson.annotation.JsonProperty.Access.READ_ONLY)
    private String publishedReleaseId;
    /** 非表字段：详情查询按当前身份计算，客户端不能通过普通保存授予发布权限。 */
    private Boolean canPublish = Boolean.FALSE;
    private Boolean canUnpublish = Boolean.FALSE;
    /** daily/weekly/monthly，空为不循环 */
    private String recurType;
    /** 循环任务派生的下一次任务ID（重新打开后再次完成时复用，不重复生成） */
    private String recurNextId;
    private LocalDateTime remindAt;
    private Boolean remindSent;
    private LocalDateTime deletedAt;
    private Integer sortOrder;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
    /** 非表字段：仅任务抽屉保存时要求按 updated_at 做并发校验 */
    @com.fasterxml.jackson.annotation.JsonIgnore
    private Boolean versionCheck;

    /* ---- 2026-10-16 评估报告改造新增（见 sql/03_report_2026-10-16.sql） ---- */
    /** 负责人账号ID（N-2 身份绑定）；为空时业务回落 owner 显示名文本 */
    private String ownerUserId;
    /** 提醒谁（N-1）：owner / owner+admin */
    private String remindTarget;
    /** 是否被阻塞（N-4 卡点） */
    /** 是否被阻塞（卡点）；列名 is_blocked，实体字段必须叫 blocked 才能被结果映射，XML 里用别名对齐 */
    private Boolean blocked = Boolean.FALSE;
    /** 卡点原因 */
    private String blockedReason;
    /** 等待的任务ID（可选依赖） */
    private String blockedByTaskId;

    /** 子任务统计（非表字段，查询时合并填充） */
    private Integer subtaskTotal;
    private Integer subtaskDone;
    /** 标签（非表字段，查询时合并填充） */
    private List<String> tags;
    /** 累计工时分钟（非表字段，查询时合并填充） */
    private Integer totalMinutes;
    /** 测试工时分钟（非表字段）：已结束计时中自然日落在测试窗口内的部分，其余工时计入开发 */
    private Integer testMinutes;
    /** 评论条数（非表字段，查询时合并填充） */
    private Integer commentCount;
    /** 附件条数（非表字段，查询时合并填充） */
    private Integer attachmentCount;
    /** 「我的任务」用：所属空间名（非表字段） */
    private String workspaceName;
    /** 「我的任务」用：所属项目名（非表字段，mergeTaskExtras 填充，跨空间分组/展示用） */
    private String reqName;
    /** 「我的任务」用：当前用户对该任务的可写性 write/read（非表字段，跨空间批量填充） */
    private String access;
    /**
     * 扩展检索文本（非表字段，O-8）：项目名 + 附件文件名拼接，让全局搜索能命中它们。
     * 不落库，只在查询时由 mergeTaskExtras 填充。
     */
    private String searchExtra;

    /** 工作项类型：story/task/bug/epic（sql/23；存量任务默认 task） */
    private String itemType;
    /** 项目内工作项编号，展示为 WI-001（sql/82）；换项目重新取号，改类型不换号 */
    private Integer itemNo;
    /** 缺陷严重度 blocker/critical/major/minor（仅 item_type=bug；sql/38） */
    private String severity;
    /** 发现环境（仅缺陷） */
    private String environment;
    /** 复现步骤（仅缺陷） */
    private String reproduceSteps;
    /** 发现版本ID（project_version，仅缺陷） */
    private String foundVersionId;
    /** 回归状态 pending/passed/failed（仅缺陷） */
    private String regressionStatus;
    /** 所属 Epic 任务ID（仅 story/task/bug 可挂 Epic） */
    private String epicId;
    /** 关联需求池需求ID（sql/24，demand 表；基于需求创建任务时写入） */
    private String demandId;

    /** Planning memberships, batch-enriched from version_task; not publication authority. */
    private List<String> versionIds = new ArrayList<String>();
    private List<String> versionNames = new ArrayList<String>();
    /** 上线前未绑版本、自动归入首版的标记（非表字段，发布说明标注用） */
    private Boolean preLaunchFold;
}
