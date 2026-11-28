package com.hourglass.dto;

import lombok.Data;

import java.time.LocalDate;
import java.time.LocalDateTime;

/** 跨项目发布日程行：计划归属的版本与项目、时间、环境、负责人与范围项数。 */
@Data
public class ReleasePlanRow {
    private String id;
    private String workspaceId;
    private String versionId;
    private String versionName;
    private String versionStatus;
    private LocalDate versionTargetDate;
    private String reqId;
    private String projectName;
    /** 计划包含的全部版本/项目（多版本计划用 / 连接）；first version 字段仍保留用于打开入口。 */
    private String versionNames;
    /** 与 versionNames 同序的逐版本项目名（可重复），用于「项目 · 版本」逐枚配对；projectNames 是去重串，位置不能对齐。 */
    private String versionProjectNames;
    /** 与 versionNames 同序（ORDER BY r2.name, v2.name, v2.id）的逗号串，供前端逐枚接线跳转；旧客户端忽略。 */
    private String versionIds;
    private String versionReqIds;
    private String projectNames;
    private Integer versionCount;
    private Integer planNo;
    /** 计划名称（sql/138）；空时前端回退「版本名 + 环境」 */
    private String name;
    private LocalDateTime plannedAt;
    private LocalDateTime updatedAt;
    /** 收口时间：覆盖版本最近一次生产成功（非回滚）的 occurred_at；未收口为 null */
    private LocalDateTime completedAt;
    /** 就绪检查：pass / warn / block；null 表示草稿未检查或超出列表检查预算。覆盖版本取最差结论。 */
    private String checkVerdict;
    private Integer checkBlockers;
    private Integer checkReminders;
    private String ownerUserId;
    private String ownerName;
    private String environment;
    private String coverage;
    private String status;
    private Long revision;
    private String notes;
    private String risks;
    private Integer plannedTaskCount;
}
