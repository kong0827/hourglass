package com.hourglass.service;

import com.hourglass.common.Consts;
import com.hourglass.common.Texts;
import com.hourglass.dto.ActivityFeed;
import com.hourglass.dto.ActivityFeedItem;
import com.hourglass.dto.ActivityQuery;
import com.hourglass.dto.AiAssistantContext;
import com.hourglass.dto.AiAssistantFact;
import com.hourglass.dto.AiAssistantLink;
import com.hourglass.dto.AiAssistantResponse;
import com.hourglass.dto.AiAssistantTaskItem;
import com.hourglass.dto.BoardQuery;
import com.hourglass.dto.DeliveryNoteResponse;
import com.hourglass.dto.DemandPage;
import com.hourglass.dto.DemandQuery;
import com.hourglass.dto.PageResult;
import com.hourglass.dto.ReqProgress;
import com.hourglass.dto.TaskListResponse;
import com.hourglass.dto.VersionOverviewResponse;
import com.hourglass.dto.VersionStatsResponse;
import com.hourglass.entity.AppUser;
import com.hourglass.entity.BoardColumn;
import com.hourglass.entity.Demand;
import com.hourglass.entity.Task;
import com.hourglass.mapper.UserMapper;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 助手的只读查询工具层：回答「我的工作、项目健康、版本进度、需求追踪、发布就绪、成员负载、
 * 需求缺口、最近变更」这类需要取数的问题。
 *
 * <p>约束：
 * <ol>
 *   <li>所有项目先按当前用户可见范围过滤；显式传入的项目名/ID 命中不了可见集合就当作没指定。</li>
 *   <li>需求、版本、任务都在服务层重新校验可见性；不接受前端或模型自报的权限。</li>
 *   <li>工具结果只下发前端渲染，不进入对话历史与提示词；模型只负责选工具，不负责编数字。</li>
 * </ol>
 */
@Service
public class AiAssistantInsightService {

    private static final int SHOW_TASKS = 8;
    private static final int SHOW_FACTS = 8;
    private static final int MAX_DEMANDS = 100;
    private static final java.time.format.DateTimeFormatter STATS_TS =
            java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm");
    private static final Pattern QUOTED = Pattern.compile("[「“\"]([^」”\"]{2,40})[」”\"]");

    private static final Set<String> TOOLS = new LinkedHashSet<String>(Arrays.asList(
            "my_work", "project_health", "version_progress", "demand_trace",
            "release_readiness", "team_load", "demand_gaps", "change_log"));

    private static final Map<String, String> WORK_STATUS = new HashMap<String, String>();
    private static final Map<String, String> VERSION_STATUS = new HashMap<String, String>();
    private static final Map<String, String> HEALTH = new HashMap<String, String>();

    static {
        WORK_STATUS.put("review", "待评审");
        WORK_STATUS.put("pass", "已通过");
        WORK_STATUS.put("plan", "已排期");
        WORK_STATUS.put("done", "已完成");
        WORK_STATUS.put("closed", "已关闭");

        VERSION_STATUS.put("planned", "计划中");
        VERSION_STATUS.put("active", "进行中");
        VERSION_STATUS.put("released", "已发布");
        VERSION_STATUS.put("closed", "已关闭");
        VERSION_STATUS.put("canceled", "已取消");

        HEALTH.put("red", "风险高");
        HEALTH.put("orange", "需关注");
        HEALTH.put("green", "正常");
    }

    private final RequirementService requirementService;
    private final ProjectAccessService projectAccess;
    private final TaskQueryService taskQuery;
    private final ManagerService managerService;
    private final VersionPhaseService versionPhaseService;
    private final DeliveryNoteService deliveryNoteService;
    private final DemandService demandService;
    private final ActivityService activityService;
    private final WorkspaceMetaCache metaCache;
    private final UserMapper userMapper;

    public AiAssistantInsightService(RequirementService requirementService, ProjectAccessService projectAccess,
                                     TaskQueryService taskQuery, ManagerService managerService,
                                     VersionPhaseService versionPhaseService, DeliveryNoteService deliveryNoteService,
                                     DemandService demandService, ActivityService activityService,
                                     WorkspaceMetaCache metaCache, UserMapper userMapper) {
        this.requirementService = requirementService;
        this.projectAccess = projectAccess;
        this.taskQuery = taskQuery;
        this.managerService = managerService;
        this.versionPhaseService = versionPhaseService;
        this.deliveryNoteService = deliveryNoteService;
        this.demandService = demandService;
        this.activityService = activityService;
        this.metaCache = metaCache;
        this.userMapper = userMapper;
    }

    public boolean supports(String tool) {
        return tool != null && TOOLS.contains(tool);
    }

    public static Set<String> tools() {
        return TOOLS;
    }

    // ==================== 确定性路由 ====================

    /**
     * 只处理「明显在问数据」的短句；其他一律交给模型或 FAQ。
     * 宁可漏判多走一次模型，也不要把「怎么创建任务」误答成数据清单。
     */
    public String detect(String question, AiAssistantContext ctx) {
        String s = question == null ? "" : question.replaceAll("\\s+", "");
        if (s.isEmpty() || s.length() > 60) {
            return null;
        }
        if (s.matches(".*(怎么|如何|怎样|在哪|为什么|设置|配置|入口|手册|教程).*")) {
            return null;
        }
        if (s.matches(".*(帮我|给我|替我|把|将).{0,8}(创建|新建|建|加|提|移|挪|改|排期|通过|拒绝|驳回|取消|恢复|拆).*")) {
            return null;
        }
        if (s.matches(".*(能发|可以发|发布就绪|还缺什么|缺什么证据|证据缺口|发布体检).*")) {
            return "release_readiness";
        }
        if (s.matches(".*(谁最忙|谁比较忙|负载|工作量|忙不忙|超载).*")) {
            return "team_load";
        }
        if (s.matches(".*(哪些|什么|多少|几条|几个|有没有).{0,10}需求.{0,10}(没排期|未排期|没工作项|没有工作项|没用例|没有用例|缺口|漏了).*")
                || s.matches(".*需求缺口.*")) {
            return "demand_gaps";
        }
        if (s.matches(".*(最近|本周|这几天).{0,6}(变更|改了什么|调整|调期|动了什么).*")
                || s.matches(".*(变更记录|变更台账|活动记录).*")) {
            return "change_log";
        }
        if (ctx != null && Texts.trimToNull(ctx.getDemandId()) != null
                && s.matches(".*(这个需求|该需求|这条需求|需求).{0,8}(到哪|进度|状态|情况|任务|用例|测试|追踪).*")) {
            return "demand_trace";
        }
        if (s.matches(".*(需求).{0,12}(到哪了|到哪|进度如何|什么进度|追踪|拆了哪些|关联了哪些).*")) {
            return "demand_trace";
        }
        if (s.matches(".*(版本).{0,10}(进度|到哪|情况|怎么样|健康|什么时候发|目标日期).*")
                || (ctx != null && Texts.trimToNull(ctx.getVersionId()) != null && s.matches(".*(进度|到哪|什么时候发|情况).*"))) {
            return "version_progress";
        }
        if (s.matches(".*(项目|这个项目|项目里).{0,10}(健康|健康度|情况|怎么样|风险|进展|进度|状态).*")
                || s.matches(".*(哪个项目|哪些项目).{0,8}(风险|健康|问题|延期).*")) {
            return "project_health";
        }
        if (s.matches(".*(我的工作|我手头|我手上|我负责|我这周|我本周|我的任务概况).*")) {
            return "my_work";
        }
        return null;
    }

