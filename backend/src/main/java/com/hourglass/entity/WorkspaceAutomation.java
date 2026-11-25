package com.hourglass.entity;

import lombok.Data;

import java.time.LocalDateTime;

/** 空间级自动化规则开关；没有记录时按默认开启处理。 */
@Data
public class WorkspaceAutomation {

    private String workspaceId;
    private String ruleKey;
    private Boolean enabled;
    private String configJson;
    private LocalDateTime lastRunAt;
    private String lastStatus;
    private String updatedBy;
    private LocalDateTime updatedAt;
}
