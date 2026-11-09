package com.hourglass.entity;

import lombok.Data;

import java.time.LocalDateTime;

@Data
public class Category {

    private String id;
    private String workspaceId;
    /** 所属项目ID（requirement.id）；模块清单挂在项目下，每个项目独立维护 */
    private String projectId;
    private String name;
    private String color;
    private Integer sortOrder;
    private LocalDateTime createdAt;
}
