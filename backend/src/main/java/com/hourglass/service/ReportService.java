package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.common.Ids;
import com.hourglass.common.Texts;
import com.hourglass.entity.AppUser;
import com.hourglass.entity.ProjectVersion;
import com.hourglass.entity.ReportSubscription;
import com.hourglass.entity.Requirement;
import com.hourglass.entity.Task;
import com.hourglass.entity.Workspace;
import com.hourglass.mapper.ProjectVersionMapper;
import com.hourglass.mapper.ReportSubscriptionMapper;
import com.hourglass.mapper.RequirementMapper;
import com.hourglass.mapper.TaskMapper;
import com.hourglass.mapper.UserMapper;
import com.hourglass.mapper.VersionTaskMapper;
import com.hourglass.mapper.WorkspaceMapper;
import com.hourglass.mapper.WorkspaceMemberMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 定时报告：个人周报与版本报告。
 *
 * <p>订阅是个人设置，渠道由订阅人自选（站内 / 邮件），不复用通知偏好里的布尔开关：
 * 报告是「我要主动看」的内容，与「别人触发的通知是否打扰我」分开。
 * 周报按订阅的星期与小时扫描，一人一天最多一份；版本报告只在成功生产发布后触发。
 */
@Service
public class ReportService {

    private static final Logger log = LoggerFactory.getLogger(ReportService.class);
    private static final DateTimeFormatter MONTH_DAY = DateTimeFormatter.ofPattern("MM-dd");
    private static final int MAX_HIGHLIGHT = 6;
    private static final int MAX_SCAN = 500;
    private static final int DEFAULT_WEEKDAY = 5;
    private static final int DEFAULT_SEND_HOUR = 17;

    private final ReportSubscriptionMapper mapper;
    private final TaskMapper taskMapper;
    private final VersionTaskMapper versionTaskMapper;
    private final WorkspaceMapper workspaceMapper;
    private final WorkspaceMemberMapper memberMapper;
    private final UserMapper userMapper;
    private final ProjectVersionMapper versionMapper;
    private final RequirementMapper reqMapper;
    private final AppNotificationService inApp;
    private final MailDeliveryService mail;
    private final ProjectAccessService projectAccess;
    private final TransactionTemplate tx;

    @Value("${app.mail.base-url:}")
    private String mailBaseUrl;

