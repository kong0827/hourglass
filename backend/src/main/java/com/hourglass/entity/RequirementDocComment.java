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
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
