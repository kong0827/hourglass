package com.hourglass.entity;

import com.fasterxml.jackson.annotation.JsonIgnore;
import lombok.Data;

import java.time.LocalDateTime;

/** 企业微信企业配置：一个部署可登记多家，空间按需启用。 */
@Data
public class WeComCorp {

    private String id;
    /** 入口短键：/wecom/entry?c=<corpKey>；不可猜测，可重置 */
    private String corpKey;
    /** 企业 CorpID，也是 OAuth 的 appid */
    private String corpId;
    private String corpName;
    private String agentId;
    /** 应用 Secret 密文（AES-GCM）；永不下发前端 */
    @JsonIgnore
    private String secretCipher;
    /** 该企业可信域名下的沙漏根地址，如 https://pm.corp.com/hourglass */
    private String callbackBaseUrl;
    /** self_built=自建应用；agent=代开发（预留） */
    private String authMode;
    /** active/disabled */
    private String status;
    private String remark;
    private String createdBy;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}