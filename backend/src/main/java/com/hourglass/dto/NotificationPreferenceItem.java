package com.hourglass.dto;

import lombok.Data;
import lombok.NoArgsConstructor;

import javax.validation.constraints.NotBlank;
import javax.validation.constraints.NotNull;

/** 对外字段沿用 inApp/email/wecom，实体中的 Enabled 后缀不暴露给前端。 */
@Data
@NoArgsConstructor
public class NotificationPreferenceItem {

    @NotBlank(message = "通知事件不能为空")
    private String eventType;
    @NotNull(message = "站内通知开关不能为空")
    private Boolean inApp;
    @NotNull(message = "邮件通知开关不能为空")
    private Boolean email;
    /** 企业微信：只有指派/测试指派/发布准备支持，其余事件返回 null（前端显示 —） */
    private Boolean wecom;

    public NotificationPreferenceItem(String eventType, Boolean inApp, Boolean email) {
        this.eventType = eventType;
        this.inApp = inApp;
        this.email = email;
    }

    public NotificationPreferenceItem(String eventType, Boolean inApp, Boolean email, Boolean wecom) {
        this.eventType = eventType;
        this.inApp = inApp;
        this.email = email;
        this.wecom = wecom;
    }
}
