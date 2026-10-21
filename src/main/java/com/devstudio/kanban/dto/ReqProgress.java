package com.devstudio.kanban.dto;

import lombok.Data;

@Data
public class ReqProgress {

    private String id;
    private String name;
    private String description;
    private String status;
    /** 任务平均进度 0-100 */
    private int progressPct;
    private int taskCount;
    private int doneCount;
}
