package com.hourglass.entity;

import lombok.Data;
import java.time.LocalDateTime;

@Data
public class VersionReleasePlan {
    private String id;
    private String workspaceId;
    private String versionId;
    /** 空间内发布计划编号（sql/85，展示为 PL-001；null 表示存量尚未取号） */
    private Integer planNo;
    private LocalDateTime plannedAt;
    private String ownerUserId;
    private String notes;
    private String risks;
    private String status;
    private Long revision;
    private String scopeToken;
    private String environment;
    private java.util.List<String> targetKeys = new java.util.ArrayList<String>();
    private String coverage;
    private java.util.List<String> plannedTaskIds = new java.util.ArrayList<String>();
    /** 计划覆盖的版本/项目；versionId 保留为展示用主版本（首个版本），权威范围以 versionIds 为准。 */
    private java.util.List<String> versionIds = new java.util.ArrayList<String>();
    private java.util.List<com.hourglass.dto.PlanVersionRow> versions = new java.util.ArrayList<com.hourglass.dto.PlanVersionRow>();
    private Integer versionCount;
    private Integer releasedVersionCount;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
