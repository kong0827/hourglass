package com.devstudio.kanban.dto;

import com.devstudio.kanban.entity.MailSetting;
import lombok.Data;

/** SMTP 响应只说明是否已设置密码，不返回明文或密文。 */
@Data
public class MailSettingsResponse {

    private Boolean enabled;
    private String host;
    private Integer port;
    private String username;
    private Boolean passwordSet;
    private String fromEmail;

    public static MailSettingsResponse from(MailSetting setting) {
        MailSettingsResponse r = new MailSettingsResponse();
        if (setting == null) {
            r.setEnabled(Boolean.FALSE);
            r.setPort(587);
            r.setPasswordSet(Boolean.FALSE);
            return r;
        }
        r.setEnabled(Boolean.TRUE.equals(setting.getEnabled()));
        r.setHost(setting.getHost());
        r.setPort(setting.getPort());
        r.setUsername(setting.getUsername());
        r.setPasswordSet(setting.getPassword() != null && !setting.getPassword().isEmpty());
        r.setFromEmail(setting.getFromEmail());
        return r;
    }
}
