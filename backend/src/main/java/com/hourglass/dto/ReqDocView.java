package com.hourglass.dto;

import lombok.Data;

import java.time.LocalDateTime;

/** 文档列表项：不带完整正文，只给纯文本摘要 + 项目名 + 关联任务数 */
@Data
public class ReqDocView {

    private String id;
    private String reqId;
    /** 父文档 ID（空 = 根文档） */
    private String parentId;
    /** 所属项目名 */
    private String reqName;
    private String title;
    /** 分类代码，见 DocumentType */
    private String docType;
    /** 正文格式：html / markdown */
    private String format;
    private Integer sortOrder;
    private String status;
    private String owner;
    /** 负责人账号 ID（草稿可见性按作者判定） */
    private String ownerUserId;
    /** 发布时间（空 = 草稿） */
    private LocalDateTime publishedAt;
    /** 正文纯文本摘要（服务端从 HTML 抽出来，最长 80 字） */
    private String excerpt;
    private Integer taskCount;
    private Integer doneCount;
    private LocalDateTime updatedAt;
    /** 创建时间（列表里展示「谁在什么时候建的」） */
    private LocalDateTime createdAt;

    /** 仅用于 SQL 取正文片段，服务层转成 excerpt 后置空，不返回给前端 */
    private transient String contentBrief;
}
