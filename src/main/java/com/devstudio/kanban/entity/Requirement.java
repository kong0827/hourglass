package com.devstudio.kanban.entity;

import lombok.Data;

import java.time.LocalDateTime;

@Data
public class Requirement {

    private String id;
    private String workspaceId;
    private String name;
    private String description;
    /** active/done/hold */
    private String status;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
