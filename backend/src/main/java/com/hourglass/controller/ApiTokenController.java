package com.hourglass.controller;

import com.hourglass.common.ApiResult;
import com.hourglass.common.CurrentUser;
import com.hourglass.dto.ApiTokenCreateRequest;
import com.hourglass.dto.ApiTokenCreated;
import com.hourglass.dto.ApiTokenView;
import com.hourglass.service.ApiTokenService;
import com.hourglass.service.AuditService;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import javax.servlet.http.HttpServletRequest;
import javax.validation.Valid;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 个人访问令牌管理：只允许会话登录本人操作。
 * 令牌本身无权调用这几个接口（SecurityConfig 与 ApiTokenAuthFilter 双重拦截）。
 */
@RestController
public class ApiTokenController {

    private final ApiTokenService tokenService;
    private final AuditService audit;

    public ApiTokenController(ApiTokenService tokenService, AuditService audit) {
        this.tokenService = tokenService;
        this.audit = audit;
    }

    /** 创建令牌：需校验当前密码；完整令牌只在本次响应返回一次 */
    @PostMapping("/api/auth/tokens")
    public ApiResult<ApiTokenCreated> create(@Valid @RequestBody ApiTokenCreateRequest req,
                                             HttpServletRequest request) {
        String userId = CurrentUser.id();
        ApiTokenCreated created = tokenService.create(userId, req, AuditService.clientIp(request));
        audit.recordCurrent(null, "api_token.create", "api_token", created.getId(), created.getName(),
                true, "创建访问令牌 " + created.getPrefix() + "（" + created.getScope() + "）", request);
        return ApiResult.ok(created);
    }

    @GetMapping("/api/auth/tokens")
    public ApiResult<Map<String, Object>> list() {
        List<ApiTokenView> tokens = tokenService.list(CurrentUser.id());
        Map<String, Object> data = new LinkedHashMap<String, Object>();
        data.put("tokens", tokens);
        return ApiResult.ok(data);
    }

    /** 撤销本人令牌；重复撤销按幂等返回 */
    @DeleteMapping("/api/auth/tokens/{id}")
    public ApiResult<ApiTokenView> revoke(@PathVariable String id, HttpServletRequest request) {
        ApiTokenView view = tokenService.revoke(CurrentUser.id(), id);
        audit.recordCurrent(null, "api_token.revoke", "api_token", view.getId(), view.getName(),
                true, "撤销访问令牌 " + view.getPrefix(), request);
        return ApiResult.ok(view);
    }

    /** 管理员排查：全部令牌可按账号过滤，不返回令牌本身 */
    @GetMapping("/api/admin/tokens")
    public ApiResult<Map<String, Object>> adminList(@RequestParam(required = false) String userId) {
        Map<String, Object> data = new LinkedHashMap<String, Object>();
        data.put("tokens", tokenService.adminList(userId));
        return ApiResult.ok(data);
    }

    /** 管理员强制撤销任意令牌（处置泄漏）；不代发令牌 */
    @DeleteMapping("/api/admin/tokens/{id}")
    public ApiResult<ApiTokenView> adminRevoke(@PathVariable String id, HttpServletRequest request) {
        ApiTokenView view = tokenService.adminRevoke(id);
        audit.recordCurrent(null, "api_token.admin_revoke", "api_token", view.getId(), view.getName(),
                true, "管理员强制撤销访问令牌 " + view.getPrefix(), request);
        return ApiResult.ok(view);
    }
}