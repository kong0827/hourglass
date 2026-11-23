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

    /** 站内通知的写入结局：调用方必须区分「真的写入」「6 小时内已发过」「写入失败」。 */
    public enum PushResult { INSERTED, DEDUPED, FAILED }

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
        pushImmediate(userId, workspaceId, type, title, body, refTaskId, refKind, refId, null);
    }

    /**
     * 事件通知不去重，每次真实事件都写入；返回写入结局，汇总类调用方据此如实统计送达。
     *
     * @param reqId 业务对象所属项目；项目被设为不可见后，这条历史通知随之隐藏。
     *              项目类深链（refKind=project）未显式传入时按 refId 归属。
     */
    public PushResult pushImmediate(String userId, String workspaceId, String type,
                                    String title, String body, String refTaskId,
                                    String refKind, String refId, String reqId) {
        if (userId == null || workspaceId == null || title == null) {
            return PushResult.FAILED;
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
            n.setReqId(reqId != null ? reqId : ("project".equals(refKind) ? refId : null));
            mapper.insert(n);
            return PushResult.INSERTED;
        } catch (Exception e) {
            log.warn("事件站内通知写入失败（不影响主流程）：user={} type={}", userId, type, e);
            return PushResult.FAILED;
        }
    }

    /**
     * 推一条应用内通知（幂等窗口内去重；任何异常都只记日志）。
     * 返回是否真的写入了一条新通知：去重命中或写入失败为 false。
     * 需要区分「去重」与「写入失败」时请调用 {@link #pushResult}，不要把两者都当成功或都当失败。
     */
    public boolean push(String userId, String workspaceId, String type, String title, String body, String refTaskId) {
        return pushResult(userId, workspaceId, type, title, body, refTaskId) == PushResult.INSERTED;
    }

    /**
     * 同 {@link #push}，但把「写入」「去重命中」「写入失败」分三态返回。
     * 定时提醒、每日汇总、催办等需要如实统计送达的调用方必须用这个版本。
     */
    public PushResult pushResult(String userId, String workspaceId, String type, String title, String body, String refTaskId) {
        if (userId == null || workspaceId == null || title == null) {
            return PushResult.FAILED;
        }
        try {
            boolean recent = refTaskId != null
                    ? mapper.countRecent(userId, refTaskId, type, LocalDateTime.now().minusHours(DEDUP_HOURS)) > 0
                    : mapper.countRecentNoRef(workspaceId, userId, type, LocalDateTime.now().minusHours(DEDUP_HOURS)) > 0;
            if (recent) {
                return PushResult.DEDUPED;
            }
            AppNotification n = new AppNotification();
            n.setUserId(userId);
            n.setWorkspaceId(workspaceId);
            n.setType(type);
            n.setTitle(cut(title, MAX_TITLE));
            n.setBody(cut(body, MAX_BODY));
            n.setRefTaskId(refTaskId);
            mapper.insert(n);
            return PushResult.INSERTED;
        } catch (Exception e) {
            log.warn("应用内通知写入失败（不影响主流程）：user={} type={}", userId, type, e);
            return PushResult.FAILED;
        }
    }

    public com.hourglass.dto.PageResult<AppNotification> list(
            String userId, String workspaceId, String filter, int offset, int limit) {
        int safeOffset = Math.max(0, offset);
        int safeLimit = Math.max(1, Math.min(100, limit));
        String normalized = normalizeFilter(filter);
        int total = mapper.countByUser(userId, workspaceId, normalized);
        List<AppNotification> items = total <= safeOffset ? new java.util.ArrayList<AppNotification>()
                : mapper.selectByUser(userId, workspaceId, normalized, safeOffset, safeLimit);
        return com.hourglass.dto.PageResult.of(items, total, safeOffset, safeLimit);
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

    /** 当前筛选（全部 / 未读 / 提及）下按类型的全量计数：消息中心不按已加载的一页回算 */
    public java.util.Map<String, Integer> typeCounts(String userId, String workspaceId, String filter) {
        java.util.Map<String, Integer> out = new java.util.LinkedHashMap<String, Integer>();
        List<java.util.Map<String, Object>> rows = mapper.countByType(userId, workspaceId, normalizeFilter(filter));
        if (rows == null) {
            return out;
        }
        for (java.util.Map<String, Object> row : rows) {
            Object type = row.get("type");
            Object count = row.get("cnt");
            if (type == null || count == null) {
                continue;
            }
            out.put(String.valueOf(type), count instanceof Number
                    ? ((Number) count).intValue() : Integer.parseInt(String.valueOf(count)));
        }
        return out;
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
