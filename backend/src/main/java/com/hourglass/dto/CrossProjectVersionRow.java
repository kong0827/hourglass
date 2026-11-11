package com.hourglass.dto;

import lombok.Data;

import java.time.LocalDate;
import java.time.LocalDateTime;

/** 跨项目版本清单：可见项目下的版本、工作项数、最近生产发布时间与管理权限。 */
@Data
public class CrossProjectVersionRow {
    private String reqId;
    private String projectName;
    private String versionId;
    private String versionName;
    private String versionStatus;
    private LocalDate targetDate;
    private LocalDateTime releasedAt;
    private Integer taskCount;
    private LocalDate latestReleaseDate;
    private Boolean canManage;
}