    // ==================== 执行 ====================

    public AiAssistantResponse run(String tool, String userId, String workspaceId, AiAssistantContext ctx,
                                   String question, Map<String, String> args) {
        if (!supports(tool)) {
            return null;
        }
        Map<String, String> a = args == null ? new HashMap<String, String>() : args;
        try {
            List<Project> projects = loadProjects(workspaceId, userId);
            String projectId = resolveProject(a.get("project"), ctx, projects, question);
            if ("my_work".equals(tool)) {
                return myWork(userId, workspaceId, projects);
            }
            if ("project_health".equals(tool)) {
                return projectHealth(userId, workspaceId, projects, projectId);
            }
            if ("version_progress".equals(tool)) {
                return versionProgress(userId, workspaceId, projects, projectId, a.get("version"), ctx, question);
            }
            if ("demand_trace".equals(tool)) {
                return demandTrace(userId, workspaceId, projects, projectId, a.get("demand"), ctx, question);
            }
            if ("release_readiness".equals(tool)) {
                return releaseReadiness(userId, workspaceId, projects, projectId, a.get("version"), ctx, question);
            }
            if ("team_load".equals(tool)) {
                return teamLoad(userId, workspaceId, projects, projectId);
            }
            if ("demand_gaps".equals(tool)) {
                return demandGaps(userId, workspaceId, projectId, projects);
            }
            if ("change_log".equals(tool)) {
                return changeLog(userId, workspaceId, projectId, projects);
            }
        } catch (RuntimeException e) {
            /* 越权/不存在不向外抛：助手只给可读提示，不暴露目标是否存在 */
            AiAssistantResponse res = base(tool);
            res.setAnswer("这次没有取到数据。可以打开对应页面查看，或换个更具体的问法。");
            res.getLinks().add(link("#/projects", "项目"));
            return res;
        }
        return null;
    }

    // ==================== 我的工作 ====================

    private AiAssistantResponse myWork(String userId, String workspaceId, List<Project> projects) {
        AiAssistantResponse res = base("my_work");
        res.setContextLabel("我的工作");
        AppUser me = userMapper.selectById(userId);
        String name = me == null ? null : Texts.trimToNull(me.getDisplayName());
        if (name == null) {
            res.setAnswer("当前账号没有显示名，无法按负责人汇总工作项。可以在个人设置里补充显示名后再试。");
            res.getLinks().add(link("#/profile", "个人设置"));
            return res;
        }
        BoardQuery bq = new BoardQuery();
        bq.getOwners().add(name);
        TaskListResponse page = taskQuery.list(workspaceId, userId, bq, "due", 0, 200, false);
        Set<String> ended = endedColumns(workspaceId);
        Map<String, Boolean> visible = new HashMap<String, Boolean>();
        List<Task> open = new ArrayList<Task>();
        for (Task t : page.getItems()) {
            if (t.getOwnerUserId() != null && !userId.equals(t.getOwnerUserId())) {
                continue;
            }
            if (!workspaceId.equals(t.getWorkspaceId()) || ended.contains(t.getBoardColumn())) {
                continue;
            }
            String reqId = t.getReqId();
            if (reqId != null) {
                Boolean ok = visible.get(reqId);
                if (ok == null) {
                    ok = projectAccess.canView(workspaceId, userId, reqId);
                    visible.put(reqId, ok);
                }
                if (!ok) {
                    continue;
                }
            }
            open.add(t);
        }
        LocalDate today = LocalDate.now();
        int overdue = 0, dueToday = 0, soon = 0, blocked = 0;
        for (Task t : open) {
            LocalDate due = t.getDueDate();
            if (due != null) {
                if (due.isBefore(today)) {
                    overdue++;
                } else if (due.isEqual(today)) {
                    dueToday++;
                } else if (!due.isAfter(today.plusDays(3))) {
                    soon++;
                }
            }
            if (Boolean.TRUE.equals(t.getBlocked())) {
                blocked++;
            }
        }
        res.getFacts().add(fact("未完成", open.size() + " 项", "normal", "#/mine"));
        res.getFacts().add(fact("已逾期", overdue + " 项", overdue > 0 ? "danger" : "good", "#/risks"));
        res.getFacts().add(fact("今天到期", dueToday + " 项", dueToday > 0 ? "warn" : "normal", "#/mine"));
        res.getFacts().add(fact("3 天内到期", soon + " 项", soon > 0 ? "warn" : "normal", "#/mine"));
        res.getFacts().add(fact("被阻塞", blocked + " 项", blocked > 0 ? "danger" : "good", "#/risks"));

        List<Task> sorted = new ArrayList<Task>(open);
        sorted.sort(new Comparator<Task>() {
            @Override
            public int compare(Task a, Task b) {
                int ba = Boolean.TRUE.equals(a.getBlocked()) ? 0 : 1;
                int bb = Boolean.TRUE.equals(b.getBlocked()) ? 0 : 1;
                if (ba != bb) {
                    return ba - bb;
                }
                if (a.getDueDate() == null && b.getDueDate() == null) {
                    return 0;
                }
                if (a.getDueDate() == null) {
                    return 1;
                }
                if (b.getDueDate() == null) {
                    return -1;
                }
                return a.getDueDate().compareTo(b.getDueDate());
            }
        });
        res.setTotal(sorted.size());
        res.setHasMore(sorted.size() > SHOW_TASKS);
        for (Task t : sorted.subList(0, Math.min(SHOW_TASKS, sorted.size()))) {
            res.getTasks().add(item(t, projectName(t, projects), columnName(workspaceId, t.getBoardColumn())));
        }
        if (open.isEmpty()) {
            res.setAnswer("你当前没有未完成的工作项。");
        } else {
            res.setAnswer("你当前有 " + open.size() + " 个未完成工作项：逾期 " + overdue
                    + " 个、今天到期 " + dueToday + " 个、3 天内到期 " + soon + " 个、阻塞 " + blocked
                    + " 个。下面列出最需要先看的 " + res.getTasks().size() + " 项。");
        }
        res.getLinks().add(link("#/mine", "我的工作"));
        if (overdue > 0 || blocked > 0) {
            res.getLinks().add(link("#/risks", "逾期与阻塞"));
        }
        return res;
    }

    // ==================== 项目健康 ====================

