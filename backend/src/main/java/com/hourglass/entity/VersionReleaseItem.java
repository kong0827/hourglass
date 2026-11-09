package com.hourglass.entity;

import lombok.Data;
import java.time.LocalDate;

@Data
public class VersionReleaseItem {
    private Long id;
    private String workspaceId;
    private String releaseId;
    private String taskId;
    private String title;
    private String itemType;
    private String ownerUserId;
    private String ownerName;
    private String demandId;
    private String demandTitle;
    private String targetVersionId;
    private String targetVersionName;
    private String boardColumn;
    private LocalDate completedAt;
    private String disposition;
    private String reason;
    private String contentSummary;
    private Integer workMinutes;
    private Integer estimateMinutes;
}
