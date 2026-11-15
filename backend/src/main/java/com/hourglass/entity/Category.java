package com.hourglass.entity;

import lombok.Data;

import java.time.LocalDateTime;

@Data
public class Category {

    private String id;
    private String workspaceId;
    /** 所属项目ID（requirement.id）；目录树挂在项目下，每个项目独立维护 */
    private String projectId;
    /** 父目录 ID，空串 = 顶级；任务、需求、用例共用同一棵树 */
    private String parentId;
    private String name;
    private String color;
    private Integer sortOrder;
    private LocalDateTime createdAt;
}
