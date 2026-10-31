package com.devstudio.kanban.service;

import com.devstudio.kanban.common.TaskCalc;
import com.devstudio.kanban.common.Texts;
import com.devstudio.kanban.common.Webhooks;
import com.devstudio.kanban.entity.AppUser;
import com.devstudio.kanban.entity.Task;
import com.devstudio.kanban.entity.TaskLog;
import com.devstudio.kanban.entity.Workspace;
import com.devstudio.kanban.entity.WorkspaceMember;
import com.devstudio.kanban.mapper.TaskLogMapper;
import com.devstudio.kanban.mapper.TaskMapper;
import com.devstudio.kanban.mapper.UserMapper;
import com.devstudio.kanban.mapper.WorkspaceMapper;
import com.devstudio.kanban.mapper.WorkspaceMemberMapper;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.io.IOException;
import java.net.HttpURLConnection;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 推送提醒（按空间隔离）。
 *
 * 2026-10-16 评估报告改造要点：
 *  - O-1：推送渠道 / 开关 / token 下沉到空间级（workspace.notify_channel / notify_enabled / notify_token），
 *         全局 app.notify.* 降级为默认值；每次尝试都回写 workspace.notify_last_at / notify_last_status，
 *         让设置页能显示"是否真正生效"。
 *  - O-1③：「测试推送」走与定时任务完全相同的开关判断，未启用时如实说明，不再返回"假绿"。
 *  - N-1：任务级提醒除了外部渠道，还写入应用内通知（app_notification），投递给任务负责人本人
 *         （remind_target=owner+admin 时再带上空间主），因此不配群机器人也能收到提醒。
 */
@Service
public class NotificationService {

    private static final Logger log = LoggerFactory.getLogger(NotificationService.class);
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final int REMIND_WINDOW_HOURS = 6;
    /** pushplus 官方端点：统一 token 只发这里，绝不发给空间自填地址 */
    private static final String PUSHPLUS_ENDPOINT = "https://www.pushplus.plus/send";
    /** 未启用推送时的统一说明（设置页与测试推送共用，避免"测试通过但定时不发"） */
    public static final String DISABLED_REASON =
            "服务端未启用推送（app.notify.enabled 未打开），定时提醒不会发送；本次为单次测试";

    private final TaskMapper taskMapper;
    private final WorkspaceMapper workspaceMapper;
    private final TaskLogMapper logMapper;
    private final WorkspaceMemberMapper memberMapper;
    private final UserMapper userMapper;
    private final AppNotificationService appNotificationService;
    private final RestTemplate restTemplate;

    @Value("${app.notify.enabled:false}")
    private boolean enabled;

    @Value("${app.notify.type:webhook}")
    private String type;

    @Value("${app.notify.token:}")
    private String token;

    @Value("${app.notify.link:}")
    private String link;

    public NotificationService(TaskMapper taskMapper, WorkspaceMapper workspaceMapper, TaskLogMapper logMapper,
                               WorkspaceMemberMapper memberMapper, UserMapper userMapper,
                               AppNotificationService appNotificationService) {
        this.taskMapper = taskMapper;
        this.workspaceMapper = workspaceMapper;
        this.logMapper = logMapper;
        this.memberMapper = memberMapper;
        this.userMapper = userMapper;
        this.appNotificationService = appNotificationService;
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory() {
            @Override
            protected void prepareConnection(HttpURLConnection connection, String httpMethod) throws IOException {
                super.prepareConnection(connection, httpMethod);
                // 不跟随重定向：防止公开地址 302 到内网（SSRF 绕行）
                connection.setInstanceFollowRedirects(false);
            }
        };
        factory.setConnectTimeout(5000);
        factory.setReadTimeout(5000);
        this.restTemplate = new RestTemplate(factory);
    }

    /* ==================== 生效判定（O-1） ==================== */

