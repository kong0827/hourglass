package com.devstudio.kanban.dto;

import lombok.Data;

import java.time.LocalDateTime;

/** 文档分享公开页数据：只含正文与展示字段，不含评论、历史与内部 ID */
@Data
public class ReqDocShareResponse {

    private String workspaceName;
    private String docId;
    private String title;
    private String docType;
    /** 正文格式：html / markdown */
    private String format;
    private String content;
    private String status;
    private String owner;
    private LocalDateTime updatedAt;
    private LocalDateTime generatedAt;
}
