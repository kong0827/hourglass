package com.hourglass.entity;

import lombok.Data;

import java.time.LocalDate;
import java.time.LocalDateTime;

@Data
public class Requirement {

    private String id;
    private String workspaceId;
    /** 所属项目集（project_set.id），空=未分组（sql/106） */
    private String setId;
    /** 由哪个一级分类升格而来（sql/106，仅迁移追溯） */
    private String originCategoryId;
    /** 容器项目标记：split_container=拆分后的公共容器（sql/106） */
    private String containerKind;
    private String name;
    private String description;
    /** 一句话项目目标（sql/50，驾驶舱展示） */
    private String objective;
    /** active/done/hold */
    private String status;
    /** 发布检查策略（sql/89）：strict / standard / loose */
    private String releaseCheckPolicy;
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
