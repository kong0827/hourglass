package com.hourglass.dto;

import lombok.Data;

import java.time.LocalDateTime;

/** 本周成功生产发布记录（每条一行）。 */
@Data
public class ReviewTeamReleaseRow {
    private String id;
    private String projectName;
    private String versionName;
    private LocalDateTime at;
    private String executor;
    private Integer demands;
    private Integer tasks;
    private String note;
}
