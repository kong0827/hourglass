package com.hourglass.entity;

import lombok.Data;

import java.time.LocalDateTime;

/** 交付说明不可变快照：确认后冻结整份文档，内容哈希可对外核验。 */
@Data
public class DeliveryNoteSnapshot {

    private String id;
    private String workspaceId;
    /** version / plan：版本快照与计划快照共用一条快照/分享管线 */
    private String scopeType;
    /** 版本 ID 或发布计划 ID；存量行已回填为 version_id */
    private String scopeId;
    /** 冻结时的范围名称（版本名或计划名） */
    private String scopeName;
    /** 计划快照为空；存量版本快照保留 */
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