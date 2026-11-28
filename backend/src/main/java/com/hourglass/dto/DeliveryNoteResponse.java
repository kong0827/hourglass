package com.hourglass.dto;

import lombok.Data;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 一页式交付说明：只读事实聚合 + 薄人工层。
 *
 * <p>叙述文字不在后端拼装：这里只给事实与口径，前端 lib/delivery-doc.js 按语气/长度投影成文，
 * 因此改生成控制不需要重新请求，快照冻结同一份 payload 后接收人看到的文字与编制人完全一致。
 */
@Data
public class DeliveryNoteResponse {

    /** version / plan；计划维度为多版本文档，版本维度保持原有单版本结构 */
    private String scopeType;
    private String scopeId;
    private String scopeName;
    private String versionId;
    private String versionName;
    private String versionStatus;
    private String versionDescription;
    private String projectId;
    private String projectName;
    /** 编制人：项目负责人，缺失时取当前操作人 */
    private String ownerName;
    /** release_snapshot / no_release_record / planned_scope */
    private String evidenceKind;
    private String releaseRecordId;
    private LocalDate periodStart;
    private LocalDate periodEnd;
    private LocalDate targetDate;
    private LocalDateTime generatedAt;
    /** 预览编号：下一份快照会拿到的编号；快照里是已冻结编号 */
    private String docNo;

    private String audience;
    private String supportContact;
    private String acceptanceNote;
    private Map<String, String> narratives = new LinkedHashMap<String, String>();
    private List<String> confirmed = new ArrayList<String>();
    private Map<String, Object> options = new LinkedHashMap<String, Object>();
    private Long revision;

    private Boolean canEdit;
    private Boolean canSnapshot;
    private Boolean canShare;
    private Boolean locked;
    private String snapshotId;
    private Integer snapshotSeq;
    private String contentHash;

    /** 选中的发布记录；未确认发布时为空 */
    private ReleaseInfo release;
    private PlanInfo plan;
    private List<ReleaseOption> releaseOptions = new ArrayList<ReleaseOption>();
    private Baseline baseline;
    private Counts counts;
    /** 本次发布涉及的项目（按工作项归属统计；单项目版本只有一行） */
    private List<ProjectRow> projects = new ArrayList<ProjectRow>();
    private List<ScopeRow> scope = new ArrayList<ScopeRow>();
    private DemandSummary demandSummary;
    private List<DemandRow> demands = new ArrayList<DemandRow>();
    private List<ChangeRow> changes = new ArrayList<ChangeRow>();
    private Quality quality;
    private Defects defects;
    private Effort effort;
    private List<RiskRow> risks = new ArrayList<RiskRow>();
    private Acceptance acceptance;
    private List<EvidenceRow> evidence = new ArrayList<EvidenceRow>();
    /** 附录：每个数字的定义与分母 */
    private List<CaliberRow> calibers = new ArrayList<CaliberRow>();
    /** 附录：本版本已导出快照的修订记录 */
    private List<RevisionRow> revisions = new ArrayList<RevisionRow>();
    /** 缺失标注：系统内确实没有记录的部分，不推断 */
    private List<String> missing = new ArrayList<String>();
    /** 计划维度：按版本分章，每章是本计划内该版本的事实切片；版本维度为空 */
    private List<PlanVersionChapter> versionChapters = new ArrayList<PlanVersionChapter>();

    @Data
    public static class ReleaseOption {
        private String id;
        /** 项目内发布记录编号（REL-001）；空=尚未取号，展示回退原 ID */
        private Integer releaseNo;
        private String label;
        private String environment;
        private String environmentName;
        private String result;
        private String operation;
        private LocalDate publishedOn;
        private LocalDateTime occurredAt;
        private Integer itemCount;
        private boolean production;
        private boolean success;
        /** 可作为对外交付依据：成功的生产发布且不是回滚 */
        private boolean deliveryEvidence;
    }

    @Data
    public static class ReleaseInfo {
        private String id;
        private Integer releaseNo;
        private String environment;
        private String environmentName;
        private String result;
        private String operation;
        private String operationName;
        private String coverage;
        private LocalDate publishedOn;
        private LocalDateTime occurredAt;
        private LocalDateTime recordedAt;
        private List<String> targets = new ArrayList<String>();
        private String artifactRef;
        private String artifactDigest;
        private String executorName;
        private String releasedByName;
        private String deviationReason;
        private String failureReason;
        private String notes;
        private String relatedReleaseId;
        /** 关联正式事件的编号：回滚记录可能指向别的版本，故单独取号而不是从本版本列表里找 */
        private Integer relatedReleaseNo;
        private Integer publishedCount;
        private Integer excludedCount;
        /** 本版本全部发布尝试次数（含失败与回滚） */
        private Integer attemptCount;
        private Integer successCount;
        private Integer rollbackCount;
        /** 目标就绪日与实际发布日的差（天）；正数表示晚于目标 */
        private Integer delayDays;
    }

