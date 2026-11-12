package com.hourglass.entity;

import lombok.Data;

import java.time.LocalDateTime;

/**
 * 项目角色展示标签：一个成员在一个项目只有一个主角色。
 * 只做识别与筛选，不参与任何鉴权。
 */
@Data
public class ProjectMemberRole {

    private String workspaceId;
    private String projectId;
    private String userId;
    private String roleTitle;
    private java.util.List<String> secondaryRoleTitles;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
