package com.devstudio.kanban.controller;

import com.devstudio.kanban.common.ApiResult;
import com.devstudio.kanban.common.CurrentUser;
import com.devstudio.kanban.common.LoginUser;
import com.devstudio.kanban.config.SessionEpochFilter;
import com.devstudio.kanban.dto.NotificationPreferenceUpdateRequest;
import com.devstudio.kanban.dto.PasswordChangeRequest;
import com.devstudio.kanban.dto.ProfileUpdateRequest;
import com.devstudio.kanban.dto.WorkHoursRequest;
import com.devstudio.kanban.entity.AppUser;
import com.devstudio.kanban.mapper.UserMapper;
import com.devstudio.kanban.service.AccountSecurityMailService;
import com.devstudio.kanban.service.UserNotificationPreferenceService;
import com.devstudio.kanban.service.UserService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import javax.servlet.http.HttpServletRequest;
import javax.validation.Valid;
import java.util.LinkedHashMap;
import java.util.Map;

@RestController
public class AuthController {

    private final UserMapper userMapper;
    private final UserService userService;
    private final UserNotificationPreferenceService preferenceService;
    private final com.devstudio.kanban.service.SessionEpochService sessionEpochs;
    private final AccountSecurityMailService securityMail;

    public AuthController(UserMapper userMapper, UserService userService,
                          UserNotificationPreferenceService preferenceService,
                          com.devstudio.kanban.service.SessionEpochService sessionEpochs,
                          AccountSecurityMailService securityMail) {
        this.userMapper = userMapper;
        this.userService = userService;
        this.preferenceService = preferenceService;
        this.sessionEpochs = sessionEpochs;
        this.securityMail = securityMail;
    }

    /** 当前登录用户信息（前端据此决定管理入口、上次空间、负责人默认名等） */
    @GetMapping("/api/auth/me")
    public ApiResult<Map<String, Object>> me() {
        LoginUser u = CurrentUser.get();
        AppUser db = userMapper.selectById(u.getId());
        Map<String, Object> data = new LinkedHashMap<String, Object>();
        data.put("id", u.getId());
        data.put("username", u.getUsername());
        data.put("displayName", u.getDisplayName());
        data.put("email", db == null ? null : db.getEmail());
        data.put("role", db != null ? db.getRole() : u.getRole());
        data.put("lastWorkspaceId", db == null ? null : db.getLastWorkspaceId());
        /* 计时设置：只有工作时段内累计、每天有上限（没配置过就是 9-18 / 8 小时） */
        data.put("workStartHour", db == null || db.getWorkStartHour() == null ? 9 : db.getWorkStartHour());
        data.put("workEndHour", db == null || db.getWorkEndHour() == null ? 18 : db.getWorkEndHour());
        data.put("workMaxHours", db == null || db.getWorkMaxHours() == null ? 8 : db.getWorkMaxHours());
        return ApiResult.ok(data);
    }

    /** 修改自己的密码（校验旧密码）；改完只保留当前会话，其他旧会话全部失效 */
    @PostMapping("/api/auth/password")
    public ApiResult<Void> changePassword(@Valid @RequestBody PasswordChangeRequest req,
                                          HttpServletRequest request) {
        String userId = CurrentUser.id();
        userService.changePassword(userId, req);
        request.getSession(true).setAttribute(SessionEpochFilter.SESSION_KEY, sessionEpochs.current(userId));
        securityMail.passwordChanged(userMapper.selectById(userId));
        return ApiResult.ok();
    }

    /** 修改自己的显示名（负责人默认值与成员列表展示随之更新；历史任务上的负责人名保留快照） */
    @PutMapping("/api/auth/profile")
    public ApiResult<Map<String, Object>> updateProfile(@Valid @RequestBody ProfileUpdateRequest req) {
        AppUser before = userMapper.selectById(CurrentUser.id());
        AppUser u = userService.updateProfile(CurrentUser.id(), req);
        if (before != null && !java.util.Objects.equals(before.getEmail(), u.getEmail())) {
            securityMail.emailChanged(before.getEmail(), u.getEmail());
        }
        Map<String, Object> data = new LinkedHashMap<String, Object>();
        data.put("displayName", u.getDisplayName());
        data.put("email", u.getEmail());
        return ApiResult.ok(data);
    }

    /** 固定四类事件完整返回；未保存过的事件使用 inApp=true、email=false。 */
    @GetMapping("/api/auth/notification-preferences")
    public ApiResult<Map<String, Object>> notificationPreferences() {
        Map<String, Object> data = new LinkedHashMap<String, Object>();
        data.put("preferences", preferenceService.list(CurrentUser.id()));
        return ApiResult.ok(data);
    }

    @PutMapping("/api/auth/notification-preferences")
    public ApiResult<Map<String, Object>> updateNotificationPreferences(
            @Valid @RequestBody NotificationPreferenceUpdateRequest req) {
        Map<String, Object> data = new LinkedHashMap<String, Object>();
        data.put("preferences", preferenceService.update(CurrentUser.id(), req));
        return ApiResult.ok(data);
    }

    /** 修改自己的计时设置（工作时段 + 每天上限；只影响之后的计时折算，历史工时不动） */
    @PutMapping("/api/auth/work-hours")
    public ApiResult<Map<String, Object>> updateWorkHours(@Valid @RequestBody WorkHoursRequest req) {
        AppUser u = userService.updateWorkHours(CurrentUser.id(), req);
        Map<String, Object> data = new LinkedHashMap<String, Object>();
        data.put("workStartHour", u.getWorkStartHour());
        data.put("workEndHour", u.getWorkEndHour());
        data.put("workMaxHours", u.getWorkMaxHours());
        return ApiResult.ok(data);
    }
}