    @SuppressWarnings("unchecked")
    private AiAssistantResponse projectHealth(String userId, String workspaceId, List<Project> projects, String projectId) {
        AiAssistantResponse res = base("project_health");
        Map<String, Object> data = managerService.portfolio(workspaceId, userId);
        List<Map<String, Object>> cards = (List<Map<String, Object>>) data.get("projects");
        List<Map<String, Object>> tasks = (List<Map<String, Object>>) data.get("tasks");
        if (projectId == null) {
            List<Map<String, Object>> sorted = new ArrayList<Map<String, Object>>();
            if (cards != null) {
                sorted.addAll(cards);
            }
            sorted.sort(new Comparator<Map<String, Object>>() {
                @Override
                public int compare(Map<String, Object> a, Map<String, Object> b) {
                    int ha = healthRank(str(a.get("health")));
                    int hb = healthRank(str(b.get("health")));
                    if (ha != hb) {
                        return ha - hb;
                    }
                    return intOf(b.get("overdue")) - intOf(a.get("overdue"));
                }
            });
            int red = 0, orange = 0;
            for (Map<String, Object> card : sorted) {
                String health = str(card.get("health"));
                if ("red".equals(health)) {
                    red++;
                } else if ("orange".equals(health)) {
                    orange++;
                }
            }
            res.setContextLabel("全部项目");
            res.getFacts().add(fact("可见项目", sorted.size() + " 个", "normal", "#/projects"));
            res.getFacts().add(fact("风险高", red + " 个", red > 0 ? "danger" : "good", "#/projects"));
            res.getFacts().add(fact("需关注", orange + " 个", orange > 0 ? "warn" : "normal", "#/projects"));
            for (Map<String, Object> card : sorted.subList(0, Math.min(5, sorted.size()))) {
                String name = str(card.get("name"));
                String health = str(card.get("health"));
                String value = HEALTH.containsKey(health) ? HEALTH.get(health) : health
                        + " · 逾期 " + intOf(card.get("overdue")) + " / 阻塞 " + intOf(card.get("blocked"))
                        + " · 完成率 " + intOf(card.get("progressPct")) + "%";
                res.getFacts().add(fact(name, value, toneOfHealth(health), "#/projects"));
            }
            if (sorted.isEmpty()) {
                res.setAnswer("当前空间没有你能看到的项目。");
            } else {
                res.setAnswer("当前可见 " + sorted.size() + " 个项目：风险高 " + red + " 个、需关注 " + orange
                        + " 个。下面按风险排序列出最需要看的 " + Math.min(5, sorted.size()) + " 个。");
            }
            res.getLinks().add(link("#/projects", "项目"));
            res.getLinks().add(link("#/risks", "逾期与阻塞"));
            return res;
        }
        Map<String, Object> card = findCard(cards, projectId);
        if (card == null) {
            res.setAnswer("没有找到这个项目，或你对它没有查看权限。");
            res.getLinks().add(link("#/projects", "项目"));
            return res;
        }
        String name = str(card.get("name"));
        res.setContextLabel(name);
        String health = str(card.get("health"));
        int total = intOf(card.get("total"));
        int done = intOf(card.get("done"));
        int pct = intOf(card.get("progressPct"));
        res.getFacts().add(fact("健康度", HEALTH.containsKey(health) ? HEALTH.get(health) : health, toneOfHealth(health), null));
        res.getFacts().add(fact("工作项", total + " 项", "normal", null));
        res.getFacts().add(fact("完成率", pct + "%", pct >= 80 ? "good" : pct >= 50 ? "normal" : "warn", null));
        res.getFacts().add(fact("已逾期", intOf(card.get("overdue")) + " 项", intOf(card.get("overdue")) > 0 ? "danger" : "good", null));
        res.getFacts().add(fact("被阻塞", intOf(card.get("blocked")) + " 项", intOf(card.get("blocked")) > 0 ? "danger" : "good", null));
        res.getFacts().add(fact("进行中", intOf(card.get("doing")) + " 项", "normal", null));
        res.getFacts().add(fact("待处理", intOf(card.get("backlog")) + " 项", "normal", null));
        int stagnant = intOf(card.get("stagnantDays"));
        if (stagnant >= 3) {
            res.getFacts().add(fact("停滞", stagnant + " 天无完成", "warn", null));
        }
        int overloaded = intOf(card.get("overloadedMembers"));
        if (overloaded > 0) {
            res.getFacts().add(fact("超载成员", overloaded + " 人", "warn", "#/workload"));
        }

        List<Map<String, Object>> risks = new ArrayList<Map<String, Object>>();
        if (tasks != null) {
            for (Map<String, Object> t : tasks) {
                if (!projectId.equals(str(t.get("reqId")))) {
                    continue;
                }
                if (CANCELED.equals(str(t.get("boardColumn"))) || DONE.equals(str(t.get("boardColumn")))) {
                    continue;
                }
                boolean blocked = Boolean.TRUE.equals(t.get("blocked"));
                boolean overdue = overdue(t.get("dueDate"));
                if (blocked || overdue) {
                    risks.add(t);
                }
            }
        }
        risks.sort(new Comparator<Map<String, Object>>() {
            @Override
            public int compare(Map<String, Object> a, Map<String, Object> b) {
                int ba = Boolean.TRUE.equals(a.get("blocked")) ? 0 : 1;
                int bb = Boolean.TRUE.equals(b.get("blocked")) ? 0 : 1;
                if (ba != bb) {
                    return ba - bb;
                }
                String da = str(a.get("dueDate"));
                String db = str(b.get("dueDate"));
                if (da.isEmpty() && db.isEmpty()) {
                    return 0;
                }
                if (da.isEmpty()) {
                    return 1;
                }
                if (db.isEmpty()) {
                    return -1;
                }
                return da.compareTo(db);
            }
        });
        for (Map<String, Object> t : risks.subList(0, Math.min(6, risks.size()))) {
            AiAssistantTaskItem row = new AiAssistantTaskItem();
            row.setId(str(t.get("id")));
            row.setTitle(cut(str(t.get("title")), 60));
            row.setProjectName(name);
            row.setColumnName(columnName(workspaceId, str(t.get("boardColumn"))));
            row.setDueDate(str(t.get("dueDate")));
            row.setBlocked(Boolean.TRUE.equals(t.get("blocked")));
            row.setHref("#/board?task=" + str(t.get("id")));
            res.getTasks().add(row);
        }
        res.setTotal(risks.size());
        res.setHasMore(risks.size() > 6);
        StringBuilder answer = new StringBuilder();
        answer.append("项目「").append(name).append("」当前健康度：")
                .append(HEALTH.containsKey(health) ? HEALTH.get(health) : health).append("。共 ").append(total)
                .append(" 个工作项，完成 ").append(done).append(" 个（").append(pct).append("%），逾期 ")
                .append(intOf(card.get("overdue"))).append(" 个，阻塞 ").append(intOf(card.get("blocked"))).append(" 个");
        if (stagnant >= 3) {
            answer.append("，已连续 ").append(stagnant).append(" 天没有完成记录");
        }
        answer.append("。");
        if (!risks.isEmpty()) {
            answer.append("下面列出 ").append(res.getTasks().size()).append(" 个需要先处理的逾期或阻塞项。");
        }
        res.setAnswer(answer.toString());
        res.getLinks().add(link("#/project", "项目驾驶舱"));
        res.getLinks().add(link("#/risks", "逾期与阻塞"));
        return res;
    }

    // ==================== 版本进度 ====================

