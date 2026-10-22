package com.devstudio.kanban.entity;

import lombok.Data;

import java.time.LocalDateTime;

/**
 * 需求：挂在项目（requirement）下面的一层，带富文本正文。
 *
 * <p>层级：空间 → 项目(requirement) → **需求(requirement_doc)** → 任务(task.req_doc_id)。
 * 正文 {@code content} 存的是**已清洗**的 HTML（服务端 {@code RequirementDocService.sanitize}）。
 */
@Data
public class RequirementDoc {

    private String id;
    private String workspaceId;
    /** 所属项目 ID（requirement.id） */
    private String reqId;
    private String title;
    /** 正文 HTML（清洗后） */
    private String content;
    /** 状态：draft / active / done */
    private String status;
    private String owner;
    private String ownerUserId;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
