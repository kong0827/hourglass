package com.devstudio.kanban.controller;

import com.devstudio.kanban.common.ApiResult;
import com.devstudio.kanban.common.CurrentUser;
import com.devstudio.kanban.entity.Invite;
import com.devstudio.kanban.service.InviteService;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/**
 * 邀请链接：/api/workspaces/{id}/invites 由空间主管理；
 * /api/invite/{code} 查看信息与注册为公开接口，join 需登录（见 SecurityConfig）。
 */
@RestController
public class InviteController {

    private final InviteService inviteService;

    public InviteController(InviteService inviteService) {
        this.inviteService = inviteService;
    }

    /** 生成邀请链接（仅空间主，7 天有效） */
    @PostMapping("/api/workspaces/{id}/invites")
    public ApiResult<Map<String, Object>> create(@PathVariable String id) {
        return ApiResult.ok(inviteService.create(CurrentUser.id(), id));
    }

    /** 当前空间的有效邀请列表（仅空间主） */
    @GetMapping("/api/workspaces/{id}/invites")
    public ApiResult<List<Invite>> list(@PathVariable String id) {
        return ApiResult.ok(inviteService.list(CurrentUser.id(), id));
    }

    /** 撤销邀请（仅空间主） */
    @DeleteMapping("/api/workspaces/{id}/invites/{inviteId}")
    public ApiResult<Void> revoke(@PathVariable String id, @PathVariable String inviteId) {
        inviteService.revoke(CurrentUser.id(), id, inviteId);
        return ApiResult.ok();
    }

    /** 邀请信息（公开） */
    @GetMapping("/api/invite/{code}")
    public ApiResult<Map<String, Object>> info(@PathVariable String code) {
        return ApiResult.ok(inviteService.info(code));
    }

    /** 已有账号加入空间（需登录） */
    @PostMapping("/api/invite/{code}/join")
    public ApiResult<Map<String, Object>> join(@PathVariable String code) {
        return ApiResult.ok(inviteService.join(code, CurrentUser.id()));
    }
}
