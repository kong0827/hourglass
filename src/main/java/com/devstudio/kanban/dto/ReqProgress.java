package com.devstudio.kanban.dto;

import lombok.Data;

import java.time.LocalDate;

@Data
public class ReqProgress {

    private String id;
    private String name;
    private String description;
    private String status;
    /* 管理字段：项目页“项目资料”入口使用 */
    private String managerUserId;
    private LocalDate startDate;
    private LocalDate dueDate;
    private String priority;
    /** 任务平均进度 0-100 */
    private int progressPct;
    private int taskCount;
    private int doneCount;
    /** 该项目下的需求文档数（删除项目会连带删除，确认框据此提示） */
    private int docCount;
}
