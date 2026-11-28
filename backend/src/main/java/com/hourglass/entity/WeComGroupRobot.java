package com.hourglass.entity;

import com.fasterxml.jackson.annotation.JsonIgnore;
import lombok.Data;

import java.time.LocalDateTime;

/** 空间按企业配置的企业微信群机器人。Webhook 只存密文，永不下发前端。 */
@Data
public class WeComGroupRobot {

    private String id;
    private String workspaceId;
    /** 所属企业 CorpID，必须是本空间已启用的企业 */
    private String corpId;
    /** 企业名称，列表展示用 */
    private String corpName;
    private String name;
    @JsonIgnore
    private String webhookCipher;
    /** active/disabled */
    private String status;
    private LocalDateTime lastSentAt;
    private String lastResult;
    private String createdBy;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}