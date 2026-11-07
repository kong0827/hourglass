package com.hourglass.entity;

import lombok.Data;

import java.time.LocalDateTime;

@Data
public class BoardColumn {

    private String id;
    private String workspaceId;
    private String name;
    private String color;
    private Integer sortOrder;
    private LocalDateTime createdAt;
}
