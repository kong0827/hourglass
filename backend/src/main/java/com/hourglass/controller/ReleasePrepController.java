package com.hourglass.controller;

import com.hourglass.common.ApiResult;
import com.hourglass.common.CurrentWorkspace;
import com.hourglass.config.WorkspaceCtx;
import com.hourglass.dto.ReleasePrepCheckRequest;
import com.hourglass.dto.ReleasePrepNotifyRequest;
import com.hourglass.service.ReleasePrepService;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * 发布准备与发布计划关注。
 *
 * <p>发布准备只做提醒与核对，不改变工作项状态、不参与发布检查；
 * 关注与工作项/缺陷/需求关注分表，统一在「我的工作 → 我的关注」展示。
 */
@RestController
public class ReleasePrepController {

    private final ReleasePrepService prepService;

    public ReleasePrepController(ReleasePrepService prepService) {
        this.prepService = prepService;
    }

    /** 计划页「发布准备」卡：按人汇总、未指派、最近推送与我的回执。 */
    @GetMapping("/api/release-plans/{id}/prep")
    public ApiResult<Map<String, Object>> summary(@PathVariable String id, @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(prepService.summary(ctx.getUserId(), ctx.getWsId(), id));
    }

    /** 通知成员弹窗：可选成员、任务数与未确认数。 */
    @GetMapping("/api/release-plans/{id}/prep/recipients")
    public ApiResult<Map<String, Object>> recipients(@PathVariable String id,
                                                     @RequestParam(required = false) String scope,
                                                     @RequestParam(required = false) String q,
                                                     @RequestParam(required = false) Boolean onlyUnconfirmed,
                                                     @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(prepService.recipients(ctx.getUserId(), ctx.getWsId(), id, scope, q, onlyUnconfirmed));
    }

    /** 发送发布准备提醒；重复点击 30 秒内复用同一批次。 */
    @PostMapping("/api/release-plans/{id}/prep/notify")
    public ApiResult<Map<String, Object>> notify(@PathVariable String id,
                                                 @RequestBody(required = false) ReleasePrepNotifyRequest request,
                                                 @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(prepService.notify(ctx.getUserId(), ctx.getWsId(), id, request));
    }

    /** 推送记录：最近的推送批次与渠道 / 回执汇总。 */
    @GetMapping("/api/release-plans/{id}/prep/pushes")
    public ApiResult<Map<String, Object>> pushHistory(@PathVariable String id,
                                                      @RequestParam(required = false) Integer limit,
                                                      @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(prepService.pushHistory(ctx.getUserId(), ctx.getWsId(), id, limit));
    }

    /** 某一批推送的收件人明细，用于查看未回执名单。 */
    @GetMapping("/api/release-plans/{id}/prep/pushes/{pushId}/recipients")
    public ApiResult<Map<String, Object>> pushRecipients(@PathVariable String id, @PathVariable String pushId,
                                                         @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(prepService.pushRecipients(ctx.getUserId(), ctx.getWsId(), id, pushId));
    }

    /** 我的发布准备：只返回我负责的工作项、我的确认与回执。 */
    @GetMapping("/api/release-plans/{id}/prep/me")
    public ApiResult<Map<String, Object>> myPrep(@PathVariable String id, @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(prepService.myPrep(ctx.getUserId(), ctx.getWsId(), id));
    }

    /** 回执：只针对最近一次推送，重复回执幂等。 */
    @PostMapping("/api/release-plans/{id}/prep/me/receipt")
    public ApiResult<Map<String, Object>> receipt(@PathVariable String id, @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(prepService.ackReceipt(ctx.getUserId(), ctx.getWsId(), id));
    }

    /** 逐项确认 / 标记风险；计划范围变化时返回 409 要求重新确认。 */
    @PostMapping("/api/release-plans/{id}/prep/items/{taskId}/check")
    public ApiResult<Map<String, Object>> check(@PathVariable String id, @PathVariable String taskId,
                                                @RequestBody ReleasePrepCheckRequest request,
                                                @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(prepService.check(ctx.getUserId(), ctx.getWsId(), id, taskId, request));
    }

    /** 撤销确认，回到待确认。 */
    @DeleteMapping("/api/release-plans/{id}/prep/items/{taskId}/check")
    public ApiResult<Map<String, Object>> undoCheck(@PathVariable String id, @PathVariable String taskId,
                                                    @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(prepService.undoCheck(ctx.getUserId(), ctx.getWsId(), id, taskId));
    }

    @GetMapping("/api/release-plans/{id}/watch")
    public ApiResult<Map<String, Object>> watchStatus(@PathVariable String id, @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(prepService.watchStatus(ctx.getUserId(), ctx.getWsId(), id));
    }

    @PostMapping("/api/release-plans/{id}/watch")
    public ApiResult<Map<String, Object>> watch(@PathVariable String id, @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(prepService.watch(ctx.getUserId(), ctx.getWsId(), id));
    }

    @DeleteMapping("/api/release-plans/{id}/watch")
    public ApiResult<Map<String, Object>> unwatch(@PathVariable String id, @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(prepService.unwatch(ctx.getUserId(), ctx.getWsId(), id));
    }

    /** 我的工作 → 我的关注：发布计划分页（view=watch）。 */
    @GetMapping("/api/my-work/release-plans")
    public ApiResult<Map<String, Object>> myWatchedPlans(@RequestParam(required = false) String view,
                                                         @RequestParam(required = false) Integer offset,
                                                         @RequestParam(required = false) Integer limit,
                                                         @CurrentWorkspace WorkspaceCtx ctx) {
        if (view != null && !"watch".equals(view)) {
            throw com.hourglass.common.AppException.badRequest("发布计划只支持 view=watch");
        }
        return ApiResult.ok(prepService.myWatchedPlans(ctx.getWsId(), ctx.getUserId(),
                offset == null ? 0 : offset, limit == null ? 20 : limit));
    }
}
