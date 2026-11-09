package com.hourglass.entity;

import lombok.Data;

import java.time.LocalDate;
import java.time.LocalDateTime;

/** 需求池条目：评审、需求目标排期与取消状态；任务执行/发布状态独立。 */
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
    /** review待评审/pass已通过/plan已排期/rej已拒绝/canceled已取消 */
    private String status;
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
}