    private AiAssistantResponse versionProgress(String userId, String workspaceId, List<Project> projects,
                                                String projectId, String requestedVersion,
                                                AiAssistantContext ctx, String question) {
        AiAssistantResponse res = base("version_progress");
        if (projectId == null) {
            VersionOverviewResponse overview = versionPhaseService.overview(workspaceId, userId);
            VersionOverviewResponse.Totals totals = overview.getTotals();
            res.setContextLabel("全部项目");
            res.getFacts().add(fact("版本总数", nz(totals.getVersionCount()) + " 个", "normal", "#/phase"));
            res.getFacts().add(fact("进行中", nz(totals.getActiveCount()) + " 个", nz(totals.getActiveCount()) > 0 ? "warn" : "normal", "#/phase"));
            res.getFacts().add(fact("计划中", nz(totals.getPlannedCount()) + " 个", "normal", "#/phase"));
            res.getFacts().add(fact("已发布", nz(totals.getReleasedCount()) + " 个", "good", "#/phase"));
            for (VersionOverviewResponse.ProjectOverview p : overview.getProjects()) {
                if (res.getFacts().size() >= SHOW_FACTS) {
                    break;
                }
                String value = "最新版本 " + nz(p.getLatestVersionName())
                        + " · " + (VERSION_STATUS.containsKey(p.getLatestVersionStatus())
                        ? VERSION_STATUS.get(p.getLatestVersionStatus()) : nz(p.getLatestVersionStatus()));
                res.getFacts().add(fact(p.getReqName(), value, "normal", "#/phase"));
            }
            res.setAnswer("当前可见范围共有 " + nz(totals.getVersionCount()) + " 个版本：进行中 "
                    + nz(totals.getActiveCount()) + " 个、计划中 " + nz(totals.getPlannedCount())
                    + " 个、已发布 " + nz(totals.getReleasedCount()) + " 个。需要看具体项目的版本范围时，打开项目或告诉我项目名。");
            res.getLinks().add(link("#/phase", "版本与发布"));
            return res;
        }
        VersionStatsResponse stats = versionPhaseService.versionStats(workspaceId, projectId, userId);
        String projectName = projectName(projectId, projects);
        res.setContextLabel(projectName);
        List<VersionStatsResponse.VersionStat> versions = stats.getVersions();
        VersionStatsResponse.VersionStat selected = pickVersion(versions, requestedVersion, ctx, question);
        if (selected == null) {
            List<VersionStatsResponse.VersionStat> open = new ArrayList<VersionStatsResponse.VersionStat>();
            for (VersionStatsResponse.VersionStat v : versions) {
                if (!"closed".equals(v.getStatus()) && !"canceled".equals(v.getStatus())) {
                    open.add(v);
                }
            }
            res.setFacts(new ArrayList<AiAssistantFact>());
            if (open.isEmpty()) {
                res.setAnswer("项目「" + projectName + "」还没有进行中或计划中的版本。");
            } else {
                int active = 0;
                int planned = 0;
                for (VersionStatsResponse.VersionStat v : open) {
                    if ("active".equals(v.getStatus())) {
                        active++;
                    } else if ("planned".equals(v.getStatus())) {
                        planned++;
                    }
                }
                res.getFacts().add(fact("进行中", active + " 个", active > 0 ? "warn" : "normal", null));
                res.getFacts().add(fact("计划中", planned + " 个", "normal", null));
                for (VersionStatsResponse.VersionStat v : open.subList(0, Math.min(5, open.size()))) {
                    res.getFacts().add(fact(v.getName(), versionSummary(v), toneOfVersion(v.getStatus()),
                            versionHref(v.getId(), projectId)));
                }
                res.setAnswer("项目「" + projectName + "」有 " + open.size() + " 个未结束版本（进行中 " + active
                        + " 个、计划中 " + planned + " 个）。下面按目标日期列出前 " + Math.min(5, open.size())
                        + " 个；要只看某个版本，告诉我版本名。");
            }
            res.getLinks().add(link("#/phase", "版本与发布"));
            return res;
        }
        int taskCount = nz(selected.getTaskCount());
        int done = nz(selected.getDoneCount());
        int doing = nz(selected.getDoingCount());
        int remaining = Math.max(0, taskCount - done);
        int pct = taskCount > 0 ? (int) Math.round(done * 100.0 / taskCount) : 0;
        res.getFacts().add(fact("版本状态", VERSION_STATUS.containsKey(selected.getStatus())
                ? VERSION_STATUS.get(selected.getStatus()) : nz(selected.getStatus()), toneOfVersion(selected.getStatus()), null));
        if (selected.getTargetDate() != null) {
            res.getFacts().add(fact("目标日期", selected.getTargetDate().toString(), "normal", null));
        }
        res.getFacts().add(fact("完成进度", done + " / " + taskCount + "（" + pct + "%）", pct >= 80 ? "good" : "normal", null));
        res.getFacts().add(fact("未完成", remaining + " 项", remaining > 0 ? "warn" : "good", null));
        res.getFacts().add(fact("进行中", doing + " 项", "normal", null));
        res.getFacts().add(fact("关联需求", nz(selected.getDemandCount()) + " 条", "normal", null));
        res.getFacts().add(fact("已排期需求", nz(selected.getScheduledDemandCount()) + " 条", "normal", null));
        if (selected.getBranches() != null && !selected.getBranches().isEmpty()) {
            int dev = 0, testing = 0, merging = 0, released = 0;
            for (VersionStatsResponse.BranchStat b : selected.getBranches()) {
                if ("dev".equals(b.getStatus())) {
                    dev++;
                } else if ("testing".equals(b.getStatus())) {
                    testing++;
                } else if ("merging".equals(b.getStatus())) {
                    merging++;
                } else if ("released".equals(b.getStatus())) {
                    released++;
                }
            }
            res.getFacts().add(fact("分支", "开发 " + dev + " / 测试 " + testing + " / 合并 " + merging + " / 已发布 " + released,
                    "normal", "#/branches"));
        }
        if (selected.getOnTimePct() != null) {
            res.getFacts().add(fact("准时完成率", selected.getOnTimePct() + "%",
                    selected.getOnTimePct() >= 80 ? "good" : "warn", null));
        }
        if (selected.getDeviationPct() != null) {
            res.getFacts().add(fact("工时偏差", selected.getDeviationPct() + "%",
                    Math.abs(selected.getDeviationPct()) > 30 ? "warn" : "normal", null));
        }
        String target = selected.getTargetDate() == null ? "未设目标日期" : ("目标 " + selected.getTargetDate());
        res.setAnswer("版本「" + selected.getName() + "」" + (VERSION_STATUS.containsKey(selected.getStatus())
                ? VERSION_STATUS.get(selected.getStatus()) : nz(selected.getStatus())) + "，" + target + "；"
                + "共 " + taskCount + " 个工作项，已完成 " + done + " 个（" + pct + "%），进行中 " + doing
                + " 个，未完成 " + remaining + " 个；关联需求 " + nz(selected.getDemandCount()) + " 条。");
        res.getLinks().add(link(versionHref(selected.getId(), projectId), "版本详情"));
        res.getLinks().add(link("#/delivery?versionId=" + selected.getId(), "交付说明"));
        return res;
    }

    // ==================== 需求追踪 ====================

