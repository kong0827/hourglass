package com.hourglass.dto;

import lombok.Data;

import java.time.LocalDateTime;

/** 文档最近动态条目：活动记录 + 所属文档标题（已删除的文档活动会随文档清理，这里只做可见性过滤） */
@Data
public class ReqDocActivityView {

    private Long id;
    private String docId;
    private String docTitle;
    private String reqId;
    private String actorName;
    private String action;
    private String detail;
    private LocalDateTime createdAt;

    /** 以下两字段仅用于服务层过滤草稿可见性，返回前端前置空 */
    private transient String ownerUserId;
    private transient LocalDateTime publishedAt;
}
