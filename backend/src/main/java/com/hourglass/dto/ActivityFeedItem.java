package com.hourglass.dto;

import lombok.Data;

import java.time.LocalDateTime;

/** 空间活动聚合行：五个来源统一成同一结构，前端只认 entityType + action。 */
@Data
public class ActivityFeedItem {

    /** 聚合内唯一键（source:主键），跨表分页去重用 */
    private String id;
    /** 所有行同属一个空间；保留在行上便于前端与现有 E2E 断言空间隔离 */
    private String workspaceId;
    private LocalDateTime at;
    /** task / demand / project / doc / branch / version / config */
    private String entityType;
    private String entityId;
    private String entityTitle;
    private String projectId;
    private String projectName;
    private String action;
    private String detail;
    private String actorName;
}