    private AiAssistantResponse demandTrace(String userId, String workspaceId, List<Project> projects,
                                            String projectId, String requested,
                                            AiAssistantContext ctx, String question) {
        AiAssistantResponse res = base("demand_trace");
        DemandMatch match = matchDemand(userId, workspaceId, projectId, requested, ctx, question);
        if (match.candidates != null && !match.candidates.isEmpty()) {
            res.setAnswer("找到 " + match.candidates.size() + " 条匹配需求，请点开一条，或告诉我更完整的标题。");
            for (Demand d : match.candidates.subList(0, Math.min(5, match.candidates.size()))) {
                res.getFacts().add(fact(d.getTitle(), (WORK_STATUS.containsKey(d.getStatus())
                        ? WORK_STATUS.get(d.getStatus()) : nz(d.getStatus())) + " · " + projectName(d.getReqId(), projects),
                        "normal", "#/demands?demand=" + d.getId()));
            }
            res.getLinks().add(link("#/demands", "需求池"));
            return res;
        }
        Demand d = match.demand;
        if (d == null) {
            res.setAnswer("没有找到对应的需求。可以在需求池打开需求后再问「这个需求到哪了」，或直接告诉我需求标题。");
            res.getLinks().add(link("#/demands", "需求池"));
            return res;
        }
        res.setContextLabel(d.getTitle());
        int taskCount = nz(d.getTaskCount());
        int taskDone = nz(d.getTaskDone());
        int caseCount = nz(d.getCaseCount());
        int casePassed = nz(d.getCasePassed());
        res.getFacts().add(fact("状态", WORK_STATUS.containsKey(d.getStatus()) ? WORK_STATUS.get(d.getStatus()) : nz(d.getStatus()),
                "plan".equals(d.getStatus()) || "done".equals(d.getStatus()) ? "good" : "normal", null));
        res.getFacts().add(fact("优先级", nz(d.getPriority()), "P0".equals(d.getPriority()) ? "danger" : "normal", null));
        if (d.getVersionName() != null) {
            res.getFacts().add(fact("目标版本", d.getVersionName(), "normal",
                    d.getVersionId() == null ? null : versionHref(d.getVersionId(), d.getReqId())));
        } else {
            res.getFacts().add(fact("目标版本", "未排期", "warn", null));
        }
        res.getFacts().add(fact("工作项", taskDone + " / " + taskCount + " 完成",
                taskCount == 0 ? "warn" : taskDone >= taskCount ? "good" : "normal", null));
        res.getFacts().add(fact("测试用例", caseCount == 0 ? "未关联" : (casePassed + " / " + caseCount + " 通过"),
                caseCount == 0 ? "warn" : "normal", "#/testcases"));
        if (d.getExpectDate() != null) {
            res.getFacts().add(fact("期望交付", d.getExpectDate().toString(),
                    d.getExpectDate().isBefore(LocalDate.now()) && !"done".equals(d.getStatus()) ? "warn" : "normal", null));
        }
        if (d.getDeliveryStage() != null) {
            res.getFacts().add(fact("交付阶段", deliveryStage(d.getDeliveryStage()), "normal", null));
        }
        PageResult<Task> page = demandService.tasks(workspaceId, userId, d.getId(), 0, 30);
        if (page != null && page.getItems() != null) {
            List<Task> tasks = new ArrayList<Task>(page.getItems());
            tasks.sort(new Comparator<Task>() {
                @Override
                public int compare(Task a, Task b) {
                    int da = DONE.equals(a.getBoardColumn()) ? 1 : 0;
                    int db = DONE.equals(b.getBoardColumn()) ? 1 : 0;
                    if (da != db) {
                        return da - db;
                    }
                    return String.valueOf(a.getDueDate()).compareTo(String.valueOf(b.getDueDate()));
                }
            });
            for (Task t : tasks.subList(0, Math.min(SHOW_TASKS, tasks.size()))) {
                res.getTasks().add(item(t, projectName(d.getReqId(), projects), columnName(workspaceId, t.getBoardColumn())));
            }
            res.setTotal(tasks.size());
            res.setHasMore(tasks.size() > SHOW_TASKS);
        }
        StringBuilder answer = new StringBuilder();
        answer.append("需求「").append(d.getTitle()).append("」当前是")
                .append(WORK_STATUS.containsKey(d.getStatus()) ? WORK_STATUS.get(d.getStatus()) : nz(d.getStatus())).append("；");
        if (d.getVersionName() == null) {
            answer.append("尚未排期；");
        } else {
            answer.append("目标版本 ").append(d.getVersionName()).append("；");
        }
        answer.append("关联 ").append(taskCount).append(" 个工作项（完成 ").append(taskDone).append(" 个），");
        answer.append(caseCount == 0 ? "还没有关联测试用例。" : ("测试用例 " + caseCount + " 条，已通过 " + casePassed + " 条。"));
        res.setAnswer(answer.toString());
        res.getLinks().add(link("#/demands?demand=" + d.getId(), "打开需求"));
        if (d.getVersionId() != null) {
            res.getLinks().add(link(versionHref(d.getVersionId(), d.getReqId()), "目标版本"));
        }
        return res;
    }

    private static class DemandMatch {
        Demand demand;
        List<Demand> candidates;
    }

    private DemandMatch matchDemand(String userId, String workspaceId, String projectId, String requested,
                                    AiAssistantContext ctx, String question) {
        DemandMatch match = new DemandMatch();
        String id = Texts.trimToNull(requested);
        String title = null;
        if (id != null && (id.equals(Texts.trimToNull(ctx == null ? null : ctx.getDemandId()))
                || id.matches("[A-Za-z0-9_-]{6,}"))) {
            Demand d = demandService.getVisible(workspaceId, userId, id);
            if (projectId == null || projectId.equals(d.getReqId())) {
                match.demand = d;
                return match;
            }
        } else {
            title = id;
        }
        String ctxId = Texts.trimToNull(ctx == null ? null : ctx.getDemandId());
        if (match.demand == null && ctxId != null) {
            try {
                Demand d = demandService.getVisible(workspaceId, userId, ctxId);
                if (projectId == null || projectId.equals(d.getReqId())) {
                    match.demand = d;
                    return match;
                }
            } catch (RuntimeException ignored) {
                /* 上下文里的需求不可见：当作没有，不回显、不报错 */
            }
        }
        if (title == null && question != null) {
            Matcher m = QUOTED.matcher(question);
            if (m.find()) {
                title = m.group(1);
            }
        }
        if (title == null) {
            return match;
        }
        DemandQuery q = new DemandQuery();
        q.setWorkspaceId(workspaceId);
        q.setViewerId(userId);
        q.setQ(title);
        q.setLimit(10);
        if (projectId != null) {
            q.setReqId(projectId);
        }
        DemandPage page = demandService.page(workspaceId, userId, q);
        List<Demand> items = page == null ? null : page.getItems();
        if (items == null || items.isEmpty()) {
            return match;
        }
        Demand exact = null;
        for (Demand d : items) {
            if (d.getTitle() != null && d.getTitle().equals(title)) {
                exact = d;
                break;
            }
        }
        if (exact != null) {
            match.demand = exact;
        } else if (items.size() == 1) {
            match.demand = items.get(0);
        } else {
            match.candidates = items;
        }
        return match;
    }

    // ==================== 发布就绪 ====================

