package com.hourglass.dto;

import lombok.Data;

import java.time.LocalDateTime;

/** 我的关注 · 发布计划行：只读摘要，进度与风险由发布准备汇总另行提供。 */
@Data
public class ReleasePlanWatchRow {
    private String id;
    private Integer planNo;
    private String versionId;
    private String reqId;
    private LocalDateTime plannedAt;
    private String status;
    private String ownerUserId;
    private String ownerName;
    private String environment;
    private String coverage;
    private String projectNames;
    private String versionNames;
    private Integer versionCount;
    private LocalDateTime updatedAt;
    private LocalDateTime watchedAt;
}
