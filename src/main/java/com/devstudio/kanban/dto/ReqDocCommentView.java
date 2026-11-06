package com.devstudio.kanban.dto;

import lombok.Data;

import java.time.LocalDateTime;

/** 文档评论列表项（含评论人显示名） */
@Data
public class ReqDocCommentView {

    private String id;
    private String userId;
    private String userName;
    private String content;
    private String quoteText;
    private LocalDateTime createdAt;
    private boolean deletable;
}
