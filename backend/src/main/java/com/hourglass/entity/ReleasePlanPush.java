package com.hourglass.entity;

import lombok.Data;

import java.time.LocalDateTime;

/** 一次「通知成员」= 一个推送批次；回执挂在收件人上，不挂在计划上。 */
@Data
public class ReleasePlanPush {
    private String id;
    private String workspaceId;
    private String planId;
    private String scope;
    private String senderId;
    private String senderName;
    private Boolean onlyUnconfirmed;
    /** 逗号分隔：in_app,email,group */
    private String channels;
    /** 发送时的补充说明（选填，最多 200 字） */
    private String note;
    private Integer recipientCount;
    /** 企业微信群发送结果：1 成功 / 0 失败 / NULL 未选群或历史未记录 */
    private Boolean groupSent;
    /** 企业微信群未发送原因 */
    private String groupError;
    private Integer inAppCount;
    private Integer emailCount;
    private Integer ackedCount;
    private LocalDateTime createdAt;
}
