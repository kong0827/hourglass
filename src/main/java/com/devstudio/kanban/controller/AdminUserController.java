package com.devstudio.kanban.controller;

import com.devstudio.kanban.common.ApiResult;
import com.devstudio.kanban.common.AppException;
import com.devstudio.kanban.common.CurrentUser;
import com.devstudio.kanban.dto.PasswordResetRequest;
import com.devstudio.kanban.dto.UserCreateRequest;
import com.devstudio.kanban.dto.UserUpdateRequest;
import com.devstudio.kanban.entity.AppUser;
import com.devstudio.kanban.mapper.UserMapper;
import com.devstudio.kanban.service.UserService;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import javax.validation.Valid;
import java.util.List;

/**
 * 用户管理（仅管理员）
 * 双重校验：SecurityConfig 的 ROLE_ADMIN + 每次请求按数据库当前角色复核，
 * 避免管理员被降权/删除后旧会话仍持有旧权限。
 */
@RestController
public class AdminUserController {

    private final UserService userService;
    private final UserMapper userMapper;

    public AdminUserController(UserService userService, UserMapper userMapper) {
        this.userService = userService;
        this.userMapper = userMapper;
    }

    /** 以数据库实时角色为准（登录时写入会话的角色可能已过期） */
    private void requireAdmin() {
        AppUser me = userMapper.selectById(CurrentUser.id());
        if (me == null || !"admin".equals(me.getRole())) {
            throw new AppException(403, "没有权限执行该操作");
        }
    }

    @GetMapping("/api/admin/users")
    public ApiResult<List<AppUser>> list() {
        requireAdmin();
        return ApiResult.ok(userService.list());
    }

    @PostMapping("/api/admin/users")
    public ApiResult<AppUser> create(@Valid @RequestBody UserCreateRequest req) {
        requireAdmin();
        return ApiResult.ok(userService.create(req));
    }

    @PutMapping("/api/admin/users/{id}")
    public ApiResult<AppUser> update(@PathVariable String id, @Valid @RequestBody UserUpdateRequest req) {
        requireAdmin();
        return ApiResult.ok(userService.update(id, req));
    }

    @PostMapping("/api/admin/users/{id}/password")
    public ApiResult<Void> resetPassword(@PathVariable String id, @Valid @RequestBody PasswordResetRequest req) {
        requireAdmin();
        userService.resetPassword(id, req);
        return ApiResult.ok();
    }

    @DeleteMapping("/api/admin/users/{id}")
    public ApiResult<Void> delete(@PathVariable String id) {
        requireAdmin();
        userService.delete(id);
        return ApiResult.ok();
    }
}
