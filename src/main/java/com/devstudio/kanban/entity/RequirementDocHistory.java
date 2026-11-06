package com.devstudio.kanban.entity;

import lombok.Data;

import java.time.LocalDateTime;

/** 文档历史快照：正文有变化时自动留存一版，用于查看与恢复旧版本 */
@Data
public class RequirementDocHistory {

    private String id;
    private String docId;
    private String workspaceId;
    /** 同一文档内从 1 递增 */
    private Integer versionNo;
    private String title;
    private String content;
    private String format;
    /** 保存人显示名 */
    private String savedBy;
    private String savedByUserId;
    private LocalDateTime createdAt;
}
