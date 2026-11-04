package com.devstudio.kanban.controller;

import com.devstudio.kanban.common.ApiResult;
import com.devstudio.kanban.common.AppException;
import com.devstudio.kanban.common.CurrentUser;
import com.devstudio.kanban.dto.MailSettingsRequest;
import com.devstudio.kanban.dto.MailSettingsResponse;
import com.devstudio.kanban.entity.AppUser;
import com.devstudio.kanban.mapper.UserMapper;
import com.devstudio.kanban.service.MailSettingService;
import com.devstudio.kanban.service.SmtpMailService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import javax.validation.Valid;
import java.util.LinkedHashMap;
import java.util.Map;

/** 全局 SMTP 管理。SecurityConfig 与数据库实时角色双重校验管理员权限。 */
@RestController
public class AdminMailSettingsController {

    private final MailSettingService settingService;
    private final SmtpMailService smtp;
    private final UserMapper userMapper;

    public AdminMailSettingsController(MailSettingService settingService, SmtpMailService smtp,
                                       UserMapper userMapper) {
        this.settingService = settingService;
        this.smtp = smtp;
        this.userMapper = userMapper;
    }

    @GetMapping("/api/admin/mail-settings")
    public ApiResult<MailSettingsResponse> get() {
        requireAdmin();
        return ApiResult.ok(settingService.response());
    }

    @PutMapping("/api/admin/mail-settings")
    public ApiResult<MailSettingsResponse> update(@Valid @RequestBody MailSettingsRequest req) {
        requireAdmin();
        return ApiResult.ok(settingService.update(req));
    }

    @PostMapping("/api/admin/mail-settings/test")
    public ApiResult<Map<String, Object>> test() {
        AppUser me = requireAdmin();
        if (me.getEmail() == null || me.getEmail().trim().isEmpty()) {
            throw AppException.badRequest("请先在个人资料中填写当前管理员邮箱");
        }
        try {
            smtp.send(me.getEmail(), "DevStudio SMTP 测试邮件", "这是一封 SMTP 配置测试邮件。");
        } catch (AppException e) {
            throw e;
        } catch (Exception e) {
            throw AppException.badRequest("测试邮件发送失败：" + SmtpMailService.errorMessage(e));
        }
        Map<String, Object> result = new LinkedHashMap<String, Object>();
        result.put("sent", Boolean.TRUE);
        result.put("recipient", me.getEmail());
        return ApiResult.ok(result);
    }

    private AppUser requireAdmin() {
        AppUser me = userMapper.selectById(CurrentUser.id());
        if (me == null || !"admin".equals(me.getRole())) {
            throw new AppException(403, "没有权限执行该操作");
        }
        return me;
    }
}
