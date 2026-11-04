package com.devstudio.kanban.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import javax.validation.constraints.NotBlank;
import javax.validation.constraints.NotNull;

/** 对外字段沿用 inApp/email，实体中的 Enabled 后缀不暴露给前端。 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class NotificationPreferenceItem {

    @NotBlank(message = "通知事件不能为空")
    private String eventType;
    @NotNull(message = "站内通知开关不能为空")
    private Boolean inApp;
    @NotNull(message = "邮件通知开关不能为空")
    private Boolean email;
}
