package com.hourglass.dto;

import lombok.Data;

import java.util.List;

/**
 * 旧版前端备份文件结构（hourglass-backup.json），导入导出沿用同一格式
 */
@Data
public class BackupData {
    public static final int FORMAT_VERSION = 13;

    private Integer v;
    private String exportedAt;
    private List<BackupTask> tasks;
    private List<BackupReq> reqs;
    /** 看板列定义（跨空间导入时保证自定义列可用） */
    private List<BackupColumn> columns;
    /** 任务评论（v4 起纳入；旧备份没有该字段时导入会清空评论，前端会明确提示） */
    private List<BackupComment> comments;
    /** 需求文档（v6 起纳入；跨空间导入会重建并重映射项目/任务引用） */
    private List<BackupReqDoc> reqDocs;
    /** 分支池（v6 起纳入；不含分支操作时间线） */
    private List<BackupBranch> branches;
    /** 甘特图依赖（v5 起纳入；旧备份没有该字段时导入会清空依赖） */
    private List<BackupDependency> deps;
    /** 甘特图基线（v5 起纳入） */
    private List<BackupBaseline> baseline;
    /** 基线快照时间 */
    private String baselineAt;
    /** 项目版本（v8 起纳入；旧备份没有该字段时保留空间现有版本） */
    private List<BackupVersion> versions;
    /** 需求池（v8 起纳入；旧备份没有该字段时保留空间现有需求池） */
    private List<BackupDemand> demands;
    /** 需求池 ↔ 需求文档关联（v9；旧备份没有该字段时保留现状） */
    private List<BackupDemandDocLink> demandDocLinks;
    /** 测试用例（v10；旧备份没有该字段时保留现有用例） */
    private List<BackupTestCase> testCases;
    /** 测试用例执行流水（v10；依赖 testCases 的 ID 映射） */
    private List<BackupTestCaseRun> testCaseRuns;
    /** 需求文档评论（v10；旧备份没有该字段时保留现有评论） */
    private List<BackupDocComment> docComments;
    /** 模块字典（v11 起纳入；任务/需求按 ID 关联，导入时补齐缺失模块。旧备份没有该字段时，
        模块 ID 找不到的条目回落到空间第一个模块） */
    private List<BackupCategory> categories;

    @Data
    public static class BackupDependency {
        private String from;
        private String to;
        /** FS/SS/FF/SF */
        private String type;
        private Integer lag;
    }

    @Data
    public static class BackupBaseline {
        private String taskId;
        private String start;
        private String due;
    }

    @Data
    public static class BackupColumn {
        private String id;
        private String name;
        private String color;
        private String processingRule;
    }

    @Data
    public static class BackupTask {
        private String id;
        private String title;
        private String desc;
        private String pri;
        private String owner;
        /** 模块ID（category.id；v10 及更早的备份这里是模块名，导入时回落到默认模块） */
        private String cat;
        private String col;
        /** 开始日期（v3 备份没有该字段，导入时为空不影响兼容） */
        private String start;
        private String due;
        private Integer progress;
        private String note;
        private String reqId;
        /** 关联需求文档 / 分支 / 预估工时：任务数据的完整往返（v4 起） */
        private String reqDocId;
        private String branchId;
        private Integer estimateMinutes;
        private Boolean blocked;
        private String blockedReason;
        private String ownerUserId;
        private String remindTarget;
        private String completedAt;
        /** 测试负责人账号与显示名快照 */
        private String testOwnerUserId;
        private String testOwner;
        /** 提测时间 */
        private String testRequestedAt;
        /** 测试窗口：进入测试中 / 离开测试中的时间（旧备份为日期） */
        private String testStartedAt;
        private String testFinishedAt;
        private List<BackupSubtask> subtasks;
        private List<String> tags;
        private String recurType;
        /** 循环任务派生的下一次任务ID（恢复后重复完成时不重复生成） */
        private String recurNextId;
        private String remindAt;
        private Boolean remindSent;
        private List<BackupTimeLog> timeLogs;
        private String createdAt;
        /** 非空表示这条任务在回收站；导入时按原时间恢复（过期则由每日清理任务处理） */
        private String deletedAt;
        /** 里程碑（v5 起；旧备份没有该字段按普通任务处理） */
        private Boolean isMilestone;
        /** 工作项类型 task/story/bug/epic（v8 起；旧备份按 task 处理） */
        private String itemType;
        /** Epic 归属（v8 起；导入时按任务 ID 映射回指） */
        private String epicId;
        /** 关联需求池需求（v8 起；导入时按需求 ID 映射回指） */
        private String demandId;
        /** 规划版本数组；不携带正式发布事实或发布徽标。 */
        private List<String> versionIds;
        /** 缺陷严重度 blocker/critical/major/minor（v9 起） */
        private String severity;
        /** 发现环境（v9 起） */
        private String environment;
        /** 复现步骤（v9 起） */
        private String reproduceSteps;
        /** 发现版本ID（v9 起） */
        private String foundVersionId;
        /** 回归状态 pending/passed/failed（v9 起） */
        private String regressionStatus;
    }

