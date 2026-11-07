package com.hourglass.service;

import com.hourglass.common.AiCrypto;
import com.hourglass.common.AppException;
import com.hourglass.common.Texts;
import com.hourglass.dto.MailSettingsRequest;
import com.hourglass.dto.MailSettingsResponse;
import com.hourglass.entity.MailSetting;
import com.hourglass.mapper.MailSettingMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 管理员全局 SMTP 配置；复用 AI Key 的 AES-GCM 加密组件保存密码。 */
@Service
public class MailSettingService {

    private final MailSettingMapper mapper;
    private final AiCrypto crypto;

    public MailSettingService(MailSettingMapper mapper, AiCrypto crypto) {
        this.mapper = mapper;
        this.crypto = crypto;
    }

    public MailSetting get() {
        return mapper.select();
    }

    public MailSettingsResponse response() {
        return MailSettingsResponse.from(get());
    }

    @Transactional
    public MailSettingsResponse update(MailSettingsRequest req) {
        boolean enabled = Boolean.TRUE.equals(req.getEnabled());
        String host = Texts.trimToNull(req.getHost());
        String fromEmail = Texts.trimToNull(req.getFromEmail());
        Integer port = req.getPort() == null ? 587 : req.getPort();
        if (enabled && host == null) {
            throw AppException.badRequest("启用 SMTP 时必须填写主机名");
        }
        if (enabled && fromEmail == null) {
            throw AppException.badRequest("启用 SMTP 时必须填写发件人邮箱");
        }

        MailSetting old = get();
        String password = old == null ? null : old.getPassword();
        // 空密码表示保留；只有真正输入新密码时才重新加密。
        if (req.getPassword() != null && !req.getPassword().isEmpty()) {
            password = crypto.encrypt(req.getPassword());
        }
        MailSetting setting = new MailSetting();
        setting.setId(1);
        setting.setEnabled(enabled);
        setting.setHost(host);
        setting.setPort(port);
        setting.setUsername(Texts.trimToNull(req.getUsername()));
        setting.setPassword(password);
        setting.setFromEmail(fromEmail);
        mapper.upsert(setting);
        return MailSettingsResponse.from(setting);
    }
}
