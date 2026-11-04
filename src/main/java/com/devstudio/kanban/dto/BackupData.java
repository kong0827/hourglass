package com.devstudio.kanban.dto;

import lombok.Data;

import java.util.List;

/**
 * 旧版前端备份文件结构（devstudio-kanban-backup.json），导入导出沿用同一格式
 */
@Data
public class BackupData {

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
    }

    @Data
    public static class BackupTask {
        private String id;
        private String title;
        private String desc;
        private String pri;
        private String owner;
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
        /** 所属版本（v8 起；一个任务最多归属一个版本） */
        private String versionId;
    }

    @Data
    public static class BackupTimeLog {
        private String userId;
        private String startedAt;
        private Integer minutes;
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
        /** planned/active/released */
        private String status;
        private String targetDate;
        private String releasedAt;
        private String createdAt;
        private String updatedAt;
    }

    @Data
    public static class BackupDemand {
        private String id;
        private String reqId;
        private String title;
        private String desc;
        private String source;
        private String itemKind;
        private String priority;
        private String status;
        private String expectDate;
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
    }
}
