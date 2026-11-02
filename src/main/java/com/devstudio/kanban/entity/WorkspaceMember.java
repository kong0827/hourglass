package com.devstudio.kanban.entity;

import lombok.Data;

import java.time.LocalDateTime;

@Data
public class WorkspaceMember {

    private String workspaceId;
    private String userId;
    /** owner/member/exec（exec = 只读管理层） */
    private String role;
    private LocalDateTime createdAt;

    /** 非表字段：成员显示名与登录名（联查填充） */
    private String displayName;
    private String username;
}
