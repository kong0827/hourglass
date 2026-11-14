package com.hourglass.entity;

import lombok.Data;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

@Data
public class VersionRelease {
    private String id;
    private String workspaceId;
    private String reqId;
    /** 项目内发布记录编号，展示为 REL-001（sql/82） */
    private Integer releaseNo;
    private String versionId;
    private String planId;
    private Long planRevision;
    private String result;
    private LocalDate publishedOn;
    /** UTC occurrence time, independent of the server recording time. */
    @com.fasterxml.jackson.annotation.JsonFormat(pattern = "yyyy-MM-dd'T'HH:mm:ss.SSSSSS'Z'")
    private LocalDateTime occurredAt;
    private String environment;
    private List<String> targetKeys = new ArrayList<String>();
    private String coverage;
    private String artifactRef;
    private String artifactDigest;
    private String operation;
    private String relatedReleaseId;
    /** 关联事件的编号，读取时按 relatedReleaseId 现查（可能指向别的版本，故不随记录定格） */
    private Integer relatedReleaseNo;
    private String executorUserId;
    private String executorName;
    private String deviationReason;
    @com.fasterxml.jackson.annotation.JsonFormat(pattern = "yyyy-MM-dd'T'HH:mm:ss.SSSSSS'Z'")
    private LocalDateTime recordedAt;
    private String releasedBy;
    private String releasedByName;
    private String versionName;
    private String projectName;
    private String notes;
    private String failureReason;
    private Integer publishedCount;
    private Integer excludedCount;
    private String idempotencyKey;
    @com.fasterxml.jackson.annotation.JsonIgnore
    private String requestHash;
    private String planSnapshot;
    private List<VersionReleaseItem> items = new ArrayList<VersionReleaseItem>();
}
