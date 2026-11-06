package com.devstudio.kanban.entity;

import lombok.Data;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

@Data
public class ProjectVersion {

    private String id;
    private String workspaceId;
    private String reqId;
    private String name;
    private String description;
    /** planned/active/released */
    private String status;
    private LocalDate startDate;
    private LocalDate targetDate;
    private LocalDateTime releasedAt;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    private Integer taskCount;
    private Integer doneCount;
    private Integer progressPct;
    private List<Task> tasks;
}
