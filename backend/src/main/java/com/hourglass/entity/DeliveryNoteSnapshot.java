package com.hourglass.entity;

import lombok.Data;

import java.time.LocalDateTime;

/** 交付说明不可变快照：确认后冻结整份文档，内容哈希可对外核验。 */
@Data
public class DeliveryNoteSnapshot {

    private String id;
    private String workspaceId;
    private String versionId;
    private String reqId;
    /** 空 = 未确认发布的内部草稿快照 */
    private String releaseId;
    private Integer seq;
    private String docNo;
    private String tone;
    private String title;
    /** 整份文档的 JSON 载荷 */
    private String payload;
    private String contentHash;
    private String createdBy;
    private String createdByName;
    private LocalDateTime createdAt;
}