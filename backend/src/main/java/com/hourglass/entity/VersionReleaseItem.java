package com.hourglass.entity;

import lombok.Data;
import java.time.LocalDate;

@Data
public class VersionReleaseItem {
    private Long id;
    private String workspaceId;
    private String releaseId;
    private String taskId;
    /** 快照时的工作项编号（sql/83）：工作项换项目会重新取号，历史证据不跟着变 */
    private Integer taskItemNo;
    private String title;
    private String itemType;
    private String ownerUserId;
    private String ownerName;
    private String demandId;
    /** 快照时的需求编号（sql/86）：需求删除或移植后历史证据不跟着变 */
    private Integer demandNo;
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
