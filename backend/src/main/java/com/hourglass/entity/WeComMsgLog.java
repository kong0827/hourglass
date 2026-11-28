package com.hourglass.entity;

import lombok.Data;

import java.time.LocalDateTime;

/** 企业微信应用消息发送日志；按企业记录，失败可重试。 */
@Data
public class WeComMsgLog {

    private String id;
    private String workspaceId;
    private String corpId;
    private String agentId;
    private String eventType;
    private String touserText;
    private String msgtype;
    private String title;
    private String payloadJson;
    /** success/partial/failed */
    private String status;
    private Integer errcode;
    private String errmsg;
    private String invaliduser;
    private String msgid;
    private Integer attempts;
    private LocalDateTime nextRetryAt;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}