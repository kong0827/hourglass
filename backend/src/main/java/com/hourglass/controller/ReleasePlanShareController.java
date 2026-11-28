package com.hourglass.controller;

import com.hourglass.common.ApiResult;
import com.hourglass.common.CurrentWorkspace;
import com.hourglass.config.WorkspaceCtx;
import com.hourglass.dto.PublicReleasePlanView;
import com.hourglass.entity.ReleasePlanShare;
import com.hourglass.service.AuditService;
import com.hourglass.service.ReleasePlanShareService;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 发布计划只读分享：管理端生成 / 查看 / 停止；/api/share/release-plan 不需要登录。
 * 公开页只含计划范围与时间，不含备注、风险与内部检查。
 */
@RestController
public class ReleasePlanShareController {

    private final ReleasePlanShareService shares;
    private final AuditService audit;

    public ReleasePlanShareController(ReleasePlanShareService shares, AuditService audit) {
        this.shares = shares;
        this.audit = audit;
    }

    @GetMapping("/api/release-plans/{planId}/share")
    public ApiResult<ReleasePlanShare> shareInfo(@PathVariable String planId, @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(shares.shareInfo(ctx.getUserId(), ctx.getWsId(), planId));
    }

    @PostMapping("/api/release-plans/{planId}/share")
    public ApiResult<ReleasePlanShare> createShare(@PathVariable String planId, @CurrentWorkspace WorkspaceCtx ctx) {
        ReleasePlanShare share = shares.createShare(ctx.getUserId(), ctx.getWsId(), planId);
        audit.recordCurrent(ctx.getWsId(), "release_plan_share_create", "version_release_plan", planId,
                null, true, "生成发布计划只读分享链接", null);
        return ApiResult.ok(share);
    }

    @DeleteMapping("/api/release-plans/{planId}/share")
    public ApiResult<Void> revoke(@PathVariable String planId, @CurrentWorkspace WorkspaceCtx ctx) {
        shares.revoke(ctx.getUserId(), ctx.getWsId(), planId);
        audit.recordCurrent(ctx.getWsId(), "release_plan_share_revoke", "version_release_plan", planId,
                null, true, "停止发布计划只读分享", null);
        return ApiResult.ok();
    }

    /** 公开只读：凭 token 打开，不校验登录。 */
    @GetMapping("/api/share/release-plan")
    public ApiResult<PublicReleasePlanView> publicShare(@RequestParam(required = false) String token) {
        return ApiResult.ok(shares.publicView(token));
    }
}
