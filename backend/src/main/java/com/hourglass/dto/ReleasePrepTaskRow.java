package com.hourglass.dto;

import lombok.Data;

import java.time.LocalDate;
import java.time.LocalDateTime;

/** 发布准备行：计划内工作项 + 负责人 + 当前确认状态（确认状态由服务层合并 check 表）。 */
@Data
public class ReleasePrepTaskRow {
    private String id;
    private String title;
    /** story / task / bug / epic */
    private String itemType;
    private String boardColumn;
    private String priority;
    private String ownerUserId;
    private String ownerName;
    private String projectId;
    private String projectName;
    private LocalDate dueDate;
    private LocalDateTime completedAt;
    /** ok / risk / null（未确认） */
    private String checkState;
    private String checkNote;
    private LocalDateTime checkedAt;
    /** 计划范围或时间已变化，旧确认要求重新确认 */
    private Boolean stale = Boolean.FALSE;
}
