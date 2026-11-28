package com.hourglass.entity;

import lombok.Data;

/** 用户对固定业务事件的站内/邮件/企微开关；没有记录时由 Service 给出默认值。 */
@Data
public class UserNotificationPreference {

    private String userId;
    private String eventType;
    private Boolean inAppEnabled;
    private Boolean emailEnabled;
    /** 只对指派、测试指派、发布准备有意义；null 表示沿用默认 */
    private Boolean wecomEnabled;
}