    @Data
    public static class PlanInfo {
        private String id;
        /** 空间内发布计划编号（sql/85），null 表示存量尚未取号 */
        private Integer planNo;
        private LocalDateTime plannedAt;
        private String status;
        private String statusName;
        private String environment;
        private String environmentName;
        private String coverage;
        private String ownerName;
        private List<String> targets = new ArrayList<String>();
        private Integer taskCount;
        private Integer versionCount;
        private List<String> versionNames = new ArrayList<String>();
        /** 计划覆盖的项目名（去重，与 versionNames 同源） */
        private List<String> projectNames = new ArrayList<String>();
        private String notes;
        /** 计划里写下的风险与回滚约定，原文引用，不改写 */
        private String risks;
    }

    /** 计划维度的一章：一个被覆盖版本的事实切片，不含人工叙述（叙述只在计划层） */
    @Data
    public static class PlanVersionChapter {
        private String versionId;
        private String versionName;
        private String reqId;
        private String projectName;
        private String versionStatus;
        private LocalDate targetDate;
        /** 本计划内是否已有成功生产发布（非回滚） */
        private Boolean released;
        private String evidenceKind;
        private ReleaseInfo release;
        private Counts counts;
        private Quality quality;
        private Defects defects;
        private Effort effort;
        private Acceptance acceptance;
    }

    @Data
    public static class Baseline {
        private LocalDateTime capturedAt;
        private Integer taskCount;
        private Integer estimateMinutes;
        private LocalDate targetDate;
        private Integer addedCount;
        private Integer addedEstimateMinutes;
        private Integer removedCount;
        private Integer removedEstimateMinutes;
        /** 基线建立晚于发布日：此前变更无对照，不反推 */
        private Boolean late;
        private List<String> addedTitles = new ArrayList<String>();
        private List<String> removedTitles = new ArrayList<String>();
    }

    @Data
    public static class Counts {
        /** 承诺台账 = 当前绑定本版本的工作项 + 基线内已移出的工作项 */
        private Integer planned;
        private Integer released;
        private Integer pending;
        private Integer deferred;
        private Integer done;
        private Integer doing;
        private Integer currentBound;
        /** 按需求性质统计本次已上线项：新功能 / 体验优化 / 缺陷 / 其他；未关联需求的工作项不进这四类 */
        private Integer newCount;
        private Integer improveCount;
        private Integer fixCount;
        private Integer otherCount;
        private Integer unlinkedCount;
    }

    @Data
    public static class ProjectRow {
        private String id;
        private String name;
        private Integer releasedCount;
        private Integer pendingCount;
        private Integer taskCount;
    }

    @Data
    public static class ScopeRow {
        private String id;
        /** 项目内工作项编号（WI-001）；空=尚未取号，展示回退原 ID */
        private Integer itemNo;
        private String title;
        private String module;
        private String itemType;
        private String itemTypeName;
        private String owner;
        /** released / pending / deferred / done */
        private String state;
        private String ref;
        private String demandId;
        private String demandTitle;
        private String targetVersionName;
        private Integer estimateMinutes;
        private Integer workMinutes;
        private String reason;
        /** 归属项目（跨项目发布时用于分组；单项目版本内同值） */
        private String projectId;
        private String projectName;
        /** 需求性质：new 新增 / improve 优化 / fix 修复 / other 其他；未关联需求时为空，不做推断 */
        private String kind;
        private String kindName;
        private LocalDateTime completedAt;
        /** 计划维度：该项所属版本；版本维度为空 */
        private String versionId;
        private String versionName;
    }

    @Data
    public static class DemandSummary {
        private Integer total;
        private Integer fulfilled;
        private Integer partial;
        private Integer deferred;
        private Integer pending;
        private Integer ratePct;
    }

