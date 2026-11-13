package com.hourglass.entity;

import lombok.Data;

import java.time.LocalDate;
import java.time.LocalDateTime;

/** 需求池条目：评审、目标排期与关闭归档；交付阶段由执行和发布证据派生。 */
@Data
public class Demand {

    private String id;
    private String workspaceId;
    /** 所属项目ID（requirement 表） */
    private String reqId;
    private String title;
    /** 为什么做（背景与价值） */
    private String description;
    /** 来源（谁提的，如「财务 · 刘」） */
    private String source;
    /** 新功能/体验优化/缺陷/其他 */
    private String itemKind;
    /** 模块ID（category.id；null 表示未指定） */
    private String categoryId;
    /** P0/P1/P2/P3 */
    private String priority;
    /** review待评审/pass已通过/plan已排期/closed已关闭 */
    private String status;
    /** 关闭原因：rej评审不通过/cancel中途取消/dup重复需求 */
    private String closeReason;
    /** 关闭前主状态：review/pass/plan，决定恢复去向 */
    private String closeStage;
    /** 期望交付时间 */
    private LocalDate expectDate;
    /** 需求层计划时间，与任务执行日期独立 */
    private LocalDate plannedStart;
    private LocalDate plannedEnd;
    /** 乐观锁：每次写更新递增 */
    private Long revision = 0L;
    /** 当前用户是否可排期/调期/取消/恢复（非表字段） */
    private Boolean canSchedule;
    /** 验收标准 */
    private String acceptText;
    /** 目标版本（project_version，排期时选择） */
    private String versionId;
    /** 目标版本名称（非表字段，分页列表联查返回） */
    private String versionName;
    /** 目标版本状态 planned/active/released（非表字段，分页列表联查返回；released 表示需求已随版本交付） */
    private String versionStatus;
    /** 评审备注（通过理由/拒绝原因/排期说明） */
    private String reviewNote;
    /** WSJF 分量 0-10（effort 为分母） */
    private Integer wsjfBusiness;
    private Integer wsjfUrgency;
    private Integer wsjfRisk;
    private Integer wsjfEffort;
    /** 提交人账号ID */
    private String createdBy;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    /** WSJF 得分（非表字段，读取时计算：(business+urgency+risk)÷effort，保留 1 位） */
    private Double wsjfScore;

    /** 已排期派生阶段（非表字段）：waiting/active/donePending/delivered */
    private String deliveryStage;
    /** 阶段来源（非表字段）：release真实发布优先 / manual人工判定 / derived自动派生 */
    private String deliveryStageSource;
    private Integer taskCount;
    private Integer taskDone;
    private Integer caseCount;
    private Integer casePassed;
    private LocalDate devStart;
    /** 实际交付日期：真实发布日期优先，缺失时取人工“已交付”的生效日期 */
    private LocalDate deliveredAt;
    /** 已指向发布版本但没有有效发布记录；需补录历史证据，不自动推断交付 */
    private Boolean deliveryEvidenceMissing;

    /** 当前生效人工判定（非表字段）：donePending/delivered；null 表示没有 */
    private String manualDeliveryStage;
    private LocalDate manualDeliveryEffectiveOn;
    private String manualDeliveryReason;
    private String manualDeliveryJudgedBy;
    private LocalDateTime manualDeliveryJudgedAt;
    /** 当前用户是否可维护人工判定（非表字段）：空间主、管理员或项目负责人 */
    private Boolean canJudgeDelivery;
}
