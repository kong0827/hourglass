package com.hourglass.entity;

import lombok.Data;

import java.time.LocalDate;
import java.time.LocalDateTime;

/**
 * 任务完成快照（月度统计用）。
 *
 * <p>任务完成那一刻落一条，之后任务改名 / 换项目 / 被删除都不影响已归档的记录 ——
 * 这是"统计"和"查当前任务表"最本质的区别。
 */
@Data
public class TaskCompletionRecord {

    private Long id;
    private String workspaceId;
    /** 任务 ID（任务被删除后仍然保留，用于追溯；同空间内唯一） */
    private String taskId;
    /** 任务名称（完成时的快照） */
    private String title;
    /** 任务详情（完成时的快照，截断到 2000 字） */
    private String description;
    private String reqId;
    /** 归属项目名称（冗余存一份，防项目改名/删除后统计失真） */
    private String reqName;
    /** 关联需求 ID（requirement_doc） */
    private String reqDocId;
    /** 需求名称（完成时的快照，需求改名/删除都不影响这里） */
    private String reqDocTitle;
    private String owner;
    private String ownerUserId;
    /** 测试侧证据：任务彻底删除后快照是唯一留存，缺这几列「谁测的/测了多久」会一起消失 */
    private String testOwnerUserId;
    private String testOwner;
    private LocalDateTime testRequestedAt;
    private LocalDateTime testStartedAt;
    private LocalDateTime testFinishedAt;
    private String category;
    private String priority;
    /** 任务开始日期 */
    private LocalDate startDate;
    /** 完成时间（分钟级） */
    private LocalDateTime completedAt;
    /** 首次计时开始时间 */
    private LocalDateTime firstStartedAt;
    /** 最后一次计时结束时间 */
    private LocalDateTime lastEndedAt;
    /** 总耗时（分钟，已按「每天 8 小时 / 跳过周末」裁剪） */
    private Integer totalMinutes;
    private LocalDateTime createdAt;

    /* ---- 发布事实：不是快照列，输出前按 task_id 现查，仅用于列表徽标 ---- */
    private String publicationState = "unpublished";
    private Boolean everPublished;
    private java.util.List<String> publicationTargets;
    private LocalDate publishedAt;
    private Boolean manualPublished;
    private LocalDate manualPublishedAt;
    private String manualJudgeName;
    private String manualJudgeReason;
}
