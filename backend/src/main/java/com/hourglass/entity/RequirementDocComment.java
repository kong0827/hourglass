package com.hourglass.entity;

import lombok.Data;

import java.time.LocalDateTime;

/** 文档评论：对需求文档的批注与讨论 */
@Data
public class RequirementDocComment {

    private String id;
    private String workspaceId;
    private String docId;
    private String userId;
    /** 评论正文 */
    private String content;
    /** 被引用的正文片段（批注上下文，可选） */
    private String quoteText;
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
