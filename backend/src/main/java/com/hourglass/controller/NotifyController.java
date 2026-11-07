package com.hourglass.controller;

import com.hourglass.common.ApiResult;
import com.hourglass.common.CurrentUser;
import com.hourglass.common.Texts;
import com.hourglass.entity.Workspace;
import com.hourglass.service.NotificationService;
import com.hourglass.service.WorkspaceService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.Map;

@RestController
public class NotifyController {

    private final NotificationService notificationService;
    private final WorkspaceService workspaceService;

    public NotifyController(NotificationService notificationService, WorkspaceService workspaceService) {
        this.notificationService = notificationService;
        this.workspaceService = workspaceService;
    }

    /**
     * 立即对当前空间执行一次提醒推送（手动测试用，仅空间主）。
     * O-1③：走与定时任务相同的开关判断——未启用时如实返回未发送与原因，不再给"假绿"。
     */
    @PostMapping("/api/notify/test")
    public ApiResult<Map<String, Object>> test(@RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        Workspace raw = workspaceService.requireOwnerRaw(userId, ws.getId());
        return ApiResult.ok(notificationService.push(raw, true));
    }

    /**
     * 推送生效状态（O-1）：让设置页能直说"配了到底会不会发"。
     * 只返回非敏感信息（渠道、开关、是否已配地址/token、上次结果），不回传地址与 token 原文。
     */
    @GetMapping("/api/notify/status")
    public ApiResult<Map<String, Object>> status(@RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        Workspace raw = workspaceService.requireOwnerRaw(userId, ws.getId());
        Map<String, Object> res = new LinkedHashMap<String, Object>();
        res.put("enabled", notificationService.effectiveEnabled(raw));
        res.put("enabledSource", raw.getNotifyEnabled() == null ? "global" : "workspace");
        /* BUG-12：站内通知是独立开关（默认开启），不再跟随外部推送 */
        res.put("inAppEnabled", notificationService.effectiveInAppEnabled(raw));
        res.put("inAppSource", raw.getNotifyInAppEnabled() == null ? "default" : "workspace");
        res.put("channel", notificationService.effectiveChannel(raw));
        res.put("channelSource", Texts.trimToNull(raw.getNotifyChannel()) == null ? "global" : "workspace");
        res.put("workspaceHasAddress", notificationService.effectiveHook(raw) != null);
        res.put("hasToken", notificationService.effectiveToken(raw) != null);
        /* 空间自己有没有存 Token（不回传原文）：前端据此提示“留空保持不变” */
        res.put("workspaceHasToken", Texts.trimToNull(raw.getNotifyToken()) != null);
        res.put("lastAttemptAt", raw.getNotifyLastAt());
        String last = Texts.trimToNull(raw.getNotifyLastStatus());
        if (last == null) {
            res.put("lastResult", null);
            res.put("lastError", null);
        } else if (last.startsWith("success")) {
            res.put("lastResult", "success");
            res.put("lastError", null);
        } else {
            res.put("lastResult", "failed");
            res.put("lastError", last.startsWith("failed:") ? last.substring("failed:".length()) : last);
        }
        res.put("disabledReason", NotificationService.DISABLED_REASON);
        return ApiResult.ok(res);
    }
}
