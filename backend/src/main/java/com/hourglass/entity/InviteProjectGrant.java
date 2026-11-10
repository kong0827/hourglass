package com.hourglass.entity;

import lombok.Data;

import java.time.LocalDateTime;

/** 邀请链接上预分配的项目权限：只存 write/read，未列出的项目默认不可见 */
@Data
public class InviteProjectGrant {

    private String inviteId;
    private String workspaceId;
    private String projectId;
    private String access;
    private LocalDateTime createdAt;
}
