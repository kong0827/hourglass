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
        private String notes;
        /** 计划里写下的风险与回滚约定，原文引用，不改写 */
        private String risks;
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
        private LocalDate completedAt;
        /** 阻塞验收：未关闭且严重度为 blocker/critical */
        private Boolean blocksAcceptance;
        private String note;
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