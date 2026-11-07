package com.hourglass.entity;

import lombok.Data;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

@Data
public class Task {

    private String id;
    private String workspaceId;
    private String title;
    private String description;
    /** P0/P1/P2/P3 */
    private String priority;
    private String owner;
    private String category;
    /** 看板列 id（board_column 表 + done） */
    private String boardColumn;
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
    /** 评论条数（非表字段，查询时合并填充） */
    private Integer commentCount;
    /** 附件条数（非表字段，查询时合并填充） */
    private Integer attachmentCount;
    /** 「我的任务」用：所属空间名（非表字段） */
    private String workspaceName;
    /** 「我的任务」用：当前用户对该任务的可写性 write/read（非表字段，跨空间批量填充） */
    private String access;
    /**
     * 扩展检索文本（非表字段，O-8）：项目名 + 附件文件名拼接，让全局搜索能命中它们。
     * 不落库，只在查询时由 mergeTaskExtras 填充。
     */
    private String searchExtra;

    /** 工作项类型：story/task/bug/epic（sql/23；存量任务默认 task） */
    private String itemType;
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

    /** 绑定版本ID（非表字段，version_task 查询填充） */
    private String versionId;
    /** 影响版本名（非表字段，列表/详情展示用） */
    private String versionName;
    /** 上线前未绑版本、自动归入首版的标记（非表字段，发布说明标注用） */
    private Boolean preLaunchFold;
}
