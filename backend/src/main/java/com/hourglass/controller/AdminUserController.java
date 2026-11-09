package com.hourglass.controller;

import com.hourglass.common.ApiResult;
import com.hourglass.common.AppException;
import com.hourglass.common.CurrentUser;
import com.hourglass.dto.PageResult;
import com.hourglass.dto.PasswordResetRequest;
import com.hourglass.dto.UserCreateRequest;
import com.hourglass.dto.UserUpdateRequest;
import com.hourglass.entity.AppUser;
import com.hourglass.mapper.UserMapper;
import com.hourglass.service.AccountSecurityMailService;
import com.hourglass.service.AuditService;
import com.hourglass.service.UserService;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import javax.servlet.http.HttpServletRequest;
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
    private final AccountSecurityMailService securityMail;
    private final AuditService audit;

    public AdminUserController(UserService userService, UserMapper userMapper,
                               AccountSecurityMailService securityMail, AuditService audit) {
        this.userService = userService;
        this.userMapper = userMapper;
        this.securityMail = securityMail;
        this.audit = audit;
    }

    /** 以数据库实时角色为准（登录时写入会话的角色可能已过期） */
    private void requireAdmin() {
        AppUser me = userMapper.selectById(CurrentUser.id());
        if (me == null || !"admin".equals(me.getRole())) {
            throw new AppException(403, "没有权限执行该操作");
        }
    }

    @GetMapping("/api/admin/users")
    public ApiResult<PageResult<AppUser>> list(@RequestParam(required = false) Integer offset,
                                               @RequestParam(required = false) Integer limit) {
        requireAdmin();
        return ApiResult.ok(userService.page(offset == null ? 0 : offset, limit == null ? 100 : limit));
    }

    @PostMapping("/api/admin/users")
    public ApiResult<AppUser> create(@Valid @RequestBody UserCreateRequest req, HttpServletRequest request) {
        requireAdmin();
        AppUser u = userService.create(req);
        securityMail.welcome(u);
        audit.recordCurrent(null, "user_create", "user", u.getId(), u.getDisplayName(), true,
                "创建账号 @" + u.getUsername() + "，角色 " + u.getRole(), request);
        return ApiResult.ok(u);
    }

    @PutMapping("/api/admin/users/{id}")
    public ApiResult<AppUser> update(@PathVariable String id, @Valid @RequestBody UserUpdateRequest req,
                                     HttpServletRequest request) {
        requireAdmin();
        AppUser before = userMapper.selectById(id);
        AppUser u = userService.update(id, req);
        boolean roleChanged = before != null && !java.util.Objects.equals(before.getRole(), u.getRole());
        audit.recordCurrent(null, roleChanged ? "role_change" : "user_update", "user", u.getId(),
                u.getDisplayName(), true,
                roleChanged ? ("账号 @" + u.getUsername() + " 角色由 " + before.getRole() + " 改为 " + u.getRole())
                        : ("修改账号 @" + u.getUsername()), request);
        return ApiResult.ok(u);
    }

    /** 停用/启用账号（A4）：停用即刻踢出在线会话，历史数据与引用全部保留 */
    @PutMapping("/api/admin/users/{id}/disabled")
    public ApiResult<AppUser> setDisabled(@PathVariable String id,
                                          @RequestParam boolean disabled,
                                          HttpServletRequest request) {
        requireAdmin();
        AppUser u = userService.setDisabled(id, disabled);
        audit.recordCurrent(null, disabled ? "user_disable" : "user_enable", "user", id,
                u == null ? id : u.getDisplayName(), true,
                (disabled ? "停用账号" : "启用账号") + (u == null ? "" : " @" + u.getUsername()), request);
        return ApiResult.ok(u);
    }

    @PostMapping("/api/admin/users/{id}/password")
    public ApiResult<Void> resetPassword(@PathVariable String id, @Valid @RequestBody PasswordResetRequest req,
                                         HttpServletRequest request) {
        requireAdmin();
        userService.resetPassword(id, req);
        AppUser u = userMapper.selectById(id);
        securityMail.passwordReset(u);
        audit.recordCurrent(null, "password_reset", "user", id,
                u == null ? id : u.getDisplayName(), true,
                "重置账号密码" + (u == null ? "" : " @" + u.getUsername()), request);
        return ApiResult.ok();
    }

    @DeleteMapping("/api/admin/users/{id}")
    public ApiResult<Void> delete(@PathVariable String id, HttpServletRequest request) {
        requireAdmin();
        AppUser u = userMapper.selectById(id);
        userService.delete(id);
        audit.recordCurrent(null, "user_delete", "user", id,
                u == null ? id : u.getDisplayName(), true,
                "删除账号" + (u == null ? "" : " @" + u.getUsername()), request);
        return ApiResult.ok();
    }
}
