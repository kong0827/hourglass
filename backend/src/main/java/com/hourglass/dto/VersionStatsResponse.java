package com.hourglass.dto;

import lombok.Data;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

/**
 * M1 版本聚合统计（T1.3）：口径与原型版本卡一致。
 * released/active 版本消费 workMinutes/doneCount/demandCount/deviationPct/onTimePct/avgTaskMinutes；
 * planned 版本消费 scheduledDemandCount/estimateMinutes；doing 版本另有 remainingMinutes。
 */
@Data
public class VersionStatsResponse {

    private List<VersionStat> versions = new ArrayList<VersionStat>();

    /** 未绑定任何版本的任务（待规划任务桶） */
    private Bucket unbound = new Bucket();

    @Data
    public static class VersionStat {
        private String id;
        private String name;
        private String description;
        /** planned/active/released */
        private String status;
        private LocalDate startDate;
        private LocalDate targetDate;
        private LocalDateTime releasedAt;
        private Long revision;
        /** 当前用户是否可管理发布计划 */
        private Boolean canManageReleasePlan;
        /** 按真实版本绑定 scope 判断，不含首版统计折算任务 */
        private Boolean canPublish;
        private String releaseEvidenceKind;
        private String releaseRecordId;
        private Integer publishedTaskCount;
        private Integer excludedTaskCount;
        private Integer releaseEventCount;
        private Integer successfulReleaseEventCount;
        /** Unique historical production snapshots, not an acceptance or effective-delivery flag. */
        private Integer uniqueProductionTaskCount;
        private Integer effectiveProductionTaskCount;
        /** 绑定任务数 */
        private Integer taskCount;
        private Integer doneCount;
        private Integer doingCount;
        /** 累计实际工时（分钟） */
        private Integer workMinutes;
        /** 绑定任务预估合计（分钟） */
        private Integer estimateMinutes;
        /** 整体偏差百分比：(实际−预估)÷预估；无预估数据时为 null */
        private Integer deviationPct;
        /** 准时完成率：有截止日的完成任务中 completed_at ≤ due_date 的占比；无数据时为 null */
        private Integer onTimePct;
        /** 任务均耗时（分钟）：完成任务自身工时合计÷完成任务数；无完成任务时为 null */
        private Integer avgTaskMinutes;
        /** 剩余预估（分钟）：未完成任务的预估合计（开发中版本卡用） */
        private Integer remainingMinutes;
        /** 关联需求数：目标版本指向该版本且未拒绝的需求 */
        private Integer demandCount;
        /** 已排期需求数：目标版本指向该版本且状态为已排期（plan）的需求 */
        private Integer scheduledDemandCount;
        /** 上线前未绑版本而自动归入本版本的任务数（仅首版 released 版本 &gt;0，口径见计划第 6 节） */
        private Integer preLaunchCount;
        /** 分支进度：该版本下任务所挂分支（含上线前自动归入的任务），按分支状态 dev→released 排序 */
        private List<BranchStat> branches = new ArrayList<BranchStat>();
    }

    @Data
    public static class Bucket {
        private Integer taskCount;
        private Integer doneCount;
        private Integer doingCount;
        private Integer workMinutes;
        private Integer estimateMinutes;
        private Integer remainingMinutes;
        /** 分支进度：该桶任务所挂分支（待规划桶同样带，口径与版本卡一致） */
        private List<BranchStat> branches = new ArrayList<BranchStat>();
    }

    /**
     * 版本卡上的分支进度行：由「版本任务 → task.branch_id → dev_branch」推导，无独立绑定。
     */
    @Data
    public static class BranchStat {
        private String branchId;
        private String name;
        /** dev / testing / merging / released（分支模块四状态） */
        private String status;
        /** 该版本（或桶）下挂在此分支的任务数 */
        private Integer taskCount;
    }
}
