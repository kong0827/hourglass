package com.hourglass.entity;

import lombok.Data;

import java.time.LocalDateTime;

/** 交付说明分享的一次访问：打开、密码通过或下载，用于分享效果统计。 */
@Data
public class DeliveryNoteShareVisit {

    private String id;
    private String workspaceId;
    private String snapshotId;
    private String shareToken;
    /** view=打开页面，unlock=密码校验通过，download=下载 */
    private String action;
    private String ip;
    private String userAgent;
    private String referer;
    private String domain;
    private LocalDateTime createdAt;
}