    @Data
    public static class BackupTimeLog {
        private String userId;
        private String startedAt;
        private Integer minutes;
        /** timer=计时器；manual=手工补记。旧备份缺该字段，导入时按计时器处理 */
        private String origin;
        /** 手工补记备注 */
        private String note;
    }

    @Data
    public static class BackupSubtask {
        private String title;
        private Boolean done;
    }

    @Data
    public static class BackupReq {
        private String id;
        private String name;
        private String desc;
        private String status;
        private String createdAt;
        /** 首版上线日（v8 起；阶段统计的归组锚点） */
        private String firstReleasedAt;
    }

    @Data
    public static class BackupVersion {
        private String id;
        private String reqId;
        private String name;
        private String desc;
        /** planned/active/released/closed/canceled */
        private String status;
        private String startDate;
        private String targetDate;
        private String releasedAt;
        private String endedAt;
        private String endReason;
        /** 承诺基线快照时间；旧备份没有该字段时版本视为未快照 */
        private String commitmentAt;
        /** 开发启动时冻结的工作项与预估，导入时按任务 ID 映射回指 */
        private List<BackupCommitment> commitment;
        private String createdAt;
        private String updatedAt;
    }

    @Data
    public static class BackupCommitment {
        private String taskId;
        private String taskTitle;
        private Integer estimateMinutes;
    }

    @Data
    public static class BackupCategory {
        private String id;
        /** 所属项目ID（requirement.id）；模块清单挂在项目下 */
        private String projectId;
        private String name;
        private String color;
        private Integer sortOrder;
    }

    @Data
    public static class BackupDemand {
        private String id;
        private String reqId;
        private String title;
        private String desc;
        private String source;
        private String itemKind;
        /** 模块ID（category.id；空=未指定） */
        private String categoryId;
        private String priority;
        private String status;
        private String closeReason;
        private String closeStage;
        private String expectDate;
        /** 需求层计划日期；旧备份缺字段时保持为空，不从任务或版本日期推导 */
        private String plannedStart;
        private String plannedEnd;
        private String acceptText;
        private String versionId;
        private String reviewNote;
        private Integer wsjfBusiness;
        private Integer wsjfUrgency;
        private Integer wsjfRisk;
        private Integer wsjfEffort;
        private String createdBy;
        private String createdAt;
        private String updatedAt;
    }

    @Data
    public static class BackupDemandDocLink {
        private String demandId;
        private String docId;
        private String createdBy;
    }

    @Data
    public static class BackupTestCase {
        private String id;
        private String reqId;
        private String title;
        private String precondition;
        private String testData;
        /** 步骤 JSON 原文 */
        private String steps;
        private String latestStatus;
        private String latestNote;
        private String latestBy;
        private String latestByUserId;
        private String latestAt;
        private String latestBugTaskId;
        private String createdAt;
        private String updatedAt;
    }

    @Data
    public static class BackupTestCaseRun {
        private String id;
        private String caseId;
        private String status;
        private String note;
        private String bugTaskId;
        private String executedBy;
        private String executedByUserId;
        private String createdAt;
    }

    @Data
    public static class BackupDocComment {
        private String id;
        private String docId;
        private String userId;
        private String content;
        private String quoteText;
        private String createdAt;
    }

    @Data
    public static class BackupComment {
        private String taskId;
        private String authorId;
        private String authorName;
        private String content;
        private String createdAt;
    }

    @Data
    public static class BackupReqDoc {
        private String id;
        private String reqId;
        /** 上级文档（v7 起；导入时按旧 id 映射到新 id） */
        private String parentId;
        private String title;
        /** 文档分类；旧备份缺省归入其他 */
        private String docType;
        /** html=已清洗 HTML；markdown=Markdown 原文 */
        private String content;
        private String format;
        private String status;
        /** 发布时间（空=草稿）；旧备份没有该字段，导入时按已发布回填（同 sql/42 迁移口径） */
        private String publishedAt;
        private String owner;
        private String ownerUserId;
        private Integer sortOrder;
        private String createdAt;
        private String updatedAt;
    }

    @Data
    public static class BackupBranch {
        private String id;
        private String reqId;
        private String name;
        private String status;
        private String owner;
        private String ownerUserId;
        private String targetBranch;
        private String note;
        private String devAt;
        private String testAt;
        private String mergeAt;
        private String releasedAt;
        private Integer sortOrder;
        private String createdAt;
        private String updatedAt;
    }

    @Data
    public static class ImportResult {
        private int tasks;
        private int reqs;
        private int comments;
        /** v6：重建的需求文档数 */
        private int reqDocs;
        /** v6：重建的分支数 */
        private int branches;
        /** v8：重建的项目版本数 */
        private int versions;
        /** v8：重建的需求池条目数 */
        private int demands;
        /** v10：重建的测试用例数 */
        private int testCases;
        /** v10：重建的文档评论数 */
        private int docComments;
    }
}
