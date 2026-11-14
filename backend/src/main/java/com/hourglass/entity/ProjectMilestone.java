package com.hourglass.entity;

import lombok.Data;

import java.time.LocalDate;
import java.time.LocalDateTime;

@Data
public class ProjectMilestone {

    private String id;
    private String workspaceId;
    private String reqId;
    private String name;
    /** version / tasks / manual；创建后不改 */
    private String kind;
    private String versionId;
    private LocalDate targetDate;
    private String ownerUserId;
    private Boolean keyMilestone;
    private String note;
    /** 仅人工确认写入；版本型与工作项型由条件实时推导 */
    private LocalDateTime achievedAt;
    private String achievedNote;
    private String confirmedByUserId;
    private LocalDateTime canceledAt;
    private String cancelReason;
    private Long revision;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
