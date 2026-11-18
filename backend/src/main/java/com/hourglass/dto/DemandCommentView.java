package com.hourglass.dto;

import com.hourglass.entity.Attachment;
import lombok.Data;

import java.time.LocalDateTime;
import java.util.List;

/** 需求池评论列表项（含评论人显示名、回复、解决状态与附件） */
@Data
public class DemandCommentView {

    private String id;
    private String userId;
    private String userName;
    private String content;
    private String parentId;
    private LocalDateTime createdAt;
    private boolean deletable;
    private boolean resolved;
    private LocalDateTime resolvedAt;
    private String resolvedBy;
    private String resolvedByName;
    private List<String> mentionUserIds;
    private String taskId;
    private List<DemandCommentView> replies;
    /** 评论附件（图片、PDF 等，走通用 attachment 表 target_kind=demand_comment） */
    private List<Attachment> attachments;
}
