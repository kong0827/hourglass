package com.hourglass.entity;

import lombok.Data;
import java.time.LocalDateTime;

@Data
public class VersionReleasePlan {
    private String id;
    private String workspaceId;
    private String versionId;
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
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