    @Data
    public static class DemandRow {
        private String id;
        /** 项目内需求编号（sql/84），null 表示存量尚未取号 */
        private Integer demandNo;
        private String title;
        private String module;
        private String priority;
        private String source;
        private String acceptText;
        /** fulfilled / partial / deferred / pending */
        private String state;
        private Integer taskCount;
        private Integer releasedCount;
        private String targetVersionName;
        private LocalDate deliveredAt;
        private String note;
        /** 需求性质：new 新增 / improve 优化 / fix 修复 / other 其他；空=未记录 */
        private String kind;
        private String kindName;
        /** 计划维度：该需求所属版本；版本维度为空 */
        private String versionId;
        private String versionName;
    }

    @Data
    public static class ChangeRow {
        private LocalDate date;
        private String title;
        private List<String> tags = new ArrayList<String>();
        private String actorName;
        private String reason;
        private String source;
        /** add / move / date / scope / status */
        private String kind;
        /** 计划维度：该变更所属版本；版本维度为空 */
        private String versionId;
        private String versionName;
    }

    @Data
    public static class Quality {
        private String planId;
        private String planName;
        private String planStatus;
        private Integer planCount;
        private Integer caseCount;
        private Integer executedCount;
        private Integer passedCount;
        private Integer failedCount;
        private Integer blockedCount;
        private Integer skippedCount;
        private Integer unexecutedCount;
        /** 通过 / (已执行 - 跳过)；无有效分母时为 null */
        private Double passRatePct;
        private Double coveragePct;
        private Integer defectCount;
        private Boolean missing;
        /** 团队共享用例分组的结果分布；个人 / 指定成员分组不进证据链 */
        private List<java.util.Map<String, Object>> caseSets = new ArrayList<java.util.Map<String, Object>>();
    }

    @Data
    public static class Defects {
        private Integer totalCount;
        private Integer fixedCount;
        private Integer openCount;
        private Integer blockerOpenCount;
        private List<SeverityRow> bySeverity = new ArrayList<SeverityRow>();
        private List<DefectRow> open = new ArrayList<DefectRow>();
        private List<DefectRow> fixed = new ArrayList<DefectRow>();
        private Boolean missing;
    }

    @Data
    public static class SeverityRow {
        private String severity;
        private String severityName;
        private Integer total;
        private Integer open;
    }

    @Data
    public static class DefectRow {
        private String id;
        private Integer itemNo;
        private String title;
        private String severity;
        private String severityName;
        private String owner;
        private String boardColumn;
        private String columnName;
        private String regressionStatus;
        private String regressionName;
        private String environment;
        private String targetVersionName;
        private LocalDateTime completedAt;
        /** 阻塞验收：未关闭且严重度为 blocker/critical */
        private Boolean blocksAcceptance;
        private String note;
        /** 计划维度：缺陷所属项目（缺陷按项目记录，跨版本同项目会去重） */
        private String projectId;
        private String projectName;
    }

    @Data
    public static class Effort {
        private Integer workMinutes;
        private Integer estimateMinutes;
        private Integer deviationMinutes;
        private Double deviationPct;
        private Integer memberCount;
        private List<Bar> byModule = new ArrayList<Bar>();
        private List<Bar> byMember = new ArrayList<Bar>();
        private Boolean missing;
    }

    @Data
    public static class Bar {
        private String name;
        private Integer minutes;
        private Integer pct;
    }

    @Data
    public static class RiskRow {
        private String title;
        private String impact;
        private String owner;
        private String next;
        private String status;
        /** pri / warn / bad / "" */
        private String tone;
        private String refId;
        /** 计划维度：风险所属版本；版本维度为空 */
        private String versionId;
        private String versionName;
    }

    @Data
    public static class Acceptance {
        /** 验收依据：可核对的系统记录 */
        private List<String> basis = new ArrayList<String>();
        /** verified / partial / unverified */
        private String conclusionKind;
        private List<String> conditions = new ArrayList<String>();
        private Integer blockerCount;
        private Boolean signOffPending;
        private String note;
    }

    @Data
    public static class EvidenceRow {
        private String name;
        private String meta;
        private String icon;
        /** ok / warn / plum / "" */
        private String color;
        /** 0 关键 / 1 完整 / 2 含校验值 */
        private Integer level;
        private Boolean internal;
        private Boolean missing;
        /** 前端跳转目标视图 */
        private String view;
        private String refId;
        /** 计划维度：该证据所属版本；版本维度为空 */
        private String versionId;
        private String versionName;
    }

    @Data
    public static class CaliberRow {
        private String name;
        private String definition;
        private String source;
    }

    @Data
    public static class RevisionRow {
        private String id;
        private String docNo;
        private Integer seq;
        private String tone;
        private String createdByName;
        private LocalDateTime createdAt;
        private String contentHash;
        private Boolean shared;
    }
}