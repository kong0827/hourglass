package com.devstudio.kanban.dto;

import lombok.Data;

@Data
public class ReqProgress {

    private String id;
    private String name;
    private String description;
    private String status;
    /** 首版上线日（null = 尚未标记；阶段视图项目切换用） */
    private java.time.LocalDate firstReleasedAt;
    /** 任务平均进度 0-100 */
    private int progressPct;
    private int taskCount;
    private int doneCount;
    /** 该项目下的需求文档数（删除项目会连带删除，确认框据此提示） */
    private int docCount;
    /** 该项目下的版本数（删除项目会连带删除，确认框据此提示） */
    private int versionCount;
    /** 该项目下的需求池记录数（删除项目会连带删除，确认框据此提示） */
    private int demandCount;
    private java.time.LocalDateTime createdAt;
    private java.time.LocalDateTime updatedAt;
    /** 当前用户对该项目的写权限：read=只读，write=可编辑；前端据此收敛写入口 */
    private String access;
}
