package com.hourglass.entity;

import lombok.Data;

import java.time.LocalDate;
import java.time.LocalDateTime;

/** 周五补记会话：一人一周一条，记录草稿、提交与撤销窗口。 */
@Data
public class CatchupSession {

    private String id;
    private String workspaceId;
    private String userId;
    private LocalDate weekStart;
    /** draft 草稿 / submitted 已提交 / skipped 本周跳过 */
    private String status;
    private LocalDateTime startedAt;
    private LocalDateTime submittedAt;
    private LocalDateTime undoneAt;
    private Integer elapsedSeconds;
    private Boolean noOtherRisk;
    private String reviewJson;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
