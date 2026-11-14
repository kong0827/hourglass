package com.hourglass.entity;

import lombok.Data;

import java.time.LocalDateTime;

/** 交付说明草稿与生成控制：按版本记忆，数字一律实时派生，这里只存人工层。 */
@Data
public class DeliveryNote {

    private String workspaceId;
    private String versionId;
    private String reqId;
    private String audience;
    private String supportContact;
    /** 生成控制 JSON：tone/scope/granularity/evidence/layout */
    private String options;
    /** 人工改写叙述 JSON，key = 区块字段 */
    private String narratives;
    /** 已确认的待确认项 key 列表 JSON */
    private String confirmed;
    private String acceptance;
    private String updatedBy;
    private Long revision;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}