package com.devstudio.kanban.dto;

import lombok.Data;

import javax.validation.constraints.Email;
import javax.validation.constraints.Max;
import javax.validation.constraints.Min;
import javax.validation.constraints.NotNull;
import javax.validation.constraints.Size;

@Data
public class MailSettingsRequest {

    @NotNull(message = "SMTP 启用开关不能为空")
    private Boolean enabled;
    @Size(max = 255, message = "SMTP 主机名过长")
    private String host;
    @Min(value = 1, message = "SMTP 端口必须在 1-65535 之间")
    @Max(value = 65535, message = "SMTP 端口必须在 1-65535 之间")
    private Integer port;
    @Size(max = 254, message = "SMTP 用户名过长")
    private String username;
    /** 空字符串或 null 表示保留已保存密码 */
    @Size(max = 256, message = "SMTP 密码过长")
    private String password;
    @Email(message = "发件人邮箱格式不正确")
    @Size(max = 254, message = "发件人邮箱过长")
    private String fromEmail;
}
