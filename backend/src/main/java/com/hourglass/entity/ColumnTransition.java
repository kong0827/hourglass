package com.hourglass.entity;

import lombok.Data;

import java.time.LocalDateTime;

@Data
public class ColumnTransition {

    private String workspaceId;
    private String fromColumn;
    private String toColumn;
    private String rule;
    private LocalDateTime updatedAt;
}
