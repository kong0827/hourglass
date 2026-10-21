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
    }

    @Data
    public static class ImportResult {
        private int tasks;
        private int reqs;
    }
}