    /** 空间级开关优先；为 null（历史行）时跟随全局环境变量 */
    public boolean effectiveEnabled(Workspace ws) {
        if (ws != null && ws.getNotifyEnabled() != null) {
            return ws.getNotifyEnabled();
        }
        return enabled;
    }

    /** 空间级渠道优先；为空时跟随全局 NOTIFY_TYPE */
    public String effectiveChannel(Workspace ws) {
        String ch = ws == null ? null : Texts.trimToNull(ws.getNotifyChannel());
        if (ch == null) {
            ch = type == null ? "webhook" : type.trim().toLowerCase();
        }
        return ch;
    }

    /** 空间级 token 优先；为空时用全局 NOTIFY_TOKEN */
    public String effectiveToken(Workspace ws) {
        String tk = ws == null ? null : Texts.trimToNull(ws.getNotifyToken());
        return tk != null ? tk : Texts.trimToNull(token);
    }

    /**
     * 实际发送地址：空间地址优先；Server 酱只填了 Token 时按官方端点补全，
     * 与设置页「只填 Token 时服务端会自动补全端点」的提示保持一致。
     */
    public String effectiveHook(Workspace ws) {
        String hook = Texts.trimToNull(ws == null ? null : ws.getNotifyWebhook());
        if (hook != null) {
            return hook;
        }
        if ("serverchan".equals(effectiveChannel(ws))) {
            String tk = effectiveToken(ws);
            if (tk != null) {
                return "https://sctapi.ftqq.com/" + tk + ".send";
            }
        }
        return null;
    }

    /* ==================== 定时任务 ==================== */

    @Scheduled(cron = "${app.notify.cron:0 0 9 * * *}")
    public void dailyPush() {
        List<Workspace> all;
        try {
            all = workspaceMapper.selectAll();
        } catch (Exception e) {
            log.warn("每日提醒：读取空间列表失败", e);
            return;
        }
        for (Workspace ws : all) {
            /* R-3：汇总现在也写应用内通知，因此不再只遍历"配了 webhook 的空间"；
               R-4：按空间隔离异常，一个空间失败不影响其它空间的当日汇总。 */
            try {
                if (!effectiveEnabled(ws)) {
                    continue; // 空间级或全局开关关闭：定时汇总不发送（应用内也不发）
                }
                Map<String, Object> result = pushDigest(ws, false);
                log.info("每日提醒检查（{}）：{}", ws.getName(), result);
            } catch (Exception e) {
                log.warn("每日提醒推送异常（空间 {}），已跳过该空间", ws.getId(), e);
            }
        }
    }

    @Scheduled(cron = "0 */5 * * * *")
    public void remindScan() {
        LocalDateTime now = LocalDateTime.now();
        List<Workspace> all;
        try {
            all = workspaceMapper.selectAll();
        } catch (Exception e) {
            log.warn("任务级提醒扫描：读取空间列表失败", e);
            return;
        }
        for (Workspace ws : all) {
            /* 第九轮/复评 R-4：按空间隔离异常。
               原实现用一个 try 包住全部空间的循环，任一空间抛异常会让后续空间的当轮提醒全部停发。 */
            try {
                scanWorkspaceReminders(ws, now);
            } catch (Exception e) {
                log.warn("任务级提醒扫描异常（空间 {}），已跳过该空间继续处理其它空间", ws.getId(), e);
            }
        }
    }

