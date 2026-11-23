package com.hourglass.dto;

import lombok.Data;

import java.time.LocalDateTime;

/** 测试计划 / 发布计划在周回顾里的窄投影。 */
@Data
public class ReviewTeamPlanRow {
    private String id;
    private String name;
    private String status;
    private String versionName;
    private LocalDateTime plannedAt;
    private String plannedEnd;
    private Integer total;
    private Integer passed;
}
