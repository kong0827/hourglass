package com.devstudio.kanban.entity;

import lombok.Data;

import java.time.LocalDateTime;

/** 优先级显示配置（按空间）：档位 code 固定 P0-P3，仅名称与颜色可配；无行时用内置默认 */
@Data
public class WorkspacePriority {

    private String id;
    private String workspaceId;
    private String code;
    private String name;
    private String color;
    private LocalDateTime createdAt;
}
