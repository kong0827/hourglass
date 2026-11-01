package com.devstudio.kanban.dto;

import lombok.Data;

/** 任务-标签关联的批量写入行（备份导入用） */
@Data
public class TaskTagRef {

    private String taskId;
    private String tagId;

    public TaskTagRef() {
    }

    public TaskTagRef(String taskId, String tagId) {
        this.taskId = taskId;
        this.tagId = tagId;
    }
}
