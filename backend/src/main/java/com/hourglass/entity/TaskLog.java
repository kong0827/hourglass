package com.hourglass.entity;

import lombok.Data;

import java.time.LocalDateTime;

@Data
public class TaskLog {

    private Long id;
    private String taskId;
    private String workspaceId;
    /** 操作人用户ID（历史数据可空） */
    private String actorId;
    /** create/update/move/delete/restore/config（配置类，task_id 为 CFG 哨兵） */
    private String action;
    private String detail;
    /** 移动前所在列 id（仅 action=move 且跨列时非空；流程体检据此算列停留与回退） */
    private String fromColumn;
    /** 移动后所在列 id（仅 action=move 且跨列时非空） */
    private String toColumn;
    private LocalDateTime createdAt;

    /** 非表字段：操作人显示名（联查填充） */
    private String actorName;
    /** 非表字段：活动流用的任务标题（配置类事件为空） */
    private String taskTitle;
}
