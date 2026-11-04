package com.devstudio.kanban.entity;

import com.fasterxml.jackson.annotation.JsonIgnore;
import lombok.Data;

/** 全局单行 SMTP 配置。password 为 AES-GCM 密文，绝不能经接口返回。 */
@Data
public class MailSetting {

    private Integer id;
    private Boolean enabled;
    private String host;
    private Integer port;
    private String username;
    @JsonIgnore
    private String password;
    private String fromEmail;
}
