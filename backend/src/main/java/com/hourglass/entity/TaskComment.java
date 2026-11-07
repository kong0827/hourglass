package com.hourglass.entity;

import lombok.Data;

import java.time.LocalDateTime;

/** 任务评论（人工讨论，与 task_log 的系统动作分开存） */
@Data
public class TaskComment {

    private Long id;
    private String taskId;
    private String workspaceId;
    private String authorId;
    /** 作者显示名快照：作者改名或被删后历史评论仍可读 */
    private String authorName;
    private String content;
    private LocalDateTime createdAt;

    /** 非表字段：作者当前显示名（联表取，优先于快照） */
    private String currentAuthorName;
}