    private AiAssistantResponse releaseReadiness(String userId, String workspaceId, List<Project> projects,
                                                 String projectId, String requestedVersion,
                                                 AiAssistantContext ctx, String question) {
        AiAssistantResponse res = base("release_readiness");
        if (projectId == null) {
            res.setAnswer("要检查发布就绪，需要先指定项目。可以在项目或版本页面再问一次，或告诉我项目名。");
            res.getLinks().add(link("#/phase", "版本与发布"));
            return res;
        }
        VersionStatsResponse stats = versionPhaseService.versionStats(workspaceId, projectId, userId);
        VersionStatsResponse.VersionStat version = pickVersion(stats.getVersions(), requestedVersion, ctx, question);
        if (version == null) {
            for (VersionStatsResponse.VersionStat v : stats.getVersions()) {
                if ("active".equals(v.getStatus()) || "planned".equals(v.getStatus())) {
                    version = v;
                    break;
                }
            }
        }
        if (version == null) {
            res.setAnswer("项目「" + projectName(projectId, projects) + "」还没有进行中或计划中的版本，无法检查发布就绪。");
            res.getLinks().add(link("#/phase", "版本与发布"));
            return res;
        }
        DeliveryNoteResponse note = deliveryNoteService.aggregate(workspaceId, userId, version.getId(), null);
        res.setContextLabel(version.getName());
        DeliveryNoteResponse.Counts counts = note.getCounts();
        DeliveryNoteResponse.Quality quality = note.getQuality();
        DeliveryNoteResponse.Defects defects = note.getDefects();
        int missing = note.getMissing() == null ? 0 : note.getMissing().size();
        int evidence = note.getEvidence() == null ? 0 : note.getEvidence().size();
        res.getFacts().add(fact("版本状态", VERSION_STATUS.containsKey(note.getVersionStatus())
                ? VERSION_STATUS.get(note.getVersionStatus()) : nz(note.getVersionStatus()), toneOfVersion(note.getVersionStatus()), null));
        if (note.getTargetDate() != null) {
            res.getFacts().add(fact("目标日期", note.getTargetDate().toString(), "normal", null));
        }
        if (counts != null) {
            res.getFacts().add(fact("范围工作项", nz(counts.getPlanned()) + " 项", "normal", null));
            res.getFacts().add(fact("已发布", nz(counts.getReleased()) + " 项",
                    nz(counts.getReleased()) > 0 ? "good" : "normal", null));
            res.getFacts().add(fact("已延期", nz(counts.getDeferred()) + " 项",
                    nz(counts.getDeferred()) > 0 ? "warn" : "normal", null));
        }
        if (quality != null) {
            if (quality.getPassRatePct() != null) {
                res.getFacts().add(fact("用例通过率", Math.round(quality.getPassRatePct()) + "%",
                        quality.getPassRatePct() >= 90 ? "good" : "warn", null));
            }
            if (Boolean.TRUE.equals(quality.getMissing())) {
                res.getFacts().add(fact("测试证据", "缺失", "warn", "#/testcases"));
            }
        }
        if (defects != null) {
            res.getFacts().add(fact("未关闭缺陷", nz(defects.getOpenCount()) + " 个",
                    nz(defects.getOpenCount()) > 0 ? "warn" : "good", null));
            if (nz(defects.getBlockerOpenCount()) > 0) {
                res.getFacts().add(fact("阻断缺陷", defects.getBlockerOpenCount() + " 个", "danger", null));
            }
        }
        res.getFacts().add(fact("发布证据", evidence + " 条", evidence > 0 ? "good" : "warn", null));
        res.getFacts().add(fact("缺口", missing + " 项", missing > 0 ? "warn" : "good", null));

        StringBuilder answer = new StringBuilder();
        answer.append("版本「").append(note.getVersionName()).append("」发布就绪检查：");
        if (missing == 0) {
            answer.append("交付说明没有记录到明显缺口，仍建议在发布前人工核对范围与回滚方案。");
        } else {
            answer.append("有 ").append(missing).append(" 项缺口。");
            int n = 0;
            for (String m : note.getMissing()) {
                if (n++ >= 5) {
                    break;
                }
                answer.append(n == 1 ? "主要包括：" : "；").append(cut(m, 60));
            }
            answer.append("。");
        }
        if (note.getRisks() != null && !note.getRisks().isEmpty()) {
            answer.append("另列出 ").append(Math.min(3, note.getRisks().size())).append(" 条风险。");
        }
        res.setAnswer(answer.toString());
        for (int i = 0; i < Math.min(3, note.getRisks() == null ? 0 : note.getRisks().size()); i++) {
            DeliveryNoteResponse.RiskRow risk = note.getRisks().get(i);
            res.getFacts().add(fact(cut(risk.getTitle(), 30), cut(risk.getImpact(), 60),
                    "danger".equals(risk.getTone()) ? "danger" : "warn", null));
        }
        res.getLinks().add(link(versionHref(note.getVersionId(), note.getProjectId()), "版本详情"));
        res.getLinks().add(link("#/delivery?versionId=" + note.getVersionId(), "交付说明"));
        res.getLinks().add(link("#/release?id=" + note.getVersionId()
                + (note.getProjectId() == null ? "" : "&reqId=" + note.getProjectId()), "发布工作台"));
        return res;
    }

    // ==================== 成员负载 ====================

    @SuppressWarnings("unchecked")
    private AiAssistantResponse teamLoad(String userId, String workspaceId, List<Project> projects, String projectId) {
        AiAssistantResponse res = base("team_load");
        Map<String, Object> data = projectId == null
                ? managerService.workload(workspaceId, userId)
                : managerService.workload(workspaceId, userId, projectId, null, null);
        List<Map<String, Object>> members = (List<Map<String, Object>>) data.get("members");
        if (members == null) {
            members = new ArrayList<Map<String, Object>>();
        }
        List<Map<String, Object>> rows = new ArrayList<Map<String, Object>>();
        for (Map<String, Object> m : members) {
            String name = str(m.get("name"));
            if (name == null || name.isEmpty()) {
                continue;
            }
            rows.add(m);
        }
        rows.sort(new Comparator<Map<String, Object>>() {
            @Override
            public int compare(Map<String, Object> a, Map<String, Object> b) {
                return intOf(b.get("loadPct")) - intOf(a.get("loadPct"));
            }
        });
        int overloaded = 0;
        int weekMinutes = 0;
        for (Map<String, Object> m : rows) {
            if (Boolean.TRUE.equals(m.get("overloaded"))) {
                overloaded++;
            }
            weekMinutes += intOf(m.get("weekMinutes"));
        }
        String scope = projectId == null ? "当前空间" : ("项目「" + projectName(projectId, projects) + "」");
        res.setContextLabel(scope);
        res.getFacts().add(fact("成员", rows.size() + " 人", "normal", "#/workload"));
        res.getFacts().add(fact("超载", overloaded + " 人", overloaded > 0 ? "warn" : "good", "#/workload"));
        res.getFacts().add(fact("本周已计", hours(weekMinutes), "normal", "#/workload"));
        for (Map<String, Object> m : rows.subList(0, Math.min(5, rows.size()))) {
            int pct = intOf(m.get("loadPct"));
            String value = "负载 " + pct + "% · 本周 " + hours(intOf(m.get("weekMinutes")))
                    + " · 剩余预估 " + hours(intOf(m.get("loadRemainingMinutes")));
            res.getFacts().add(fact(str(m.get("name")), value,
                    Boolean.TRUE.equals(m.get("overloaded")) ? "danger" : pct >= 80 ? "warn" : "normal", null));
        }
        if (rows.isEmpty()) {
            res.setAnswer(scope + "没有可统计的成员负载。");
        } else {
            Map<String, Object> top = rows.get(0);
            res.setAnswer(scope + "共 " + rows.size() + " 人，超载 " + overloaded + " 人；当前负载最高的是「"
                    + str(top.get("name")) + "」(" + intOf(top.get("loadPct")) + "%)。下面列出负载最高的 "
                    + Math.min(5, rows.size()) + " 人。");
        }
        res.getLinks().add(link("#/workload", "成员负载"));
        return res;
    }

    // ==================== 需求缺口 ====================

