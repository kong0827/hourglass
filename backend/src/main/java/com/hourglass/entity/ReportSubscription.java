package com.hourglass.entity;

import lombok.Data;

import java.time.LocalDateTime;

/** 个人定时报告订阅：周报按空间配置发送时间，版本报告在版本发布后触发。 */
@Data
public class ReportSubscription {

    public static final String WEEKLY = "weekly";
    public static final String VERSION = "version";

    private String id;
    private String workspaceId;
    private String userId;
    private String reportType;
    private Boolean enabled;
    /** inapp / email / both */
    private String channels;
    private Integer weekday;
    private Integer sendHour;
    private LocalDateTime lastSentAt;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
