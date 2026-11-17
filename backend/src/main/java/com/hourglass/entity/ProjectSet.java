package com.hourglass.entity;

import lombok.Data;

import java.time.LocalDate;
import java.time.LocalDateTime;

/**
 * 项目集：项目之上的可选归组（sql/106）。
 * 只做归组与只读汇总，不参与权限判定；项目仍按自己的成员/项目角色控制可见与可写。
 */
@Data
public class ProjectSet {

    private String id;
    private String workspaceId;
    private String name;
    private String description;
    /** 项目集负责人（app_user.id），仅展示 */
    private String ownerUserId;
    /** active/done/hold */
    private String status;
    private LocalDate plannedStart;
    private LocalDate plannedEnd;
    private LocalDateTime archivedAt;
    /** 标识色，默认 #8a8578 */
    private String color;
    private Integer sortOrder;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    /* ---------- 非表字段：列表展示与只读汇总 ---------- */
    private String ownerName;
    /** 当前查看者可见的项目数（含已归档） */
    private Integer projectCount;
    private Integer taskCount;
    private Integer doneCount;
    private Integer progressPct;
}
