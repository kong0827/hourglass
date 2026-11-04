package com.devstudio.kanban.entity;

import lombok.Data;

import java.time.LocalDateTime;

/** 项目内文档；文档树与需求、工作项关联相互独立。 */
@Data
public class RequirementDoc {

    private String id;
    private String workspaceId;
    /** 所属项目 ID（requirement.id） */
    private String reqId;
    /** 父文档 ID（同项目内层级，空 = 根文档） */
    private String parentId;
    private String title;
    /** 分类代码，见 DocumentType */
    private String docType;
    /** 正文：html 为清洗后的 HTML；markdown 为原始 Markdown 文本 */
    private String content;
    /** 正文格式：html / markdown */
    private String format;
    /** 同级排序（小的在前） */
    private Integer sortOrder;
    /** 纯文本摘要（列表用，避免每次读 MEDIUMTEXT 全文） */
    private String contentBrief;
    /** 状态：draft / active / done */
    private String status;
    private String owner;
    private String ownerUserId;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
