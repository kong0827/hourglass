package com.hourglass.entity;

import lombok.Data;

import java.time.LocalDate;
import java.time.LocalDateTime;

/** 测试计划：项目下的回归/迭代容器（draft → running → done），圈选若干用例批量执行。 */
@Data
public class TestPlan {

    private String id;
    private String workspaceId;
    /** 所属项目 ID（requirement.id） */
    private String reqId;
    private String name;
    /** 关联版本 ID（project_version.id，选填） */
    private String versionId;
    private LocalDate plannedStart;
    private LocalDate plannedEnd;
    /** draft/running/done */
    private String status;
    private String note;
    private String createdBy;
    private String createdByUserId;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
