package com.devstudio.kanban.entity;

import lombok.Data;

import java.time.LocalDateTime;

@Data
public class Attachment {

    private String id;
    private String taskId;
    private String workspaceId;
    private String filename;
    private String contentType;
    private Long size;
    private String storedName;
    private LocalDateTime createdAt;
}
