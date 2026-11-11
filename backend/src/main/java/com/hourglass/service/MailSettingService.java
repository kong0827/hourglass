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

import java.util.ArrayList;
import java.util.List;
import java.util.Objects;

/** 管理员全局 SMTP 配置；复用 AI Key 的 AES-GCM 加密组件保存密码。 */
@Service
public class MailSettingService {

    private final MailSettingMapper mapper;
    private final AiCrypto crypto;
    /** 平台凭证变更：审计只记改了哪些项，不写主机凭据与密文 */
    private final AuditService auditService;

    public MailSettingService(MailSettingMapper mapper, AiCrypto crypto, AuditService auditService) {
        this.mapper = mapper;
        this.crypto = crypto;
        this.auditService = auditService;
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

        List<String> changed = new ArrayList<String>();
        if (old == null || !Objects.equals(old.getEnabled(), setting.getEnabled())) {
            changed.add("启用状态");
        }
        if (old == null || !Objects.equals(old.getHost(), setting.getHost())) {
            changed.add("主机");
        }
        if (old == null || !Objects.equals(old.getPort(), setting.getPort())) {
            changed.add("端口");
        }
        if (old == null || !Objects.equals(old.getUsername(), setting.getUsername())) {
            changed.add("账号");
        }
        if (old == null || !Objects.equals(old.getFromEmail(), setting.getFromEmail())) {
            changed.add("发件人");
        }
        if (req.getPassword() != null && !req.getPassword().isEmpty()) {
            changed.add("密码");
        }
        if (!changed.isEmpty()) {
            auditService.recordCurrent(null, "mail_settings_update", "mail_settings", "smtp", null, true,
                    (old == null ? "初始化邮件服务器配置：" : "修改邮件服务器配置：")
                            + String.join("、", changed), null);
        }
        return MailSettingsResponse.from(setting);
    }
}
