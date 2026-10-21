package com.devstudio.kanban.entity;

import lombok.Data;

import java.time.LocalDateTime;

@Data
public class Subtask {

    private Long id;
    private String taskId;
    private String workspaceId;
    private String title;
    private Boolean done;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
