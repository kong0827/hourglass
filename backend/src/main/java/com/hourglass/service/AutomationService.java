package com.hourglass.service;

import com.hourglass.common.Texts;
import com.hourglass.entity.Task;
import com.hourglass.entity.Workspace;
import com.hourglass.entity.WorkspaceMember;
import com.hourglass.mapper.TaskMapper;
import com.hourglass.mapper.WorkspaceMapper;
import com.hourglass.mapper.WorkspaceMemberMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 逾期提醒规则的执行器。
 *
 * <p>与 09:00 的每日汇总分开：汇总按人给「今天到期 / 逾期」全貌；
 * 本规则只针对逾期达到阈值且仍未完成的工作项，在每天固定时间做一次升级提醒，
 * 同一人同一天只发一次，避免与汇总重复轰炸。
 */
@Service
public class AutomationService {

    private static final Logger log = LoggerFactory.getLogger(AutomationService.class);
    private static final int MAX_HIGHLIGHT = 5;

    private final AutomationSettingsService settings;
    private final TaskMapper taskMapper;
    private final WorkspaceMapper workspaceMapper;
    private final WorkspaceMemberMapper memberMapper;
    private final NotificationEventService notificationEvents;
    private final UserNotificationPreferenceService preferences;
    private final ProjectAccessService projectAccess;

    public AutomationService(AutomationSettingsService settings, TaskMapper taskMapper,
                             WorkspaceMapper workspaceMapper, WorkspaceMemberMapper memberMapper,
                             NotificationEventService notificationEvents,
                             UserNotificationPreferenceService preferences,
                             ProjectAccessService projectAccess) {
        this.settings = settings;
        this.taskMapper = taskMapper;
        this.workspaceMapper = workspaceMapper;
        this.memberMapper = memberMapper;
        this.notificationEvents = notificationEvents;
        this.preferences = preferences;
        this.projectAccess = projectAccess;
    }

    @Scheduled(cron = "${app.automation.overdue-cron:0 0 10 * * *}")
    public void overdueScan() {
        List<Workspace> all;
        try {
            all = workspaceMapper.selectAll();
        } catch (Exception e) {
            log.warn("逾期提醒：读取空间列表失败", e);
            return;
        }
        int workspaces = 0;
        int notified = 0;
        for (Workspace ws : all) {
            if (ws == null || !settings.enabled(ws.getId(), AutomationSettingsService.OVERDUE_REMINDER)) {
                continue;
            }
            try {
                Map<String, Object> result = runForWorkspace(ws);
                workspaces++;
                notified += intValue(result.get("notified"));
            } catch (Exception e) {
                log.warn("逾期提醒异常（空间 {}），已跳过该空间", ws.getId(), e);
            }
        }
        if (workspaces > 0) {
            log.info("逾期提醒完成：扫描空间 {} 个，提醒 {} 人", workspaces, notified);
        }
    }