    /** 单空间一轮提醒扫描（本方法内的异常由调用方按空间兜住） */
    private void scanWorkspaceReminders(Workspace ws, LocalDateTime now) {
        boolean wsEnabled = effectiveEnabled(ws);
        String hook = effectiveHook(ws);
        for (Task t : taskMapper.selectRemindDue(ws.getId(), now, now.minusHours(REMIND_WINDOW_HOURS))) {
            /* 再按任务隔离一次：单条任务的数据异常不应影响同空间其它任务的提醒 */
            try {
                boolean externalConfigured = wsEnabled && hook != null;
                /* N-1：先写应用内通知（不依赖外部渠道是否配置），做到"提醒到本人" */
                boolean inApp = notifyTaskRemindInApp(ws, t);
                if (externalConfigured) {
                    // 配了外部渠道：以它为准决定是否闭环（失败保留在 6 小时窗口内重试）
                    if (sendContent(ws, buildTaskRemindContent(ws, t), hook)) {
                        taskMapper.markRemindSent(t.getId());
                    }
                } else if (inApp) {
                    // 没配外部渠道：应用内送达即闭环，并在时间线上说明"为什么没发群消息"
                    taskMapper.markRemindSent(t.getId());
                    logRemindSkipped(ws, t, "提醒时间已到，空间未启用外部推送，已通过应用内通知送达");
                }
            } catch (Exception e) {
                log.warn("单条任务提醒处理失败（task={}），已跳过", t.getId(), e);
            }
        }
        for (Task t : taskMapper.selectRemindExpired(ws.getId(), now.minusHours(REMIND_WINDOW_HOURS))) {
            try {
                taskMapper.markRemindSent(t.getId());
                logRemindSkipped(ws, t, hook == null
                        ? "提醒时间已过，空间未配置推送渠道，未推送"
                        : "提醒时间已过（超过 6 小时重试窗口），未推送");
            } catch (Exception e) {
                log.warn("过期提醒标记失败（task={}），已跳过", t.getId(), e);
            }
        }
    }

    private void logRemindSkipped(Workspace ws, Task t, String detail) {
        TaskLog l = new TaskLog();
        l.setTaskId(t.getId());
        l.setWorkspaceId(ws.getId());
        l.setActorId(null);
        l.setAction("update");
        l.setDetail(detail);
        logMapper.insert(l);
    }

    /** N-1：任务级提醒写入应用内通知，投递给负责人本人（可选带上空间主） */
    private boolean notifyTaskRemindInApp(Workspace ws, Task t) {
        Set<String> targets = resolveRecipients(ws, t);
        if (targets.isEmpty()) {
            return false;
        }
        String title = "任务提醒：" + t.getTitle();
        StringBuilder body = new StringBuilder();
        body.append("优先级 ").append(t.getPriority());
        if (t.getDueDate() != null) {
            body.append(" · 截止 ").append(t.getDueDate());
        }
        if (t.getBlockedReason() != null) {
            body.append(" · 卡点：").append(Texts.cut(t.getBlockedReason(), 60));
        }
        for (String uid : targets) {
            appNotificationService.push(uid, ws.getId(), "task_remind", title, body.toString(), t.getId());
        }
        return true;
    }

    /**
     * 解析"提醒谁"：
     *  - owner（默认）：负责人的账号（优先 owner_user_id，历史行回落显示名匹配空间成员）
     *  - owner+admin：负责人 + 空间主
     */
    private Set<String> resolveRecipients(Workspace ws, Task t) {
        Set<String> out = new LinkedHashSet<String>();
        String ownerId = Texts.trimToNull(t.getOwnerUserId());
        if (ownerId != null) {
            out.add(ownerId);
        } else {
            String byName = matchMemberByName(ws.getId(), t.getOwner());
            if (byName != null) {
                out.add(byName);
            }
        }
        if ("owner+admin".equals(t.getRemindTarget()) && ws.getOwnerId() != null) {
            out.add(ws.getOwnerId());
        }
        return out;
    }

    private String matchMemberByName(String workspaceId, String displayName) {
        String name = Texts.trimToNull(displayName);
        if (name == null) {
            return null;
        }
        for (WorkspaceMember m : memberMapper.selectByWorkspace(workspaceId)) {
            AppUser u = userMapper.selectById(m.getUserId());
            if (u != null && name.equals(u.getDisplayName())) {
                return m.getUserId();
            }
        }
        return null;
    }

    /* ==================== 手动测试推送（O-1③） ==================== */

