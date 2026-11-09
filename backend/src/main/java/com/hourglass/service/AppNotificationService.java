package com.hourglass.service;

import com.hourglass.entity.AppNotification;
import com.hourglass.mapper.AppNotificationMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 应用内通知中心（N-1）：
 * 让"到点提醒该做事的人"不再依赖外部群机器人——铃铛即通知中心（未读角标 + 列表 + 已读）。
 * 通知写入失败绝不影响主业务（提醒链路是增强，不是关键路径）。
 */
@Service
public class AppNotificationService {

    private static final Logger log = LoggerFactory.getLogger(AppNotificationService.class);
    /** 同一收件人 + 同一任务 + 同一类型 的去重窗口，防提醒风暴 */
    private static final int DEDUP_HOURS = 6;
    private static final int MAX_TITLE = 120;
    private static final int MAX_BODY = 500;

    /** 站内通知保留天数：超出后每天自动清理，避免表无限增长；字段初始化保留默认值，便于脱离 Spring 的单元测试 */
    @Value("${app.notification.retain-days:90}")
    private int retainDays = 90;

    private final AppNotificationMapper mapper;

    public AppNotificationService(AppNotificationMapper mapper) {
        this.mapper = mapper;
    }

    /**
     * 业务事件通知不使用提醒的 6 小时去重窗口；每次真实事件都应可见。
     * 定时提醒仍调用 {@link #push(String, String, String, String, String, String)}。
     */
    public void pushImmediate(String userId, String workspaceId, String type,
                              String title, String body, String refTaskId) {
        pushImmediate(userId, workspaceId, type, title, body, refTaskId, null, null);
    }

    /** 非任务事件通知：refKind/refId 指向需求、文档、分支、版本、项目或空间，供通知中心深链。 */
    public void pushImmediate(String userId, String workspaceId, String type,
                              String title, String body, String refTaskId,
                              String refKind, String refId) {
        if (userId == null || workspaceId == null || title == null) {
            return;
        }
        try {
            AppNotification n = new AppNotification();
            n.setUserId(userId);
            n.setWorkspaceId(workspaceId);
            n.setType(type);
            n.setTitle(cut(title, MAX_TITLE));
            n.setBody(cut(body, MAX_BODY));
            n.setRefTaskId(refTaskId);
            n.setRefKind(refKind);
            n.setRefId(refId);
            mapper.insert(n);
        } catch (Exception e) {
            log.warn("事件站内通知写入失败（不影响主流程）：user={} type={}", userId, type, e);
        }
    }

    /** 推一条应用内通知（幂等窗口内去重；任何异常都只记日志） */
    public void push(String userId, String workspaceId, String type, String title, String body, String refTaskId) {
        if (userId == null || workspaceId == null || title == null) {
            return;
        }
        try {
            boolean recent = refTaskId != null
                    ? mapper.countRecent(userId, refTaskId, type, LocalDateTime.now().minusHours(DEDUP_HOURS)) > 0
                    : mapper.countRecentNoRef(workspaceId, userId, type, LocalDateTime.now().minusHours(DEDUP_HOURS)) > 0;
            if (recent) {
                return;
            }
            AppNotification n = new AppNotification();
            n.setUserId(userId);
            n.setWorkspaceId(workspaceId);
            n.setType(type);
            n.setTitle(cut(title, MAX_TITLE));
            n.setBody(cut(body, MAX_BODY));
            n.setRefTaskId(refTaskId);
            mapper.insert(n);
        } catch (Exception e) {
            log.warn("应用内通知写入失败（不影响主流程）：user={} type={}", userId, type, e);
        }
    }

    public List<AppNotification> list(String userId, String workspaceId, String filter, Integer limit) {
        int n = limit == null ? 50 : Math.max(1, Math.min(200, limit));
        return mapper.selectByUser(userId, workspaceId, normalizeFilter(filter), n);
    }

    public int unread(String userId, String workspaceId) {
        return mapper.countUnread(userId, workspaceId);
    }

    public int total(String userId, String workspaceId) {
        return mapper.countAll(userId, workspaceId);
    }

    /** 未读的 @ 提及数量（筛选页签计数用；口径与 unread 一致，读完即归零） */
    public int mentions(String userId, String workspaceId) {
        return mapper.countMentions(userId, workspaceId);
    }

    private String normalizeFilter(String filter) {
        if ("unread".equals(filter) || "mention".equals(filter)) {
            return filter;
        }
        return "all";
    }

    public void markRead(String userId, Long id) {
        mapper.markRead(id, userId);
    }

    public void markAllRead(String userId, String workspaceId) {
        mapper.markAllRead(userId, workspaceId);
    }

    /** 每天 03:20 清理超过保留期的站内通知 */
    @Scheduled(cron = "0 20 3 * * *")
    public void purgeExpired() {
        try {
            int count = mapper.deleteOlderThan(LocalDateTime.now().minusDays(retainDays));
            if (count > 0) {
                log.info("清理站内通知 {} 条（超过 {} 天）", count, retainDays);
            }
        } catch (Exception e) {
            log.warn("站内通知清理失败", e);
        }
    }

    private String cut(String s, int max) {
        if (s == null) {
            return null;
        }
        return s.length() <= max ? s : s.substring(0, max);
    }
}
