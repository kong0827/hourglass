package com.devstudio.kanban.entity;

import lombok.Data;

/** 每任务评论数聚合（非表字段，看板角标用） */
@Data
public class TaskCountAgg {
    private String taskId;
    private Integer cnt;
}
