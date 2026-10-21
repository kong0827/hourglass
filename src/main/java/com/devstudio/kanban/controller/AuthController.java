package com.devstudio.kanban.controller;

import com.devstudio.kanban.common.ApiResult;
import com.devstudio.kanban.common.CurrentUser;
import com.devstudio.kanban.common.LoginUser;
import com.devstudio.kanban.dto.PasswordChangeRequest;
import com.devstudio.kanban.dto.ProfileUpdateRequest;
import com.devstudio.kanban.entity.AppUser;
import com.devstudio.kanban.mapper.UserMapper;
import com.devstudio.kanban.service.UserService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import javax.validation.Valid;
import java.util.LinkedHashMap;
import java.util.Map;

@RestController
public class AuthController {

    private final UserMapper userMapper;
    private final UserService userService;

    public AuthController(UserMapper userMapper, UserService userService) {
        this.userMapper = userMapper;
        this.userService = userService;
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
        data.put("role", db != null ? db.getRole() : u.getRole());
        data.put("lastWorkspaceId", db == null ? null : db.getLastWorkspaceId());
        return ApiResult.ok(data);
    }

    /** 修改自己的密码（校验旧密码；已登录会话保持有效直到过期） */
    @PostMapping("/api/auth/password")
    public ApiResult<Void> changePassword(@Valid @RequestBody PasswordChangeRequest req) {
        userService.changePassword(CurrentUser.id(), req);
        return ApiResult.ok();
    }

    /** 修改自己的显示名（负责人默认值与成员列表展示随之更新；历史任务上的负责人名保留快照） */
    @PutMapping("/api/auth/profile")
    public ApiResult<Map<String, Object>> updateProfile(@Valid @RequestBody ProfileUpdateRequest req) {
        AppUser u = userService.updateProfile(CurrentUser.id(), req);
        Map<String, Object> data = new LinkedHashMap<String, Object>();
        data.put("displayName", u.getDisplayName());
        return ApiResult.ok(data);
    }
}
