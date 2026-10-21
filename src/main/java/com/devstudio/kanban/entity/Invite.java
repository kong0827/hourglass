package com.devstudio.kanban.entity;

import lombok.Data;

import java.time.LocalDateTime;

/** 空间邀请链接：空间主生成，凭链接创建账号或登录后加入共享空间 */
@Data
public class Invite {

    /** 邀请码（随机大写字母数字，10 位） */
    private String id;
    private String workspaceId;
    private String createdBy;
    private LocalDateTime expiresAt;
    private Integer usedCount;
    private LocalDateTime createdAt;
}
