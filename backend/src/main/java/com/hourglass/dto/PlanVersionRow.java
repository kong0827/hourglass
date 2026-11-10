package com.hourglass.dto;

import lombok.Data;

import java.time.LocalDate;

/** 发布计划包含的版本：项目与版本标识、版本状态，以及该版本是否已按此计划完成生产发布。 */
@Data
public class PlanVersionRow {
    private String versionId;
    private String versionName;
    private String reqId;
    private String projectName;
    private String versionStatus;
    private LocalDate targetDate;
    private Boolean released;
}