    /**
     * 汇总推送（POST /api/notify/test 手动触发时 force=true，作用于当前空间）。
     * force 只影响"空了也发"，不再绕过开关：未启用时如实返回未发送与原因。
     */
    public Map<String, Object> push(Workspace ws, boolean force) {
        Map<String, Object> res = new LinkedHashMap<String, Object>();
        if (!effectiveEnabled(ws)) {
            res.put("sent", false);
            res.put("enabled", false);
            res.put("reason", DISABLED_REASON);
            return res;
        }
        /* 手动测试只走外部渠道：站内汇总只应由每日任务生成，否则点几次测试就多几条重复站内信 */
        Map<String, Object> out = pushDigest(ws, force, false);
        out.put("enabled", true);
        return out;
    }

    private Map<String, Object> pushDigest(Workspace ws, boolean force) {
        return pushDigest(ws, force, true);
    }

    private Map<String, Object> pushDigest(Workspace ws, boolean force, boolean withInApp) {
        Map<String, Object> res = new LinkedHashMap<String, Object>();
        LocalDate today = LocalDate.now();
        List<Task> over = new ArrayList<Task>();
        List<Task> todayDue = new ArrayList<Task>();
        for (Task t : taskMapper.selectAll(ws.getId())) {
            String kind = TaskCalc.dueKind(t, today);
            if ("over".equals(kind)) {
                over.add(t);
            } else if ("today".equals(kind)) {
                todayDue.add(t);
            }
        }
        over.sort(new Comparator<Task>() {
            @Override
            public int compare(Task a, Task b) {
                return a.getDueDate().compareTo(b.getDueDate());
            }
        });

        if (!force && over.isEmpty() && todayDue.isEmpty()) {
            res.put("sent", false);
            res.put("reason", "当前无逾期或今日到期任务，静默跳过");
            return res;
        }

        /* R-3：每日汇总同样落应用内通知（按负责人分组），
           使"空间没配群机器人"时汇总不会完全静默 —— 与任务级提醒同一口径。
           手动测试（withInApp=false）不写站内信，避免反复点测试刷重复汇总。 */
        int inApp = withInApp ? pushDigestInApp(ws, over, todayDue) : 0;
        res.put("inApp", inApp);

        String hook = effectiveHook(ws);
        if (hook == null) {
            res.put("sent", false);
            res.put("reason", inApp > 0
                    ? "该空间未配置推送地址，已通过应用内通知送达 " + inApp + " 人"
                    : "该空间未配置推送地址（在「设置 → 通知推送」中填写）");
            return res;
        }

        String content = buildDigestContent(ws, over, todayDue, today, force);
        boolean sent = sendContent(ws, content, hook);
        res.put("sent", sent);
        res.put("content", content);
        if (!sent) {
            res.put("reason", "推送请求失败或被渠道拒绝（详见服务端日志，也可看本页「上次推送」）");
        }
        return res;
    }

    /**
     * R-3：把当日汇总按负责人分组写入应用内通知，返回实际送达的人数。
     * 归属判定与任务级提醒一致：优先 owner_user_id，历史行回落显示名匹配空间成员。
     */
    private int pushDigestInApp(Workspace ws, List<Task> over, List<Task> todayDue) {
        Map<String, List<Task>> byUser = new LinkedHashMap<String, List<Task>>();
        for (Task t : over) {
            addDigestTarget(ws, byUser, t);
        }
        for (Task t : todayDue) {
            addDigestTarget(ws, byUser, t);
        }
        LocalDate today = LocalDate.now();
        int sent = 0;
        for (Map.Entry<String, List<Task>> e : byUser.entrySet()) {
            int overN = 0;
            int todayN = 0;
            for (Task t : e.getValue()) {
                String kind = TaskCalc.dueKind(t, today);
                if ("over".equals(kind)) {
                    overN++;
                } else if ("today".equals(kind)) {
                    todayN++;
                }
            }
            StringBuilder body = new StringBuilder("我的任务：");
            if (overN > 0) {
                body.append("逾期 ").append(overN).append(" 项");
            }
            if (overN > 0 && todayN > 0) {
                body.append(" · ");
            }
            if (todayN > 0) {
                body.append("今天到期 ").append(todayN).append(" 项");
            }
            appNotificationService.push(e.getKey(), ws.getId(), "task_due",
                    "今日任务汇总", body.toString(), null);
            sent++;
        }
        return sent;
    }

