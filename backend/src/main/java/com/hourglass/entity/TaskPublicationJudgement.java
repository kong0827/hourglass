package com.hourglass.entity;

import lombok.Data;

import java.time.LocalDate;
import java.time.LocalDateTime;

/**
 * 工作项历史发布人工标记：只补录没有正式发布记录的历史事实，追加式留痕，撤销后保留历史。
 * 不作为生产发布证据，不参与需求交付派生与版本统计。
 */
@Data
public class TaskPublicationJudgement {

    private Long id;
    private String workspaceId;
    private String taskId;
    /** 仅 published：人工标记已发布 */
    private String judgedState;
    /** 标记生效日期；历史迁移时填写实际发布时间 */
    private LocalDate effectiveOn;
    private String judgeReason;
    private String judgedByUserId;
    private String judgedByName;
    private LocalDateTime judgedAt;
    private LocalDateTime revokedAt;
    private String revokedByUserId;
    private String revokedByName;
    private String revokeReason;
}
