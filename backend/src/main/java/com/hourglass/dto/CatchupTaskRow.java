package com.hourglass.dto;

import lombok.Data;

import java.time.LocalDate;
import java.time.LocalDateTime;

/** 补记候选工作项：本周有完成、更新、创建或计时的「我负责的」工作项。 */
@Data
public class CatchupTaskRow {

    private String taskId;
    private String title;
    private String itemType;
    private Integer itemNo;
    private String boardColumn;
    private String reqId;
    private String reqName;
    private LocalDate dueDate;
    private LocalDateTime completedAt;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
    private Boolean blocked;
    private String blockedReason;
    private String ownerUserId;
}