    private AiAssistantResponse demandGaps(String userId, String workspaceId, String projectId, List<Project> projects) {
        AiAssistantResponse res = base("demand_gaps");
        DemandQuery q = new DemandQuery();
        q.setWorkspaceId(workspaceId);
        q.setViewerId(userId);
        q.setLimit(MAX_DEMANDS);
        q.setSort("priority");
        if (projectId != null) {
            q.setReqId(projectId);
        }
        DemandPage page = demandService.page(workspaceId, userId, q);
        List<Demand> items = page == null ? null : page.getItems();
        if (items == null) {
            items = new ArrayList<Demand>();
        }
        List<Demand> gaps = new ArrayList<Demand>();
        int noVersion = 0, noTask = 0, noCase = 0, noExpect = 0;
        for (Demand d : items) {
            if ("closed".equals(d.getStatus())) {
                continue;
            }
            List<String> labels = new ArrayList<String>();
            if (d.getVersionId() == null) {
                noVersion++;
                labels.add("未排期");
            }
            if (nz(d.getTaskCount()) == 0) {
                noTask++;
                labels.add("无工作项");
            }
            if (nz(d.getCaseCount()) == 0) {
                noCase++;
                labels.add("无用例");
            }
            if (("P0".equals(d.getPriority()) || "P1".equals(d.getPriority())) && d.getExpectDate() == null) {
                noExpect++;
                labels.add("缺少期望日期");
            }
            if (!labels.isEmpty()) {
                d.setDeliveryStage(String.join("、", labels));
                gaps.add(d);
            }
        }
        String scope = projectId == null ? "当前可见范围" : ("项目「" + projectName(projectId, projects) + "」");
        res.setContextLabel(scope);
        res.getFacts().add(fact("未关闭需求", (page == null ? items.size() : page.getTotal()) + " 条", "normal", "#/demands"));
        res.getFacts().add(fact("未排期", noVersion + " 条", noVersion > 0 ? "warn" : "good", null));
        res.getFacts().add(fact("无工作项", noTask + " 条", noTask > 0 ? "danger" : "good", null));
        res.getFacts().add(fact("无测试用例", noCase + " 条", noCase > 0 ? "warn" : "good", null));
        res.getFacts().add(fact("P0/P1 缺期望日期", noExpect + " 条", noExpect > 0 ? "warn" : "good", null));
        for (Demand d : gaps.subList(0, Math.min(SHOW_FACTS, gaps.size()))) {
            res.getFacts().add(fact(cut(d.getTitle(), 30), nz(d.getPriority()) + " · " + d.getDeliveryStage(),
                    "normal", "#/demands?demand=" + d.getId()));
        }
        if (gaps.isEmpty()) {
            res.setAnswer(scope + "的未关闭需求没有发现未排期、无工作项或无用例的缺口。");
        } else {
            res.setAnswer(scope + "有 " + gaps.size() + " 条需求存在缺口：未排期 " + noVersion + " 条、无工作项 "
                    + noTask + " 条、无测试用例 " + noCase + " 条、P0/P1 缺期望日期 " + noExpect
                    + " 条。下面列出最靠前的 " + Math.min(SHOW_FACTS, gaps.size()) + " 条。");
        }
        res.getLinks().add(link("#/demands", "需求池"));
        return res;
    }

    // ==================== 最近变更 ====================

    private AiAssistantResponse changeLog(String userId, String workspaceId, String projectId, List<Project> projects) {
        AiAssistantResponse res = base("change_log");
        ActivityQuery q = new ActivityQuery();
        q.setFromDate(LocalDate.now().minusDays(7).toString());
        ActivityFeed feed = activityService.feed(workspaceId, userId, q, 0, 100);
        List<ActivityFeedItem> items = feed == null ? null : feed.getItems();
        if (items == null) {
            items = new ArrayList<ActivityFeedItem>();
        }
        List<ActivityFeedItem> rows = new ArrayList<ActivityFeedItem>();
        for (ActivityFeedItem item : items) {
            if (projectId != null && !projectId.equals(item.getProjectId())) {
                continue;
            }
            rows.add(item);
        }
        String scope = projectId == null ? "当前可见范围" : ("项目「" + projectName(projectId, projects) + "」");
        res.setContextLabel(scope);
        res.getFacts().add(fact("近 7 天变更", rows.size() + " 条", "normal", "#/analysis"));
        int demandCount = 0, taskCount = 0;
        for (ActivityFeedItem item : rows) {
            if ("demand".equals(item.getEntityType())) {
                demandCount++;
            } else if ("task".equals(item.getEntityType())) {
                taskCount++;
            }
        }
        res.getFacts().add(fact("需求变更", demandCount + " 条", demandCount > 0 ? "warn" : "normal", "#/demands"));
        res.getFacts().add(fact("工作项变更", taskCount + " 条", "normal", "#/board"));
        for (ActivityFeedItem item : rows.subList(0, Math.min(SHOW_FACTS, rows.size()))) {
            String detail = Texts.trimToNull(item.getDetail()) == null ? nz(item.getAction()) : item.getDetail();
            String value = (item.getActorName() == null ? "" : item.getActorName() + " · ")
                    + cut(detail, 50) + " · " + dateText(item.getAt());
            res.getFacts().add(fact(cut(item.getEntityTitle(), 30), value, "normal", hrefOf(item)));
        }
        if (rows.isEmpty()) {
            res.setAnswer(scope + "近 7 天没有记录到变更。");
        } else {
            res.setAnswer(scope + "近 7 天有 " + rows.size() + " 条变更，其中需求 " + demandCount + " 条、工作项 "
                    + taskCount + " 条。下面列出最近 " + Math.min(SHOW_FACTS, rows.size()) + " 条，点开可进入对应对象。");
        }
        res.getLinks().add(link("#/analysis", "运营概览"));
        res.getLinks().add(link("#/demands", "需求池"));
        return res;
    }

    // ==================== 解析与格式化 ====================

    private List<Project> loadProjects(String workspaceId, String userId) {
        List<Project> out = new ArrayList<Project>();
        for (ReqProgress p : requirementService.list(workspaceId, userId)) {
            if (p == null || p.getId() == null || p.getArchivedAt() != null) {
                continue;
            }
            if (!projectAccess.canView(workspaceId, userId, p.getId())) {
                continue;
            }
            out.add(new Project(p.getId(), Texts.cut(nz(p.getName()), 40)));
        }
        return out;
    }

    private String resolveProject(String requested, AiAssistantContext ctx, List<Project> projects, String question) {
        String value = Texts.trimToNull(requested);
        if (value != null) {
            for (Project p : projects) {
                if (p.id.equals(value) || p.name.equals(value)) {
                    return p.id;
                }
            }
        }
        if (ctx != null) {
            String ctxId = Texts.trimToNull(ctx.getProjectId());
            if (ctxId != null) {
                for (Project p : projects) {
                    if (p.id.equals(ctxId)) {
                        return p.id;
                    }
                }
            }
        }
        if (question != null) {
            String q = normalize(question);
            Project hit = null;
            for (Project p : projects) {
                String name = normalize(p.name);
                if (name.length() >= 2 && q.contains(name) && (hit == null || p.name.length() > hit.name.length())) {
                    hit = p;
                }
            }
            if (hit != null) {
                return hit.id;
            }
        }
        return projects.size() == 1 ? projects.get(0).id : null;
    }

