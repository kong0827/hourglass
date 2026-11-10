package com.hourglass.entity;

import lombok.Data;

import java.time.LocalDateTime;

@Data
public class WorkspaceMember {

    private String workspaceId;
    private String userId;
    /** owner/admin/member/viewer */
    private String role;
    /** all=默认参与；assigned=按项目分配（未显式授权即不可见） */
    private String projectAccessMode;
    private LocalDateTime createdAt;

    /** 非表字段：成员显示名与登录名（联查填充） */
    private String displayName;
    private String username;
}