    /** 按空间执行一轮；返回 notified（真正写入的人数）与 reason（未发送原因），供设置页与测试使用。 */
    public Map<String, Object> runForWorkspace(Workspace ws) {
        LocalDate today = LocalDate.now();
        int days = settings.overdueDays(ws.getId());
        Map<String, Object> res = new LinkedHashMap<String, Object>();
        List<Task> tasks = taskMapper.selectAutomationOverdue(ws.getId(), today.minusDays(days));
        if (tasks == null || tasks.isEmpty()) {
            res.put("notified", 0);
            res.put("reason", "没有逾期达到 " + days + " 天的工作项");
            settings.recordRun(ws.getId(), AutomationSettingsService.OVERDUE_REMINDER,
                    "无逾期达到 " + days + " 天的工作项");
            return res;
        }
        Map<String, String> memberByName = memberNameMap(ws.getId());
        Map<String, List<Task>> byOwner = new LinkedHashMap<String, List<Task>>();
        for (Task task : tasks) {
            String uid = Texts.trimToNull(task.getOwnerUserId());
            if (uid == null) {
                uid = memberByName.get(task.getOwner());
            }
            if (uid == null || !projectAccess.canView(ws.getId(), uid, task.getReqId())) {
                continue;
            }
            List<Task> list = byOwner.get(uid);
            if (list == null) {
                list = new ArrayList<Task>();
                byOwner.put(uid, list);
            }
            list.add(task);
        }
        int notified = 0;
        int skipped = 0;
        int muted = 0;
        int failed = 0;
        /* 空间关闭站内通知时只发邮件，不能因为站内关掉就整条规则停摆 */
        boolean allowInApp = !Boolean.FALSE.equals(ws.getNotifyInAppEnabled());
        for (Map.Entry<String, List<Task>> e : byOwner.entrySet()) {
            String uid = e.getKey();
            List<Task> mine = e.getValue();
            if (!reachable(uid)) {
                muted++;
                continue;
            }
            if (!settings.claim(ws.getId(), AutomationSettingsService.OVERDUE_REMINDER, "owner:" + uid, today)) {
                skipped++;
                continue;
            }
            String title = "逾期提醒：" + mine.size() + " 项工作项仍未完成";
            boolean delivered = notificationEvents.notifySummary(uid, ws.getId(),
                    UserNotificationPreferenceService.DAILY_DIGEST, "task_due", title,
                    overdueBody(mine, today, days), "mywork", ws.getId(), allowInApp);
            if (delivered) {
                notified++;
            } else {
                /* 一个渠道都没发出去就不算提醒过：撤回占位让下一个整点重试 */
                failed++;
                settings.release(ws.getId(), AutomationSettingsService.OVERDUE_REMINDER, "owner:" + uid, today);
            }
        }
        String status = "提醒 " + notified + " 人"
                + (failed > 0 ? "，" + failed + " 人投递失败待重试" : "")
                + "，涉及 " + tasks.size() + " 项工作项";
        settings.recordRun(ws.getId(), AutomationSettingsService.OVERDUE_REMINDER, status);
        res.put("notified", notified);
        res.put("skipped", skipped);
        res.put("failed", failed);
        res.put("taskCount", tasks.size());
        res.put("days", days);
        if (notified == 0) {
            res.put("reason", failed > 0 ? "提醒投递失败，稍后自动重试"
                    : skipped > 0 ? "今天已经提醒过，未重复发送"
                    : muted > 0 ? "负责人都关闭了汇总通知，未发送" : "没有可提醒的负责人（未指派或项目不可见）");
        }
        return res;
    }

    /** 与 notifySummary 使用同一偏好：站内与邮件都关了就不再占用当天去重名额。 */
    private boolean reachable(String userId) {
        try {
            com.hourglass.dto.NotificationPreferenceItem pref =
                    preferences.get(userId, UserNotificationPreferenceService.DAILY_DIGEST);
            return Boolean.TRUE.equals(pref.getInApp()) || Boolean.TRUE.equals(pref.getEmail());
        } catch (Exception e) {
            return true;
        }
    }

    private String overdueBody(List<Task> tasks, LocalDate today, int days) {
        StringBuilder sb = new StringBuilder("已逾期 " + days + " 天以上：");
        int n = Math.min(tasks.size(), MAX_HIGHLIGHT);
        for (int i = 0; i < n; i++) {
            Task t = tasks.get(i);
            long over = t.getDueDate() == null ? days : ChronoUnit.DAYS.between(t.getDueDate(), today);
            sb.append("\n· ").append(Texts.cut(t.getTitle(), 60))
              .append("（逾期 ").append(over).append(" 天）");
        }
        if (tasks.size() > n) {
            sb.append("\n…等共 ").append(tasks.size()).append(" 项");
        }
        sb.append("\n到「我的工作」查看并调整计划。");
        return sb.toString();
    }

    private Map<String, String> memberNameMap(String workspaceId) {
        List<WorkspaceMember> members;
        try {
            members = memberMapper.selectByWorkspace(workspaceId);
        } catch (Exception e) {
            return Collections.emptyMap();
        }
        Map<String, String> out = new LinkedHashMap<String, String>();
        List<String> ambiguous = new ArrayList<String>();
        for (WorkspaceMember member : members) {
            String name = member.getDisplayName();
            if (name == null) {
                continue;
            }
            if (out.containsKey(name)) {
                ambiguous.add(name);
            } else {
                out.put(name, member.getUserId());
            }
        }
        /* 同名成员无法确定归属，宁可漏提醒也不把别人的逾期发错人 */
        for (String name : ambiguous) {
            out.remove(name);
        }
        return out;
    }

    private static int intValue(Object value) {
        return value instanceof Number ? ((Number) value).intValue() : 0;
    }
}
