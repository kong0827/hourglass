package com.devstudio.kanban.entity;

import lombok.Data;

import java.time.LocalDate;
import java.time.LocalDateTime;

@Data
public class Requirement {

    private String id;
    private String workspaceId;
    private String name;
    private String description;
    /** active/done/hold */
    private String status;

    /* ---- 管理层驾驶舱（sql/22_management.sql） ---- */
    /** 项目负责人账号ID；必须是空间 owner/member，不能是 exec */
    private String managerUserId;
    private LocalDate startDate;
    private LocalDate dueDate;
    /** P0-P3 */
    private String priority;
    /** red/amber/green；空=自动 */
    private String healthOverride;
    private String healthNote;
    private String healthUpdatedBy;
    private LocalDateTime healthUpdatedAt;
    /** 人工覆盖到期时间；到期后自动恢复自动计算 */
    private LocalDateTime healthOverrideUntil;
    /** 创建人账号ID（仅新项目记录；存量无法回填） */
    private String createdBy;

    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
