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
    private String projectNames;
    private Integer versionCount;
    private LocalDateTime plannedAt;
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