    private void addDigestTarget(Workspace ws, Map<String, List<Task>> byUser, Task t) {
        String uid = Texts.trimToNull(t.getOwnerUserId());
        if (uid == null) {
            uid = matchMemberByName(ws.getId(), t.getOwner());
        }
        if (uid == null) {
            return;
        }
        List<Task> list = byUser.get(uid);
        if (list == null) {
            list = new ArrayList<Task>();
            byUser.put(uid, list);
        }
        list.add(t);
    }

    private String workspaceTag(Workspace ws) {
        return "personal".equals(ws.getType()) ? "【工作台】" : ("【工作台·" + ws.getName() + "】");
    }

    private String buildDigestContent(Workspace ws, List<Task> over, List<Task> todayDue, LocalDate today, boolean test) {
        StringBuilder sb = new StringBuilder();
        sb.append(workspaceTag(ws)).append("任务提醒 ").append(today);
        if (test && over.isEmpty() && todayDue.isEmpty()) {
            sb.append("\n测试推送 ✔ 服务正常，当前无逾期与今日到期任务。");
        } else {
            if (!over.isEmpty()) {
                sb.append("\n逾期 ").append(over.size()).append(" 项：");
                int n = Math.min(over.size(), 10);
                for (int i = 0; i < n; i++) {
                    Task t = over.get(i);
                    long days = ChronoUnit.DAYS.between(t.getDueDate(), today);
                    sb.append("\n· [").append(t.getPriority()).append("] ").append(t.getTitle())
                      .append("（").append(t.getOwner()).append("，逾期 ").append(days).append(" 天）");
                }
                if (over.size() > n) {
                    sb.append("\n…等共 ").append(over.size()).append(" 项");
                }
            }
            if (!todayDue.isEmpty()) {
                sb.append("\n今天到期 ").append(todayDue.size()).append(" 项：");
                int n = Math.min(todayDue.size(), 10);
                for (int i = 0; i < n; i++) {
                    Task t = todayDue.get(i);
                    sb.append("\n· [").append(t.getPriority()).append("] ").append(t.getTitle())
                      .append("（").append(t.getOwner()).append("）");
                }
                if (todayDue.size() > n) {
                    sb.append("\n…等共 ").append(todayDue.size()).append(" 项");
                }
            }
        }
        appendLink(sb);
        return sb.toString();
    }

    private String buildTaskRemindContent(Workspace ws, Task t) {
        StringBuilder sb = new StringBuilder();
        sb.append(workspaceTag(ws)).append("任务提醒：「").append(t.getTitle()).append("」");
        sb.append("\n优先级 ").append(t.getPriority()).append(" · 负责人 ").append(t.getOwner());
        if (t.getDueDate() != null) {
            sb.append(" · 截止 ").append(t.getDueDate());
        }
        if (t.getRemindAt() != null) {
            sb.append("\n提醒时间 ").append(t.getRemindAt().format(java.time.format.DateTimeFormatter.ofPattern("MM-dd HH:mm")));
        }
        if (t.getBlockedReason() != null) {
            sb.append("\n卡点：").append(Texts.cut(t.getBlockedReason(), 80));
        }
        appendLink(sb);
        return sb.toString();
    }

    private void appendLink(StringBuilder sb) {
        String linkText = Texts.trimToNull(link);
        if (linkText != null) {
            sb.append("\n打开看板：").append(linkText);
        }
    }

    /* ==================== 发送 ==================== */

