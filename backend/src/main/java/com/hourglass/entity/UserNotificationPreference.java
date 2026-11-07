package com.hourglass.entity;

import lombok.Data;

/** 用户对固定业务事件的站内/邮件开关；没有记录时由 Service 给出默认值。 */
@Data
public class UserNotificationPreference {

    private String userId;
    private String eventType;
    private Boolean inAppEnabled;
    private Boolean emailEnabled;
}
