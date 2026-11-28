package com.hourglass.entity;

import lombok.Data;

import java.time.LocalDateTime;

/** 空间启用了哪些企业微信企业。 */
@Data
public class WeComCorpSpace {

    private String workspaceId;
    private String corpId;
    private String createdBy;
    private LocalDateTime createdAt;
}