package com.devstudio.kanban.entity;

import lombok.Data;

import java.time.LocalDateTime;

/**
 * 项目级成员可见范围。没有记录 = 默认参与（保持存量数据全员可见）。
 */
@Data
public class ProjectMember {

    private String workspaceId;
    private String projectId;
    private String userId;
    /** none / read / pm / dev / qa */
    private String access;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
