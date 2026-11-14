package com.hourglass.entity;

import lombok.Data;

import java.time.LocalDateTime;

/** 项目内文档；文档树与需求、工作项关联相互独立。 */
@Data
public class RequirementDoc {

    private String id;
    private String workspaceId;
    /** 所属项目 ID（requirement.id）；NULL = 空间级文档（不归属任何项目） */
    private String reqId;
    /** 父文档 ID（同范围层级，空 = 根文档） */
    private String parentId;
    /** 所属分类 ID（doc_category.id）；NULL = 未分类。分类是父子层级之上的归类层 */
    private String categoryId;
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
    /** 发布时间（空 = 草稿，仅作者与空间管理员可见） */
    private LocalDateTime publishedAt;
    private String owner;
    private String ownerUserId;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
