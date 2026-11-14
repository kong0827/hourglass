package com.hourglass.entity;

import lombok.Data;

@Data
public class VersionCommitmentTask {

    private String workspaceId;
    private String versionId;
    private String taskId;
    private String taskTitle;
    private Integer estimateMinutes;
}