    private VersionStatsResponse.VersionStat pickVersion(List<VersionStatsResponse.VersionStat> versions,
                                                         String requested, AiAssistantContext ctx, String question) {
        String value = Texts.trimToNull(requested);
        if (value == null && ctx != null) {
            value = Texts.trimToNull(ctx.getVersionId());
        }
        if (value == null && question != null) {
            Matcher m = QUOTED.matcher(question);
            if (m.find()) {
                value = m.group(1);
            }
        }
        if (value != null) {
            for (VersionStatsResponse.VersionStat v : versions) {
                if (value.equals(v.getId()) || value.equals(v.getName())) {
                    return v;
                }
            }
            String n = normalize(value);
            for (VersionStatsResponse.VersionStat v : versions) {
                if (v.getName() != null && normalize(v.getName()).contains(n)) {
                    return v;
                }
            }
        }
        if (ctx != null && Texts.trimToNull(ctx.getVersionId()) != null) {
            for (VersionStatsResponse.VersionStat v : versions) {
                if (ctx.getVersionId().equals(v.getId())) {
                    return v;
                }
            }
        }
        return null;
    }

    private static String versionHref(String versionId, String reqId) {
        return "#/version?id=" + versionId + (reqId == null ? "" : "&reqId=" + reqId);
    }

    private static String hrefOf(ActivityFeedItem item) {
        String id = item.getEntityId();
        if (id == null) {
            return null;
        }
        if ("task".equals(item.getEntityType())) {
            return "#/board?task=" + id;
        }
        if ("demand".equals(item.getEntityType())) {
            return "#/demands?demand=" + id;
        }
        if ("version".equals(item.getEntityType())) {
            return versionHref(id, item.getProjectId());
        }
        if ("doc".equals(item.getEntityType())) {
            return "#/requirements?doc=" + id + "&view=read";
        }
        if ("branch".equals(item.getEntityType())) {
            return "#/branches";
        }
        if ("project".equals(item.getEntityType())) {
            return "#/projects";
        }
        return null;
    }

    private AiAssistantTaskItem item(Task t, String projectName, String columnName) {
        AiAssistantTaskItem row = new AiAssistantTaskItem();
        row.setId(t.getId());
        row.setTitle(Texts.cut(nz(t.getTitle()), 60));
        row.setProjectName(projectName);
        row.setColumnName(columnName);
        row.setDueDate(t.getDueDate() == null ? null : t.getDueDate().toString());
        row.setBlocked(Boolean.TRUE.equals(t.getBlocked()));
        row.setHref("#/board?task=" + t.getId());
        return row;
    }

    private String projectName(Task t, List<Project> projects) {
        return t.getReqId() == null ? null : projectName(t.getReqId(), projects);
    }

    private static String projectName(String projectId, List<Project> projects) {
        if (projectId == null) {
            return "全部项目";
        }
        for (Project p : projects) {
            if (p.id.equals(projectId)) {
                return p.name;
            }
        }
        return "未命名项目";
    }

    private Set<String> endedColumns(String workspaceId) {
        Set<String> ended = new HashSet<String>();
        for (BoardColumn c : metaCache.columns(workspaceId)) {
            if ("ended".equals(c.getProcessingRule())) {
                ended.add(c.getId());
            }
        }
        return ended;
    }

    private String columnName(String workspaceId, String id) {
        if (id == null) {
            return null;
        }
        for (BoardColumn c : metaCache.columns(workspaceId)) {
            if (id.equals(c.getId()) && Texts.trimToNull(c.getName()) != null) {
                return c.getName();
            }
        }
        return Consts.columnName(id);
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> findCard(List<Map<String, Object>> cards, String projectId) {
        if (cards == null) {
            return null;
        }
        for (Map<String, Object> card : cards) {
            if (projectId.equals(str(card.get("reqId")))) {
                return card;
            }
        }
        return null;
    }

    private static boolean overdue(Object due) {
        String value = str(due);
        if (value.isEmpty()) {
            return false;
        }
        try {
            return LocalDate.parse(value).isBefore(LocalDate.now());
        } catch (RuntimeException e) {
            return false;
        }
    }

    private static String versionSummary(VersionStatsResponse.VersionStat v) {
        int taskCount = nz(v.getTaskCount());
        int done = nz(v.getDoneCount());
        int pct = taskCount > 0 ? (int) Math.round(done * 100.0 / taskCount) : 0;
        String target = v.getTargetDate() == null ? "未设目标日期" : ("目标 " + v.getTargetDate());
        return (VERSION_STATUS.containsKey(v.getStatus()) ? VERSION_STATUS.get(v.getStatus()) : nz(v.getStatus()))
                + " · " + target + " · 完成 " + done + "/" + taskCount + "（" + pct + "%）";
    }

    private static String deliveryStage(String stage) {
        if ("waiting".equals(stage)) {
            return "待开发";
        }
        if ("active".equals(stage)) {
            return "开发中";
        }
        if ("donePending".equals(stage)) {
            return "完成待发布";
        }
        if ("delivered".equals(stage)) {
            return "已交付";
        }
        return stage;
    }

    private static int healthRank(String health) {
        if ("red".equals(health)) {
            return 0;
        }
        if ("orange".equals(health)) {
            return 1;
        }
        return 2;
    }

    private static String toneOfHealth(String health) {
        if ("red".equals(health)) {
            return "danger";
        }
        if ("orange".equals(health)) {
            return "warn";
        }
        return "good";
    }

    private static String toneOfVersion(String status) {
        if ("released".equals(status)) {
            return "good";
        }
        if ("active".equals(status)) {
            return "warn";
        }
        if ("closed".equals(status) || "canceled".equals(status)) {
            return "normal";
        }
        return "normal";
    }

    private static String hours(int minutes) {
        if (minutes <= 0) {
            return "0 小时";
        }
        int h = minutes / 60;
        int m = minutes % 60;
        if (m == 0) {
            return h + " 小时";
        }
        return h + " 小时 " + m + " 分";
    }

    private static String dateText(LocalDateTime at) {
        if (at == null) {
            return "";
        }
        return at.toLocalDate().toString();
    }

    private static AiAssistantResponse base(String tool) {
        AiAssistantResponse res = new AiAssistantResponse();
        res.setIntent("query");
        res.setQueryType(tool);
        res.setDegraded(true);
        res.setSourceLabel("只读查询");
        res.setAsOf(LocalDateTime.now().format(STATS_TS));
        return res;
    }

    private static AiAssistantFact fact(String label, String value, String tone, String href) {
        return new AiAssistantFact(label, value, tone == null ? "normal" : tone, href);
    }

    private static AiAssistantLink link(String href, String label) {
        return new AiAssistantLink(label, href);
    }

    private static String normalize(String s) {
        return s == null ? "" : s.replaceAll("\\s+", "").toLowerCase();
    }

    private static String nz(String s) {
        return s == null ? "" : s;
    }

    private static int nz(Integer v) {
        return v == null ? 0 : v;
    }

    private static int intOf(Object v) {
        return v instanceof Number ? ((Number) v).intValue() : 0;
    }

    private static String str(Object v) {
        return v == null ? "" : String.valueOf(v);
    }

    private static String cut(String s, int max) {
        if (s == null) {
            return "";
        }
        return s.length() > max ? s.substring(0, max) + "…" : s;
    }

    private static final String DONE = Consts.COL_DONE;
    private static final String CANCELED = Consts.COL_CANCELED;

    private static final class Project {
        final String id;
        final String name;

        Project(String id, String name) {
            this.id = id;
            this.name = name;
        }
    }
}
