package com.hourglass.entity;

import lombok.Data;

import java.time.LocalDateTime;

@Data
public class Tag {

    private String id;
    private String workspaceId;
    private String name;
    private LocalDateTime createdAt;
}
