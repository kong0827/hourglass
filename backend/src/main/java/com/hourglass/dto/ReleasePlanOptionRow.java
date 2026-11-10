package com.hourglass.dto;

import lombok.Data;

import java.time.LocalDate;

/** 新建计划时可选的版本（按项目分组的数据源）。 */
@Data
public class ReleasePlanOptionRow {
    private String reqId;
    private String projectName;
    private String versionId;
    private String versionName;
    private String versionStatus;
    private LocalDate targetDate;
}
