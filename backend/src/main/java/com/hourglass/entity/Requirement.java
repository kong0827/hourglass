package com.hourglass.entity;

import lombok.Data;

import java.time.LocalDate;
import java.time.LocalDateTime;

@Data
public class Requirement {

    private String id;
    private String workspaceId;
    private String name;
    private String description;
    /** 一句话项目目标（sql/50，驾驶舱展示） */
    private String objective;
    /** active/done/hold */
    private String status;
    /** 项目负责人（sql/50，app_user.id） */
    private String ownerUserId;
    private LocalDate plannedStart;
    private LocalDate plannedEnd;
    /** 首版上线日（sql/23）：阶段归组口径 —— 完成日 ≤ 该日的任务归首版，之后归迭代 */
    private LocalDate firstReleasedAt;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
    /** 归档时间（sql/50）：仅从默认视图隐藏，不删除数据 */
    private LocalDateTime archivedAt;
    /** 手动排序（sql/70）：空间内升序，项目列表与下拉框统一按它排序 */
    private Integer sortOrder;
}
