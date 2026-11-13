package com.hourglass.entity;

import lombok.Data;

import java.time.LocalDate;
import java.time.LocalDateTime;

/** 需求人工交付判定：补录缺失证据，追加式留痕，撤销后保留历史。 */
@Data
public class DemandDeliveryJudgement {

    private Long id;
    private String workspaceId;
    private String demandId;
    /** 判定时的目标版本快照；需求换版本后旧判定不再生效 */
    private String versionId;
    /** donePending已完成待发布 / delivered已交付 */
    private String judgedStage;
    /** 判定生效日期；已交付时作为实际交付日期 */
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
