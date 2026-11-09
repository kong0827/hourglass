package com.hourglass.controller;

import com.hourglass.common.ApiResult;
import com.hourglass.common.CurrentUser;
import com.hourglass.entity.AppNotification;
import com.hourglass.service.AppNotificationService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 应用内通知中心（N-1）。
 * 铃铛即通知中心：未读角标 + 列表 + 已读，不再依赖外部群机器人是否配置。
 */
@RestController
public class NotificationCenterController {

    private final AppNotificationService notificationService;

    public NotificationCenterController(AppNotificationService notificationService) {
        this.notificationService = notificationService;
    }

    /** 我的通知列表（可按当前空间过滤） */
    @GetMapping("/api/notifications")
    public ApiResult<Map<String, Object>> list(@RequestParam(required = false) String workspace,
                                               @RequestParam(required = false) String filter,
                                               @RequestParam(required = false) Integer offset,
                                               @RequestParam(required = false) Integer limit) {
        String userId = CurrentUser.id();
        String wsId = trimToNull(workspace);
        com.hourglass.dto.PageResult<AppNotification> page = notificationService.list(
                userId, wsId, filter, offset == null ? 0 : offset, limit == null ? 50 : limit);
        Map<String, Object> res = new LinkedHashMap<String, Object>();
        res.put("items", page.getItems());
        res.put("offset", page.getOffset());
        res.put("limit", page.getLimit());
        res.put("hasMore", page.isHasMore());
        res.put("unread", notificationService.unread(userId, wsId));
        /* total/mentions 一并返回：total 供「共 N 条」这类文字与排障使用（筛选页签不显示），
           mentions 为未读提及数——页签上的数字必须能被读完归零，才不会被读成待办量 */
        res.put("total", notificationService.total(userId, wsId));
        res.put("mentions", notificationService.mentions(userId, wsId));
        return ApiResult.ok(res);
    }

    /** 未读数（铃铛角标轮询用） */
    @GetMapping("/api/notifications/unread")
    public ApiResult<Map<String, Object>> unread(@RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        String wsId = trimToNull(workspace);
        Map<String, Object> res = new LinkedHashMap<String, Object>();
        res.put("unread", notificationService.unread(userId, wsId));
        return ApiResult.ok(res);
    }

    @PostMapping("/api/notifications/{id}/read")
    public ApiResult<Void> markRead(@PathVariable Long id) {
        notificationService.markRead(CurrentUser.id(), id);
        return ApiResult.ok();
    }

    @PostMapping("/api/notifications/read-all")
    public ApiResult<Void> markAllRead(@RequestParam(required = false) String workspace) {
        notificationService.markAllRead(CurrentUser.id(), trimToNull(workspace));
        return ApiResult.ok();
    }

    private String trimToNull(String s) {
        if (s == null) {
            return null;
        }
        String t = s.trim();
        return t.isEmpty() ? null : t;
    }
}
