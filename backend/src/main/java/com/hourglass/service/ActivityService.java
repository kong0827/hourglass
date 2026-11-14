package com.hourglass.service;

import com.hourglass.common.Texts;
import com.hourglass.dto.ActivityFeed;
import com.hourglass.dto.ActivityFeedItem;
import com.hourglass.dto.ActivityQuery;
import com.hourglass.dto.ActivityTypeCount;
import com.hourglass.entity.TaskLog;
import com.hourglass.mapper.ActivityFeedMapper;
import com.hourglass.mapper.TaskLogMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 空间级活动流（O-9）。
 *
 * task_log 仍承担配置类破坏性操作（删列/模块/项目、移出成员、清空数据、导入覆盖）的留痕：
 * 固定哨兵 task_id = CFG，不会混进任何任务的「操作时间线」。
 *
 * 2026-11-14 起活动页改成聚合流：合并 task_log、work_activity、demand_log、
 * dev_branch_log、version_log，按触发时间倒序分页；可见性口径与项目读权限一致。
 */
@Service
public class ActivityService {

    private static final Logger log = LoggerFactory.getLogger(ActivityService.class);

    /** 配置类事件的哨兵任务ID（不指向任何真实任务） */
    public static final String CONFIG_TASK_ID = "CFG";

    private static final Set<String> FEED_TYPES = new HashSet<String>(Arrays.asList(
            "task", "demand", "project", "doc", "branch", "version", "config"));

    private final TaskLogMapper logMapper;
    private final ActivityFeedMapper feedMapper;
    private final ProjectAccessService projectAccess;

    public ActivityService(TaskLogMapper logMapper, ActivityFeedMapper feedMapper,
                           ProjectAccessService projectAccess) {
        this.logMapper = logMapper;
        this.feedMapper = feedMapper;
        this.projectAccess = projectAccess;
    }

    /** 记录一条配置类变更（失败只记日志，不影响主流程） */
    public void logConfig(String workspaceId, String actorId, String detail) {
        try {
            TaskLog l = new TaskLog();
            l.setTaskId(CONFIG_TASK_ID);
            l.setWorkspaceId(workspaceId);
            l.setActorId(actorId);
            l.setAction("config");
            l.setDetail(Texts.cut(detail, 250));
            logMapper.insert(l);
        } catch (Exception e) {
            // 审计日志失败不应阻断业务操作，但要留痕便于排查
            log.warn("配置审计写入失败（workspace={}）：{}", workspaceId, detail, e);
        }
    }

    /** 便捷重载：自行解析当前登录人（启动期/无请求上下文时留空） */
    public void logConfig(String workspaceId, String detail) {
        String actorId = null;
        try {
            actorId = com.hourglass.common.CurrentUser.id();
        } catch (Exception e) {
            actorId = null;
        }
        logConfig(workspaceId, actorId, detail);
    }

    /** 只看类型时的便捷重载 */
    public ActivityFeed feed(String workspaceId, String userId, String type, int offset, int limit) {
        ActivityQuery query = new ActivityQuery();
        query.setType(type);
        return feed(workspaceId, userId, query, offset, limit);
    }

    /**
     * 空间活动聚合页。type 为空/未知时返回全部；配置类事件仅空间主与管理员的计数和条目可见。
     * 动作/操作人/日期/关键词在 union 外层统一过滤，计数同步按同一口径收窄。
     */
    public ActivityFeed feed(String workspaceId, String userId, ActivityQuery query, int offset, int limit) {
        int safeOffset = Math.max(0, offset);
        int safeLimit = Math.max(1, Math.min(100, limit));

        String role = projectAccess.roleOf(workspaceId, userId);
        boolean privileged = ProjectAccessService.isPrivileged(role);
        String viewerId = projectAccess.viewerScope(workspaceId, userId);
        boolean seeAllDrafts = privileged;
        ActivityQuery q = query == null ? new ActivityQuery() : query;
        String safeType = normalizeType(q.getType());
        String actionFilter = cut(q.getAction(), 40);
        String actorFilter = cut(q.getActorId(), 32);
        String fromDate = cleanDate(q.getFromDate());
        String toDate = cleanDate(q.getToDate());
        String keyword = cut(q.getKeyword(), 50);

        Map<String, Integer> counts = new LinkedHashMap<String, Integer>();
        int all = 0;
        for (ActivityTypeCount row : feedMapper.countByType(workspaceId, viewerId, userId,
                seeAllDrafts, privileged, actionFilter, actorFilter, fromDate, toDate, keyword)) {
            if ("config".equals(row.getType()) && !privileged) {
                continue;
            }
            counts.put(row.getType(), row.getTotal());
            all += row.getTotal();
        }
        for (String t : FEED_TYPES) {
            if (!"config".equals(t) || privileged) {
                if (!counts.containsKey(t)) {
                    counts.put(t, 0);
                }
            }
        }
        counts.put("all", all);

        int total = safeType == null ? all : (counts.containsKey(safeType) ? counts.get(safeType) : 0);
        List<ActivityFeedItem> items = total <= safeOffset
                ? new ArrayList<ActivityFeedItem>()
                : feedMapper.selectFeed(workspaceId, viewerId, userId, seeAllDrafts, privileged,
                        safeType, actionFilter, actorFilter, fromDate, toDate, keyword, safeOffset, safeLimit);
        for (ActivityFeedItem item : items) {
            item.setWorkspaceId(workspaceId);
        }
        return ActivityFeed.of(items, total, safeOffset, safeLimit, counts);
    }

    private static String cut(String value, int max) {
        String s = Texts.trimToNull(value);
        if (s == null) {
            return null;
        }
        return s.length() > max ? s.substring(0, max) : s;
    }

    /** 日期必须是真实存在的 yyyy-MM-dd，非法值（含 2026-13-99）一律丢弃 */
    private static String cleanDate(String value) {
        String s = Texts.trimToNull(value);
        if (s == null || !s.matches("\\d{4}-\\d{2}-\\d{2}")) {
            return null;
        }
        try {
            return LocalDate.parse(s).toString();
        } catch (DateTimeParseException e) {
            return null;
        }
    }

    private String normalizeType(String type) {
        String value = Texts.trimToNull(type);
        if (value == null || "all".equals(value) || !FEED_TYPES.contains(value)) {
            return null;
        }
        return value;
    }
}