    public ReportService(ReportSubscriptionMapper mapper, TaskMapper taskMapper,
                         VersionTaskMapper versionTaskMapper, WorkspaceMapper workspaceMapper,
                         WorkspaceMemberMapper memberMapper,
                         UserMapper userMapper, ProjectVersionMapper versionMapper,
                         RequirementMapper reqMapper, AppNotificationService inApp,
                         MailDeliveryService mail, ProjectAccessService projectAccess,
                         PlatformTransactionManager transactionManager) {
        this.mapper = mapper;
        this.taskMapper = taskMapper;
        this.versionTaskMapper = versionTaskMapper;
        this.workspaceMapper = workspaceMapper;
        this.memberMapper = memberMapper;
        this.userMapper = userMapper;
        this.versionMapper = versionMapper;
        this.reqMapper = reqMapper;
        this.inApp = inApp;
        this.mail = mail;
        this.projectAccess = projectAccess;
        this.tx = new TransactionTemplate(transactionManager);
        this.tx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    /** 每分钟扫描：只有星期与小时都命中、且今天还没发过的订阅才发送。 */
    @Scheduled(cron = "${app.report.weekly-cron:0 5 * * * *}")
    public void weeklyScan() {
        LocalDateTime now = LocalDateTime.now();
        List<ReportSubscription> subs;
        try {
            subs = mapper.selectEnabledByType(ReportSubscription.WEEKLY);
        } catch (Exception e) {
            log.warn("周报扫描：读取订阅失败", e);
            return;
        }
        int sent = 0;
        for (ReportSubscription sub : subs) {
            if (!weeklyDue(sub, now)) {
                continue;
            }
            try {
                Map<String, Object> r = sendWeekly(sub, true);
                if (Boolean.TRUE.equals(r.get("sent"))) {
                    sent++;
                }
            } catch (Exception e) {
                log.warn("周报发送失败：workspace={} user={}", sub.getWorkspaceId(), sub.getUserId(), e);
            }
        }
        if (sent > 0) {
            log.info("周报发送完成：{} 人", sent);
        }
    }

    private boolean weeklyDue(ReportSubscription sub, LocalDateTime now) {
        int weekday = sub.getWeekday() == null ? DEFAULT_WEEKDAY : sub.getWeekday();
        int hour = sub.getSendHour() == null ? DEFAULT_SEND_HOUR : sub.getSendHour();
        if (weekday != now.getDayOfWeek().getValue() || hour != now.getHour()) {
            return false;
        }
        return sub.getLastSentAt() == null || sub.getLastSentAt().isBefore(now.toLocalDate().atStartOfDay());
    }

    /** 个人数据视图：没有订阅行时给默认关闭的草稿，设置页不出现「空白」。 */
    public Map<String, Object> view(String userId, String workspaceId) {
        List<ReportSubscription> rows = mapper.selectByUser(workspaceId, userId);
        ReportSubscription weekly = null;
        ReportSubscription version = null;
        for (ReportSubscription row : rows) {
            if (ReportSubscription.WEEKLY.equals(row.getReportType())) {
                weekly = row;
            } else if (ReportSubscription.VERSION.equals(row.getReportType())) {
                version = row;
            }
        }
        Map<String, Object> res = new LinkedHashMap<String, Object>();
        res.put("weekly", reportView(weekly, ReportSubscription.WEEKLY));
        res.put("version", reportView(version, ReportSubscription.VERSION));
        res.put("defaultWeekday", DEFAULT_WEEKDAY);
        res.put("defaultSendHour", DEFAULT_SEND_HOUR);
        res.put("mailEnabled", mail.isEnabled());
        return res;
    }

    private Map<String, Object> reportView(ReportSubscription row, String type) {
        Map<String, Object> out = new LinkedHashMap<String, Object>();
        out.put("type", type);
        out.put("enabled", row != null && Boolean.TRUE.equals(row.getEnabled()));
        out.put("channels", row == null || Texts.trimToNull(row.getChannels()) == null
                ? "inapp" : row.getChannels());
        if (ReportSubscription.WEEKLY.equals(type)) {
            out.put("weekday", row == null || row.getWeekday() == null ? DEFAULT_WEEKDAY : row.getWeekday());
            out.put("sendHour", row == null || row.getSendHour() == null ? DEFAULT_SEND_HOUR : row.getSendHour());
        }
        out.put("lastSentAt", row == null ? null : row.getLastSentAt());
        return out;
    }

    /** 订阅人自己调整订阅，不要求空间管理权限。 */
    public Map<String, Object> update(String userId, String workspaceId, String type, Map<String, Object> body) {
        requireType(type);
        if (body == null) {
            throw AppException.badRequest("缺少订阅配置");
        }
        Object enabledRaw = body.get("enabled");
        if (!(enabledRaw instanceof Boolean)) {
            throw AppException.badRequest("订阅开关必须是布尔值");
        }
        String channels = normalizeChannels(body.get("channels"));
        Integer weekday = integer(body.get("weekday"), DEFAULT_WEEKDAY, 1, 7, "发送星期需在 1–7 之间");
        Integer sendHour = integer(body.get("sendHour"), DEFAULT_SEND_HOUR, 0, 23, "发送小时需在 0–23 之间");

        ReportSubscription row = new ReportSubscription();
        row.setId(Ids.gen("rs"));
        row.setWorkspaceId(workspaceId);
        row.setUserId(userId);
        row.setReportType(type);
        row.setEnabled((Boolean) enabledRaw);
        row.setChannels(channels);
        row.setWeekday(weekday);
        row.setSendHour(sendHour);
        mapper.upsert(row);
        return view(userId, workspaceId);
    }

    /** 立即发送一份给自己：用于确认内容与渠道是否通，不影响定时发送的「今天已发」判断。 */
    public Map<String, Object> sendNow(String userId, String workspaceId, String type, String versionId) {
        requireType(type);
        Workspace ws = workspaceMapper.selectById(workspaceId);
        if (ws == null) {
            throw AppException.badRequest("空间不存在");
        }
        ReportSubscription sub = mapper.selectOne(workspaceId, userId, type);
        if (sub == null) {
            sub = new ReportSubscription();
            sub.setWorkspaceId(workspaceId);
            sub.setUserId(userId);
            sub.setReportType(type);
            sub.setChannels("inapp");
        }
        if (ReportSubscription.WEEKLY.equals(type)) {
            return sendWeekly(sub, false);
        }
        ProjectVersion version = requireVersion(workspaceId, versionId);
        /* 报告内容含版本范围工作项，必须与版本页同口径校验项目可见性；不可见按不存在处理 */
        if (!projectAccess.canView(workspaceId, userId, version.getReqId())) {
            throw AppException.notFound("版本不存在或你没有访问权限");
        }
        String projectName = null;
        Requirement req = reqMapper.selectById(version.getReqId());
        if (req != null) {
            projectName = req.getName();
        }
        return sendVersion(sub, ws, version, projectName, null);
    }

    private ProjectVersion requireVersion(String workspaceId, String versionId) {
        String id = Texts.trimToNull(versionId);
        if (id == null) {
            throw AppException.badRequest("缺少版本ID");
        }
        ProjectVersion version = versionMapper.selectById(id);
        if (version == null || !workspaceId.equals(version.getWorkspaceId())) {
            throw AppException.badRequest("版本不存在");
        }
        return version;
    }

    /* ---------------------------------------------------------------- 周报 */

    public Map<String, Object> sendWeekly(ReportSubscription sub, boolean markSent) {
        String workspaceId = sub.getWorkspaceId();
        String userId = sub.getUserId();
        Workspace ws = workspaceMapper.selectById(workspaceId);
        AppUser user = userMapper.selectById(userId);
        if (ws == null || user == null) {
            return result(false, "空间或账号不存在");
        }
        if (memberMapper.selectMember(workspaceId, userId) == null) {
            return result(false, "已不在该空间，订阅不会发送");
        }
        LocalDateTime now = LocalDateTime.now();
        LocalDate today = now.toLocalDate();
        LocalDateTime from = today.with(DayOfWeek.MONDAY).atStartOfDay();
        if (from.isAfter(now)) {
            from = now.minusDays(6).toLocalDate().atStartOfDay();
        }
        List<Task> tasks = taskMapper.selectWeeklyReportTasks(workspaceId, userId,
                Texts.trimToNull(user.getDisplayName()), from, now.plusSeconds(1), MAX_SCAN);

        List<Task> done = new ArrayList<Task>();
        List<Task> overdue = new ArrayList<Task>();
        List<Task> doing = new ArrayList<Task>();
        int dueSoon = 0;
        LocalDate soonEnd = today.plusDays(7);
        for (Task t : tasks) {
            if (!projectAccess.canView(workspaceId, userId, t.getReqId())) {
                continue;
            }
            boolean isDone = "done".equals(t.getBoardColumn());
            if (isDone) {
                if (t.getCompletedAt() != null && !t.getCompletedAt().isBefore(from)
                        && t.getCompletedAt().isBefore(now.plusSeconds(1))) {
                    done.add(t);
                }
                continue;
            }
            if (t.getDueDate() != null && t.getDueDate().isBefore(today)) {
                overdue.add(t);
                continue;
            }
            doing.add(t);
            if (t.getDueDate() != null && !t.getDueDate().isAfter(soonEnd)) {
                dueSoon++;
            }
        }

        String title = "本周工作小结（" + from.format(MONTH_DAY) + " – " + now.format(MONTH_DAY) + "）";
        StringBuilder body = new StringBuilder();
        body.append("本周完成 ").append(done.size()).append(" 项，进行中 ").append(doing.size())
            .append(" 项，逾期 ").append(overdue.size()).append(" 项");
        if (dueSoon > 0) {
            body.append("，未来 7 天到期 ").append(dueSoon).append(" 项");
        }
        body.append("。");
        if (!done.isEmpty()) {
            body.append("\n\n【本周完成】");
            appendTitles(body, done, null, today);
        }
        if (!overdue.isEmpty()) {
            body.append("\n\n【仍需跟进】");
            appendTitles(body, overdue, "逾期 %d 天", today);
        } else if (!doing.isEmpty()) {
            body.append("\n\n【进行中】");
            appendTitles(body, doing, null, today);
        }
        if (tasks.size() >= MAX_SCAN) {
            /* 查询有上限：命中上限说明数据被截断，必须如实说明，不能当完整统计 */
            body.append("\n\n本周工作项超过 ").append(MAX_SCAN).append(" 项，以上统计未覆盖全部，请到「我的工作」查看完整清单。");
        } else {
            body.append("\n\n到「我的工作」查看完整清单。");
        }

        Outcome out = deliver(sub, ws, user, title, body.toString(),
                "weekly_report", "mywork", workspaceId, null);
        if (markSent && out.any() && sub.getId() != null) {
            mapper.touchLastSent(sub.getId(), now);
        }
        return result(out.any(), out.describe());
    }

    /* ------------------------------------------------------------ 版本报告 */

    /**
     * 版本成功生产发布后调用。必须在发布事务内调用：发送被推迟到提交之后，
     * 失败不会回滚发布事实；订阅不存在时直接返回，不产生任何写入。
     */
    public void scheduleVersionReport(String workspaceId, String versionId, String versionName,
                                      String projectName, String reqId, Integer publishedCount) {
        List<ReportSubscription> subs;
        try {
            subs = mapper.selectEnabledForWorkspace(workspaceId, ReportSubscription.VERSION);
        } catch (Exception e) {
            log.warn("版本报告：读取订阅失败 workspace={}", workspaceId, e);
            return;
        }
        if (subs.isEmpty()) {
            return;
        }
        Runnable send = () -> {
            for (ReportSubscription sub : subs) {
                try {
                    if (!projectAccess.canView(workspaceId, sub.getUserId(), reqId)) {
                        continue;
                    }
                    Workspace ws = workspaceMapper.selectById(workspaceId);
                    AppUser user = userMapper.selectById(sub.getUserId());
                    ProjectVersion version = versionMapper.selectById(versionId);
                    if (ws == null || user == null || version == null) {
                        continue;
                    }
                    sendVersion(sub, ws, version, projectName, publishedCount);
                } catch (Exception e) {
                    log.warn("版本报告发送失败：version={} user={}", versionId, sub.getUserId(), e);
                }
            }
        };
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    try {
                        tx.execute(status -> {
                            send.run();
                            return null;
                        });
                    } catch (Exception e) {
                        log.warn("版本报告发送失败：version={}", versionId, e);
                    }
                }
            });
        } else {
            send.run();
        }
    }

    private Map<String, Object> sendVersion(ReportSubscription sub, Workspace ws, ProjectVersion version,
                                            String projectName, Integer publishedCount) {
        String workspaceId = version.getWorkspaceId();
        AppUser user = userMapper.selectById(sub.getUserId());
        if (user == null) {
            return result(false, "账号不存在");
        }
        if (memberMapper.selectMember(workspaceId, sub.getUserId()) == null) {
            return result(false, "已不在该空间，订阅不会发送");
        }
        List<Task> tasks = versionTaskMapper.selectReportTasks(workspaceId, version.getId());
        int total = tasks == null ? 0 : tasks.size();
        int done = 0;
        int estimate = 0;
        int actual = 0;
        List<Task> highlighted = new ArrayList<Task>();
        for (Task t : tasks == null ? new ArrayList<Task>() : tasks) {
            if ("done".equals(t.getBoardColumn())) {
                done++;
            }
            if (t.getEstimateMinutes() != null) {
                estimate += t.getEstimateMinutes();
            }
            if (t.getTotalMinutes() != null) {
                actual += t.getTotalMinutes();
            }
            if (highlighted.size() < MAX_HIGHLIGHT) {
                highlighted.add(t);
            }
        }
        String versionName = version.getName();
        String title = "版本「" + versionName + "」发布报告";
        StringBuilder body = new StringBuilder();
        if (Texts.trimToNull(projectName) != null) {
            body.append("项目：").append(projectName).append("\n");
        }
        body.append("版本范围 ").append(total).append(" 个工作项，已完成 ").append(done).append(" 项");
        if (publishedCount != null && publishedCount > 0) {
            body.append("，本次随版本发布 ").append(publishedCount).append(" 项");
        }
        body.append("。\n预估 ").append(hours(estimate)).append(" 小时，实际 ").append(hours(actual)).append(" 小时。");
        if (!highlighted.isEmpty()) {
            body.append("\n\n【工作项】");
            for (Task t : highlighted) {
                body.append("\n· ").append(Texts.cut(t.getTitle(), 60))
                    .append("（").append(columnLabel(t.getBoardColumn())).append("）");
            }
            if (total > highlighted.size()) {
                body.append("\n…等共 ").append(total).append(" 项");
            }
        }
        body.append("\n\n到版本页查看交付说明。");

        Outcome out = deliver(sub, ws, user, title, body.toString(),
                "version_report", "version", version.getId(), version.getReqId());
        return result(out.any(), out.describe());
    }

    /* -------------------------------------------------------------- 公共 */

    private Outcome deliver(ReportSubscription sub, Workspace ws, AppUser user, String title, String body,
                            String type, String refKind, String refId, String reqId) {
        String channels = normalizeChannels(sub.getChannels());
        boolean inapp = false;
        boolean inappFailed = false;
        boolean email = false;
        if (!"email".equals(channels) && !Boolean.FALSE.equals(ws.getNotifyInAppEnabled())) {
            inapp = inApp.pushImmediate(user.getId(), ws.getId(), type, title, body, null, refKind, refId, reqId)
                    == AppNotificationService.PushResult.INSERTED;
            inappFailed = !inapp;
        }
        if (!"inapp".equals(channels)) {
            String to = Texts.trimToNull(user.getEmail());
            if (to != null) {
                email = mail.enqueue(to, title, mailBody(body, refKind, refId), type, refId);
            }
        }
        return new Outcome(inapp, email, inappFailed);
    }

    private String mailBody(String body, String refKind, String refId) {
        String base = Texts.trimToNull(mailBaseUrl);
        if (base == null) {
            return body;
        }
        if (!base.endsWith("/")) {
            base = base + "/";
        }
        if ("version".equals(refKind) && Texts.trimToNull(refId) != null) {
            /* 版本报告直达该版本的交付说明页，而不是只落到版本列表；ID 只保留 URL 安全字符 */
            String safeId = refId.replaceAll("[^A-Za-z0-9_-]", "");
            return body + "\n\n打开交付说明：" + base + "#/delivery?versionId=" + safeId;
        }
        return body + "\n\n打开沙漏：" + base + "#/mine";
    }

    private String normalizeChannels(Object raw) {
        String value = raw == null ? "inapp" : String.valueOf(raw).trim();
        if ("inapp".equals(value) || "email".equals(value) || "both".equals(value)) {
            return value;
        }
        throw AppException.badRequest("发送渠道只能是站内、邮件或两者");
    }

    private void requireType(String type) {
        if (!ReportSubscription.WEEKLY.equals(type) && !ReportSubscription.VERSION.equals(type)) {
            throw AppException.badRequest("不支持的订阅类型");
        }
    }

    private Integer integer(Object raw, int fallback, int min, int max, String message) {
        if (raw == null) {
            return fallback;
        }
        if (!(raw instanceof Number)) {
            throw AppException.badRequest(message);
        }
        int value = ((Number) raw).intValue();
        if (value < min || value > max) {
            throw AppException.badRequest(message);
        }
        return value;
    }

    private void appendTitles(StringBuilder body, List<Task> tasks, String suffix, LocalDate today) {
        int n = Math.min(tasks.size(), MAX_HIGHLIGHT);
        for (int i = 0; i < n; i++) {
            Task t = tasks.get(i);
            body.append("\n· ").append(Texts.cut(t.getTitle(), 60));
            if (suffix != null && t.getDueDate() != null) {
                long days = ChronoUnit.DAYS.between(t.getDueDate(), today);
                body.append("（").append(String.format(suffix, days)).append("）");
            }
        }
        if (tasks.size() > n) {
            body.append("\n…等共 ").append(tasks.size()).append(" 项");
        }
    }

    private String hours(int minutes) {
        if (minutes <= 0) {
            return "0";
        }
        if (minutes % 60 == 0) {
            return String.valueOf(minutes / 60);
        }
        return String.format("%.1f", minutes / 60.0);
    }

    private String columnLabel(String column) {
        if ("done".equals(column)) {
            return "已完成";
        }
        if ("testing".equals(column)) {
            return "测试中";
        }
        if ("doing".equals(column)) {
            return "进行中";
        }
        if ("canceled".equals(column)) {
            return "已取消";
        }
        return "待处理";
    }

    private Map<String, Object> result(boolean sent, String message) {
        Map<String, Object> out = new LinkedHashMap<String, Object>();
        out.put("sent", sent);
        out.put("message", message);
        return out;
    }

    private static final class Outcome {
        final boolean inapp;
        final boolean email;
        /** 站内渠道本应发送但写入失败：与「开关未开」区分开，避免提示误导。 */
        final boolean inappFailed;

        Outcome(boolean inapp, boolean email, boolean inappFailed) {
            this.inapp = inapp;
            this.email = email;
            this.inappFailed = inappFailed;
        }

        boolean any() {
            return inapp || email;
        }

        String describe() {
            if (inapp && email) {
                return "已发送站内通知，邮件已入队";
            }
            if (inapp) {
                return "已发送站内通知；邮件未启用或未配置邮箱";
            }
            if (email && inappFailed) {
                return "邮件已入队；站内通知写入失败";
            }
            if (email) {
                return "邮件已入队；站内通知未开启";
            }
            if (inappFailed) {
                return "站内通知写入失败，请稍后重试";
            }
            return "没有可用渠道，请检查站内通知开关与发信设置";
        }
    }
}
