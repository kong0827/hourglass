package com.hourglass.dto;

import lombok.Data;

import java.time.LocalDateTime;
import java.util.List;

/** 文档评论列表项（含评论人显示名、回复与解决状态） */
@Data
public class ReqDocCommentView {

    private String id;
    private String userId;
    private String userName;
    private String content;
    private String quoteText;
    private String parentId;
    private LocalDateTime createdAt;
    private boolean deletable;
    private boolean resolved;
    private LocalDateTime resolvedAt;
    private String resolvedBy;
    private String resolvedByName;
    private List<String> mentionUserIds;
    private String taskId;
    private List<ReqDocCommentView> replies;
}
