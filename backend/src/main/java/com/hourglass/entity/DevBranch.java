package com.hourglass.entity;

import lombok.Data;

import java.time.LocalDateTime;

/**
 * 分支：一条分支对应一次「拉分支 → 开发 → 测试 → 合并 → 发布」。
 * 可以是**空间级公共分支**（reqId 为空），也可以是**项目级分支**（reqId 指向 requirement.id）。
 *
 * <p>状态取值见 {@code BranchService}：
 * {@code dev}(开发中) / {@code testing}(待测试) / {@code merging}(待合并) / {@code released}(已发布)。
 *
 * <p>四个时间点记的是**首次进入**该状态的时间（服务层用 COALESCE 只写一次）：
 * <ul>
 *   <li>{@code devAt}：进入开发中（通常 = 创建时间）</li>
 *   <li>{@code testAt}：提测时间</li>
 *   <li>{@code mergeAt}：进入待合并（= 开发改完了，等人合）</li>
 *   <li>{@code releasedAt}：发布时间 —— 与 createdAt 相减就是这条分支的发布周期</li>
 * </ul>
 * 具体每一次状态变更由 {@link DevBranchLog} 记录。
 */
@Data
public class DevBranch {

    private String id;
    private String workspaceId;
    /** 所属项目ID（requirement.id），空 = 空间级公共分支 */
    private String reqId;
    /** 分支名，如 feature/login、hotfix/order-500 */
    private String name;
    /** dev / testing / merging / released */
    private String status;
    private String owner;
    private String ownerUserId;
    /** 目标分支（要合到哪），选填 */
    private String targetBranch;
    private String note;

    private LocalDateTime devAt;
    private LocalDateTime testAt;
    private LocalDateTime mergeAt;
    private LocalDateTime releasedAt;

    private Integer sortOrder;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    /* ---- 非表字段：列表查询时由子查询合并填充 ---- */
    /** 关联的未删除任务数 */
    private Integer taskCount;
    /** 其中已完成的任务数 */
    private Integer doneCount;
    /** 影响版本标签（由该分支下任务所归的版本推导，见 BranchService#fillVersions） */
    private java.util.List<com.hourglass.dto.BranchVersionTag> versions;
    /** 归属项目标签（由该分支下任务所在的项目推导，见 BranchService#fillProjects） */
    private java.util.List<com.hourglass.dto.BranchProjectTag> projects;
}