    /** 按渠道组装报文并发送，返回是否成功；同时回写"上次推送"状态（O-1 可视化依据） */
    private boolean sendContent(Workspace ws, String content, String hookRaw) {
        String hook = Texts.trimToNull(hookRaw);
        if (hook == null) {
            recordResult(ws, "failed:未配置推送地址");
            return false;
        }
        String channel = effectiveChannel(ws);
        if ("pushplus".equals(channel)) {
            // 统一 token 固定发往官方端点：空间自填地址只当"启用开关"，绝不接收入站 token
            hook = PUSHPLUS_ENDPOINT;
        } else {
            String err = Webhooks.check(hook);
            if (err != null) {
                log.warn("推送地址被拒绝（{}）：{}", err, Texts.cut(hook, 100));
                recordResult(ws, "failed:" + Texts.cut(err, 120));
                return false;
            }
        }
        Map<String, Object> payload = new LinkedHashMap<String, Object>();
        String title = content;
        String body = "";
        int idx = content.indexOf('\n');
        if (idx >= 0) {
            title = content.substring(0, idx);
            body = content.substring(idx + 1);
        }
        if ("serverchan".equals(channel)) {
            payload.put("title", title);
            payload.put("desp", body);
        } else if ("pushplus".equals(channel)) {
            String tk = effectiveToken(ws);
            if (tk == null) {
                log.warn("pushplus 渠道未配置 token（空间与全局都为空）");
                recordResult(ws, "failed:未配置 PushPlus token");
                return false;
            }
            payload.put("token", tk);
            payload.put("title", title);
            payload.put("content", body);
            payload.put("template", "txt");
        } else {
            Map<String, Object> text = new LinkedHashMap<String, Object>();
            text.put("content", content);
            payload.put("msgtype", "text");
            payload.put("text", text);
        }
        try {
            String resp = restTemplate.postForObject(hook, payload, String.class);
            if (!channelAccepted(channel, resp)) {
                // 未解析出渠道成功码（HTML 错误页/空响应/跳转页等）一律视为失败：提醒会保留待重试，不误标已发送
                log.warn("推送结果无法确认为成功（渠道 {}）：{}", channel,
                        Texts.cut(resp == null ? "<空响应>" : resp, 200));
                recordResult(ws, "failed:渠道未返回明确成功码");
                return false;
            }
            recordResult(ws, "success");
            return true;
        } catch (Exception e) {
            log.warn("推送请求失败", e);
            /* 异常文本可能带完整 webhook（serverchan 的 URL 里就有 token），回写到设置页前先脱敏 */
            recordResult(ws, "failed:" + Texts.cut(safeError(e), 120));
            return false;
        }
    }

    private static String safeError(Exception e) {
        String m = e.getMessage();
        if (m == null || m.trim().isEmpty()) {
            return e.getClass().getSimpleName();
        }
        return m.replaceAll("https?://\\S+", "<url>");
    }

    /** 推送结果回写（失败只记日志，不影响业务） */
    private void recordResult(Workspace ws, String status) {
        if (ws == null || ws.getId() == null) {
            return;
        }
        try {
            workspaceMapper.updateNotifyResult(ws.getId(), Texts.cut(status, 160));
        } catch (Exception e) {
            log.warn("回写推送状态失败（不影响业务）：{}", ws.getId(), e);
        }
    }

    /**
     * 严格成功判定：正文必须能解析为 JSON 对象，且按渠道协议在顶层给出明确的整数成功码。
     */
    private boolean channelAccepted(String channel, String body) {
        String text = Texts.trimToNull(body);
        if (text == null) {
            return false;
        }
        JsonNode root;
        try {
            root = JSON.readTree(text);
        } catch (Exception e) {
            return false;
        }
        if (root == null || !root.isObject()) {
            return false;
        }
        if ("pushplus".equals(channel)) {
            JsonNode code = root.get("code");
            return code != null && code.isInt() && (code.asInt() == 200 || code.asInt() == 0);
        }
        if ("serverchan".equals(channel)) {
            JsonNode code = root.get("code");
            return code != null && code.isInt() && code.asInt() == 0;
        }
        JsonNode errcode = root.get("errcode");
        return errcode != null && errcode.isInt() && errcode.asInt() == 0;
    }
}
