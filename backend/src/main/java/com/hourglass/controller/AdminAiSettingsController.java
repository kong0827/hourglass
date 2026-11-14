package com.hourglass.controller;

import com.hourglass.common.ApiResult;
import com.hourglass.common.AppException;
import com.hourglass.common.CurrentUser;
import com.hourglass.dto.SharedAiSettingsRequest;
import com.hourglass.dto.SharedAiSettingsView;
import com.hourglass.entity.AppUser;
import com.hourglass.mapper.UserMapper;
import com.hourglass.service.SharedAiSettingService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import javax.validation.Valid;
import java.util.Map;

/** 团队 AI 管理。SecurityConfig 与数据库实时角色双重校验管理员权限。 */
@RestController
public class AdminAiSettingsController {

    private final SharedAiSettingService settingService;
    private final UserMapper userMapper;

    public AdminAiSettingsController(SharedAiSettingService settingService, UserMapper userMapper) {
        this.settingService = settingService;
        this.userMapper = userMapper;
    }

    @GetMapping("/api/admin/ai-settings")
    public ApiResult<SharedAiSettingsView> get() {
        requireAdmin();
        return ApiResult.ok(settingService.view());
    }

    @PutMapping("/api/admin/ai-settings")
    public ApiResult<SharedAiSettingsView> update(@Valid @RequestBody SharedAiSettingsRequest req) {
        AppUser me = requireAdmin();
        return ApiResult.ok(settingService.update(req, displayName(me)));
    }

    /** 用表单当前值测一次，不落库；确认可用再保存。 */
    @PostMapping("/api/admin/ai-settings/test")
    public ApiResult<Map<String, Object>> test(@RequestBody(required = false) SharedAiSettingsRequest req) {
        requireAdmin();
        return ApiResult.ok(settingService.test(req));
    }

    private AppUser requireAdmin() {
        AppUser me = userMapper.selectById(CurrentUser.id());
        if (me == null || !"admin".equals(me.getRole())) {
            throw new AppException(403, "没有权限执行该操作");
        }
        return me;
    }

    private static String displayName(AppUser u) {
        String name = u.getDisplayName();
        return name == null || name.trim().isEmpty() ? u.getUsername() : name;
    }
}
