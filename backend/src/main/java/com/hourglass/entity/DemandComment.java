package com.hourglass.entity;

import lombok.Data;

import java.time.LocalDateTime;

/** 需求池评论：对需求条目的讨论、解决状态与转工作项回链 */
@Data
public class DemandComment {

    private String id;
    private String workspaceId;
    private String demandId;
    private String userId;
    private String content;
    /** 父评论 ID（一层回复；空 = 顶层评论） */
    private String parentId;
    /** 解决时间（空 = 未解决） */
    private LocalDateTime resolvedAt;
    /** 解决人账号 ID */
    private String resolvedBy;
    /** @提及账号 ID JSON 数组 */
    private String mentions;
    /** 由评论转出的工作项 ID */
    private String taskId;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
