package com.devstudio.kanban.service;

import com.devstudio.kanban.common.Consts;
import com.devstudio.kanban.common.WorkCalendar;
import com.devstudio.kanban.dto.ManagementActivityRow;
import com.devstudio.kanban.dto.ManagementCompletionRow;
import com.devstudio.kanban.dto.ManagementOverviewResponse;
import com.devstudio.kanban.dto.ManagementPersonTimeRow;
import com.devstudio.kanban.dto.ManagementProjectDetail;
import com.devstudio.kanban.dto.ManagementProjectRow;
import com.devstudio.kanban.dto.ManagementQuery;
import com.devstudio.kanban.dto.ManagementRiskRow;
import com.devstudio.kanban.dto.ManagementTimeRow;
import com.devstudio.kanban.dto.ManagementWeeklyRow;
import com.devstudio.kanban.dto.ManagementWorkloadResponse;
import com.devstudio.kanban.dto.UserWeekRow;
import com.devstudio.kanban.entity.AppUser;
import com.devstudio.kanban.entity.Requirement;
import com.devstudio.kanban.entity.Task;
import com.devstudio.kanban.entity.WorkspaceMember;
import com.devstudio.kanban.mapper.ManagementMapper;
import com.devstudio.kanban.mapper.RequirementMapper;
import com.devstudio.kanban.mapper.TaskMapper;
import com.devstudio.kanban.mapper.TimeLogMapper;
import com.devstudio.kanban.mapper.UserMapper;
import com.devstudio.kanban.mapper.WorkspaceMemberMapper;
import org.springframework.stereotype.Service;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 管理层驾驶舱查询：一次装配项目事实，风险和完成率由纯函数计算。
 * 项目量按 50–200 设计，允许把项目/任务一次性读入内存；不再逐项目查库。
 */
@Service
public class ManagementQueryService {

    private static final ZoneId ZONE = ZoneId.of("Asia/Shanghai");
    private static final int MAX_PROJECT_LIMIT = 100;
    private static final int DEFAULT_PROJECT_LIMIT = 20;

    private final RequirementMapper reqMapper;
    private final TaskMapper taskMapper;
    private final UserMapper userMapper;
    private final WorkspaceMemberMapper memberMapper;
    private final ManagementMapper managementMapper;
    private final TimeLogMapper timeLogMapper;

    public ManagementQueryService(RequirementMapper reqMapper, TaskMapper taskMapper, UserMapper userMapper,
                                  WorkspaceMemberMapper memberMapper, ManagementMapper managementMapper,
                                  TimeLogMapper timeLogMapper) {
        this.reqMapper = reqMapper;
        this.taskMapper = taskMapper;
        this.userMapper = userMapper;
        this.memberMapper = memberMapper;
        this.managementMapper = managementMapper;
        this.timeLogMapper = timeLogMapper;
    }

    public ManagementOverviewResponse overview(String workspaceId) {
        LocalDate today = LocalDate.now(ZONE);
        Context ctx = load(workspaceId, today);
        ManagementOverviewResponse out = new ManagementOverviewResponse();
        ManagementOverviewResponse.Summary s = out.getSummary();
        int qualitySum = 0;
        int active = 0;
        int done = 0;
        int hold = 0;
        int highRisk = 0;
        int overdue = 0;
        int overdueTasks = 0;
        int statusIssues = 0;
        for (Computed c : ctx.computed) {
            ManagementProjectRow row = c.row;
            s.setProjects(s.getProjects() + 1);
            qualitySum += row.getDataQuality() == null ? 0 : row.getDataQuality();
            if ("active".equals(row.getStatus())) {
                active++;
                if ("red".equals(row.getRiskLevel())) highRisk++;
                if (c.facts.project.getDueDate() != null
                        && today.isAfter(c.facts.project.getDueDate())
                        && c.facts.done < c.facts.total) {
                    overdue++;
                }
                overdueTasks += c.facts.overdue;
            } else if ("done".equals(row.getStatus())) {
                done++;
            } else if ("hold".equals(row.getStatus())) {
                hold++;
            }
            if (row.getStatusIssue() != null) statusIssues++;
            if ("active".equals(row.getStatus())) {
                if ("red".equals(row.getRiskLevel())) out.getRisk().setRed(out.getRisk().getRed() + 1);
                else if ("amber".equals(row.getRiskLevel())) out.getRisk().setAmber(out.getRisk().getAmber() + 1);
                else if ("green".equals(row.getRiskLevel())) out.getRisk().setGreen(out.getRisk().getGreen() + 1);
                else out.getRisk().setUnknown(out.getRisk().getUnknown() + 1);
            }
        }
        s.setActive(active);
        s.setDone(done);
        s.setHold(hold);
        s.setHighRisk(highRisk);
        s.setOverdue(overdue);
        s.setOverdueTasks(overdueTasks);
        s.setMembers(ctx.activeMemberIds.size());
        s.setTopOverdueProject(topOverdueProject(ctx));
        s.setStatusIssues(statusIssues);
        Integer workspaceQuality = ctx.computed.isEmpty()
                ? null : Integer.valueOf(Math.round(qualitySum * 1.0f / ctx.computed.size()));
        s.setDataQuality(workspaceQuality);

        LocalDate monday = mondayOf(today);
        LocalDate weekEnd = monday.plusDays(6);
        Map<LocalDate, Integer> completedNow = weeklyMap(managementMapper.completedWeekly(
                workspaceId, monday, monday.plusWeeks(1)));
        s.setCompletedThisWeek(completedNow.containsKey(monday) ? completedNow.get(monday) : 0);

        ManagementWorkloadResponse workload = workload(ctx, monday, weekEnd);
        int actualWeek = 0;
        for (ManagementWorkloadResponse.Member m : workload.getMembers()) {
            for (ManagementWorkloadResponse.Week w : m.getWeeks()) actualWeek += w.getActualMinutes();
        }
        s.setWorkMinutesThisWeek(actualWeek);

        out.setDataStartDate(ctx.earliestCompletion == null ? null : ctx.earliestCompletion.toString());
        Map<LocalDate, Integer> created = weeklyMap(managementMapper.createdWeekly(
                workspaceId, monday.minusWeeks(11), monday.plusWeeks(1)));
        Map<LocalDate, Integer> completed = weeklyMap(managementMapper.completedWeekly(
                workspaceId, monday.minusWeeks(11), monday.plusWeeks(1)));
        LocalDate prevMonday = monday.minusWeeks(1);
        s.setCompletedPrevWeek(completed.containsKey(prevMonday) ? completed.get(prevMonday) : 0);
        s.setWorkMinutesPrevWeek(managementMapper.workMinutesRange(workspaceId,
                prevMonday.atStartOfDay(), monday.atStartOfDay()));
        for (int i = 11; i >= 0; i--) {
            LocalDate ws = monday.minusWeeks(i);
            ManagementOverviewResponse.TrendPoint p = new ManagementOverviewResponse.TrendPoint();
            p.setWeekStart(ws.toString());
            p.setCreated(created.containsKey(ws) ? created.get(ws) : 0);
            boolean available = ctx.earliestCompletion != null && !ws.isBefore(mondayOf(ctx.earliestCompletion));
            p.setCompletedAvailable(available);
            p.setCompleted(available && completed.containsKey(ws) ? completed.get(ws) : 0);
            out.getWeeks().add(p);
        }

        List<RiskWithProject> all = allRisks(ctx);
        sortRisks(all);
        for (int i = 0; i < all.size() && out.getTopRisks().size() < 5; i++) {
            out.getTopRisks().add(all.get(i).risk);
        }

        ManagementOverviewResponse.WorkloadSummary w = out.getWorkload();
        int overloaded = 0;
        int maxPct = 0;
        for (ManagementWorkloadResponse.Member m : workload.getMembers()) {
            for (ManagementWorkloadResponse.Week x : m.getWeeks()) {
                /* 未绑定账号的负载池不是具体的人，不计入“超载人数” */
                if (m.getUserId() != null && x.getEstimatedPct() >= 100) overloaded++;
                maxPct = Math.max(maxPct, x.getEstimatedPct());
            }
        }
        w.setOverloadedMembers(overloaded);
        w.setMaxEstimatedPct(maxPct);
        w.setEstimateCoverage(estimateCoverage(ctx.tasks));
        w.setTopEstimateProject(topEstimateProject(ctx, monday, weekEnd));
        return out;
    }

    public Map<String, Object> projects(String workspaceId, ManagementQuery q) {
        Context ctx = load(workspaceId, LocalDate.now(ZONE));
        List<ManagementProjectRow> rows = filteredRows(ctx, q);
        int offset = q == null || q.getOffset() == null ? 0 : Math.max(0, q.getOffset());
        int limit = q == null || q.getLimit() == null ? DEFAULT_PROJECT_LIMIT : q.getLimit();
        limit = Math.max(1, Math.min(MAX_PROJECT_LIMIT, limit));
        int total = rows.size();
        List<ManagementProjectRow> page = new ArrayList<ManagementProjectRow>();
        for (int i = offset; i < rows.size() && page.size() < limit; i++) page.add(rows.get(i));
        Map<String, Object> out = new LinkedHashMap<String, Object>();
        out.put("items", page);
        out.put("total", total);
        out.put("offset", offset);
        out.put("limit", limit);
        out.put("hasMore", offset + page.size() < total);
        return out;
    }

    /** 导出用：当前筛选条件下的全部项目，不分页。 */
    public List<ManagementProjectRow> projectRows(String workspaceId, ManagementQuery q) {
        return filteredRows(load(workspaceId, LocalDate.now(ZONE)), q);
    }

    private List<ManagementProjectRow> filteredRows(Context ctx, ManagementQuery q) {
        List<ManagementProjectRow> rows = new ArrayList<ManagementProjectRow>();
        String risk = q == null ? null : trim(q.getRiskLevel());
        String status = q == null ? null : trim(q.getStatus());
        String manager = q == null ? null : trim(q.getManager());
        String keyword = q == null ? null : trim(q.getKeyword());
        String statusIssue = q == null ? null : trim(q.getStatusIssue());
        LocalDate dueFrom = q == null ? null : q.getDueFrom();
        LocalDate dueTo = q == null ? null : q.getDueTo();
        for (Computed c : ctx.computed) {
            ManagementProjectRow r = c.row;
            if (risk != null && !risk.equals(r.getRiskLevel())) continue;
            if (status != null && !status.equals(r.getStatus())) continue;
            if (manager != null && !manager.equals(r.getManagerUserId())) continue;
            if (statusIssue != null && !statusIssue.equals(r.getStatusIssue())) continue;
            if (dueFrom != null && (r.getDueDate() == null || r.getDueDate().isBefore(dueFrom))) continue;
            if (dueTo != null && (r.getDueDate() == null || r.getDueDate().isAfter(dueTo))) continue;
            if (keyword != null) {
                String hay = (r.getName() == null ? "" : r.getName())
                        + " " + (r.getManager() == null ? "" : r.getManager());
                if (!hay.toLowerCase().contains(keyword.toLowerCase())) continue;
            }
            rows.add(r);
        }
        sortRows(rows, q == null ? "risk" : q.getSort());
        return rows;
    }

    public ManagementProjectDetail detail(String workspaceId, String id) {
        Context ctx = load(workspaceId, LocalDate.now(ZONE));
        Computed c = ctx.byProject.get(id);
        if (c == null) {
            throw com.devstudio.kanban.common.AppException.notFound("项目不存在或已被移除");
        }
        ManagementProjectDetail out = new ManagementProjectDetail();
        out.setProject(c.row);
        out.setTasks(c.facts.tasks);
        for (ProjectRiskService.RiskItem item : c.risk.risks) {
            out.getRisks().add(riskRow(c, item));
        }
        Map<String, Integer> actualByUser = new HashMap<String, Integer>();
        for (ManagementPersonTimeRow row : managementMapper.timeByProjectUser(workspaceId, id)) {
            actualByUser.put(row.getUserId(), row.getActualMinutes());
        }
        Map<String, ManagementProjectDetail.HourRow> hours = new LinkedHashMap<String, ManagementProjectDetail.HourRow>();
        for (Task t : c.facts.tasks) {
            String key = t.getOwnerUserId() == null || t.getOwnerUserId().isEmpty()
                    ? "n:" + (t.getOwner() == null ? "未绑定账号" : t.getOwner()) : t.getOwnerUserId();
            ManagementProjectDetail.HourRow h = hours.get(key);
            if (h == null) {
                h = new ManagementProjectDetail.HourRow();
                h.setUserId(key.startsWith("n:") ? null : key);
                h.setName(key.startsWith("n:") ? key.substring(2) : nameOf(ctx, key));
                h.setEstimateMinutes(0);
                h.setActualMinutes(0);
                hours.put(key, h);
            }
            if (t.getEstimateMinutes() != null && t.getEstimateMinutes() > 0) {
                h.setEstimateMinutes(h.getEstimateMinutes() + t.getEstimateMinutes());
            }
            if (!key.startsWith("n:")) {
                h.setActualMinutes(actualByUser.containsKey(key) ? actualByUser.get(key) : 0);
            }
        }
        /* 帮别人做事产生的工时也要出现；只按“任务负责人”建行会漏掉这些成员 */
        for (Map.Entry<String, Integer> e : actualByUser.entrySet()) {
            String uid = e.getKey();
            if (uid == null || hours.containsKey(uid)) continue;
            ManagementProjectDetail.HourRow h = new ManagementProjectDetail.HourRow();
            h.setUserId(uid);
            h.setName(nameOf(ctx, uid));
            h.setEstimateMinutes(0);
            h.setActualMinutes(e.getValue() == null ? 0 : e.getValue());
            hours.put(uid, h);
        }
        out.getHours().addAll(hours.values());
        LocalDate monday = mondayOf(LocalDate.now(ZONE));
        Map<LocalDate, Integer> comp = weeklyMap(managementMapper.completedWeeklyByProject(
                workspaceId, id, monday.minusWeeks(7), monday.plusWeeks(1)));
        for (int i = 7; i >= 0; i--) {
            LocalDate ws = monday.minusWeeks(i);
            ManagementOverviewResponse.TrendPoint p = new ManagementOverviewResponse.TrendPoint();
            p.setWeekStart(ws.toString());
            p.setCreated(0);
            p.setCompletedAvailable(true);
            p.setCompleted(comp.containsKey(ws) ? comp.get(ws) : 0);
            out.getTrend().add(p);
        }
        return out;
    }

    public List<ManagementRiskRow> risks(String workspaceId, int limit) {
        Context ctx = load(workspaceId, LocalDate.now(ZONE));
        List<RiskWithProject> all = allRisks(ctx);
        sortRisks(all);
        List<ManagementRiskRow> out = new ArrayList<ManagementRiskRow>();
        for (int i = 0; i < all.size() && out.size() < limit; i++) out.add(all.get(i).risk);
        return out;
    }

    public ManagementWorkloadResponse workload(String workspaceId, LocalDate from, LocalDate to) {
        return workload(load(workspaceId, LocalDate.now(ZONE)), from, to);
    }

    /* ==================== 事实装配 ==================== */

    private Context load(String workspaceId, LocalDate today) {
        Context ctx = new Context();
        ctx.workspaceId = workspaceId;
        ctx.today = today;
        ctx.projects = reqMapper.selectAll(workspaceId);
        ctx.tasks = taskMapper.selectAll(workspaceId);
        ctx.users = userMapper.selectAll();
        List<WorkspaceMember> members = memberMapper.selectByWorkspace(workspaceId);
        ctx.memberRoles = new HashMap<String, String>();
        ctx.activeMemberIds = new HashSet<String>();
        ctx.memberNames = new HashMap<String, String>();
        for (AppUser u : ctx.users) {
            ctx.memberNames.put(u.getId(), u.getDisplayName() == null || u.getDisplayName().trim().isEmpty()
                    ? u.getUsername() : u.getDisplayName());
            ctx.userById.put(u.getId(), u);
        }
        for (WorkspaceMember m : members) {
            ctx.memberRoles.put(m.getUserId(), m.getRole());
            if ("owner".equals(m.getRole()) || "member".equals(m.getRole())) {
                ctx.activeMemberIds.add(m.getUserId());
            }
        }
        Map<String, List<Task>> byReq = new HashMap<String, List<Task>>();
        for (Task t : ctx.tasks) {
            if (t.getReqId() == null) continue;
            List<Task> list = byReq.get(t.getReqId());
            if (list == null) {
                list = new ArrayList<Task>();
                byReq.put(t.getReqId(), list);
            }
            list.add(t);
        }
        Map<String, Integer> timeByReq = new HashMap<String, Integer>();
        for (ManagementTimeRow row : managementMapper.timeByProject(workspaceId)) {
            timeByReq.put(row.getReqId(), row.getActualMinutes());
        }
        Map<String, LocalDateTime> activity = new HashMap<String, LocalDateTime>();
        for (ManagementActivityRow row : managementMapper.lastActivity(workspaceId)) {
            activity.put(row.getReqId(), row.getLastAt());
        }
        Map<String, LocalDate> lastCompletion = new HashMap<String, LocalDate>();
        for (ManagementCompletionRow row : managementMapper.lastCompletionByProject(workspaceId)) {
            lastCompletion.put(row.getReqId(), row.getLastAt());
        }
        ctx.earliestCompletion = managementMapper.earliestCompletion(workspaceId);
        LocalDate weekStart = mondayOf(today);
        /* 本周未完成任务的预估负载按人汇总，供项目卡片判断“项目成员是否超载” */
        Map<String, Integer> weekEstimates = weekEstimateByOwner(ctx.tasks, weekStart, weekStart.plusDays(6));

        for (Requirement p : ctx.projects) {
            ProjectFacts f = new ProjectFacts();
            f.project = p;
            f.today = today;
            f.tasks = byReq.get(p.getId()) == null ? new ArrayList<Task>() : byReq.get(p.getId());
            f.activeMemberIds = ctx.activeMemberIds;
            f.memberNames = ctx.memberNames;
            f.managerValid = p.getManagerUserId() != null && ctx.activeMemberIds.contains(p.getManagerUserId());
            f.managerName = nameOf(ctx, p.getManagerUserId());
            f.actualMinutes = timeByReq.containsKey(p.getId()) ? timeByReq.get(p.getId()) : 0;
            LocalDateTime la = activity.get(p.getId());
            f.lastActivityAt = la != null ? la : p.getUpdatedAt();
            f.lastCompletedDate = lastCompletion.get(p.getId());
            LocalDate completionBase = f.lastCompletedDate != null ? f.lastCompletedDate
                    : (p.getStartDate() != null ? p.getStartDate()
                    : (p.getCreatedAt() == null ? null : p.getCreatedAt().toLocalDate()));
            f.daysSinceCompletion = completionBase == null ? null
                    : (int) Math.max(0, ChronoUnit.DAYS.between(completionBase, today));
            ProjectRiskService.RiskResult risk = ProjectRiskService.evaluate(f);
            ProjectDataQualityService.Result dq = ProjectDataQualityService.compute(f);
            f.overloadedMembers = projectOverloadedMembers(f, ctx, weekEstimates, weekStart);
            ManagementProjectRow row = row(f, risk, dq);
            Computed c = new Computed();
            c.facts = f;
            c.risk = risk;
            c.row = row;
            ctx.computed.add(c);
            ctx.byProject.put(p.getId(), c);
        }
        return ctx;
    }

    private ManagementProjectRow row(ProjectFacts f, ProjectRiskService.RiskResult risk,
                                     ProjectDataQualityService.Result dq) {
        ManagementProjectRow r = new ManagementProjectRow();
        Requirement p = f.project;
        r.setId(p.getId());
        r.setName(p.getName());
        r.setStatus(p.getStatus());
        if (p.getManagerUserId() == null) {
            r.setManager(null);
        } else {
            r.setManager(f.managerValid ? f.managerName : f.managerName + "（非成员）");
        }
        r.setManagerUserId(p.getManagerUserId());
        r.setStartDate(p.getStartDate());
        r.setDueDate(p.getDueDate());
        r.setPriority(p.getPriority() == null ? "P2" : p.getPriority());
        r.setRiskLevel(risk.level);
        r.setStatusIssue(risk.statusIssue);
        r.setStatusLight(statusLight(f, risk));
        r.setHealthSource(risk.source);
        r.setHealthOverride(p.getHealthOverride());
        r.setHealthNote(p.getHealthNote());
        r.setRiskReasons(risk.reasons);
        r.setDataQuality(dq.score);
        r.setMissingFields(dq.missingFields);
        r.setHealthOverrideUntil(p.getHealthOverrideUntil());
        r.setPlanAvailable(risk.planAvailable);
        r.setNoTasks(f.noTasks());
        r.setDoneWeightedPct(f.doneWeightedPct);
        r.setProgressWeightedPct(f.progressWeightedPct);
        r.setPlannedPct(risk.plannedPct);
        r.setVariancePct(risk.variancePct);
        r.setEstimateCoverage(f.estimateCoverage);
        r.setTaskCount(f.total);
        r.setDoneCount(f.done);
        r.setBacklogCount(f.backlogCount);
        r.setDoingCount(f.doingCount);
        r.setOtherCount(f.otherCount);
        r.setOverdueCount(f.overdue);
        r.setBlockedCount(f.blocked);
        r.setEstimateMinutes(f.estimateMinutes);
        r.setActualMinutes(f.actualMinutes);
        r.setLastCompletedDate(f.lastCompletedDate);
        r.setDaysSinceCompletion(f.daysSinceCompletion);
        r.setOverloadedMembers(f.overloadedMembers);
        r.setParticipants(f.participants);
        r.setLastActivityAt(f.lastActivityAt);
        r.setNextNode(nextNode(f.tasks));
        return r;
    }

    /**
     * 截图口径的简版状态灯：红 = 逾期占比 >10% 且连续 >=7 天无完成；
     * 橙 = 有逾期任务或项目级超载；灰 = 已暂停或没有有效任务；绿 = 其余。
     * 人工覆盖优先，避免卡片状态灯和详情风险结论互相打架。
     */
    private String statusLight(ProjectFacts f, ProjectRiskService.RiskResult risk) {
        if ("manual".equals(risk.source)) {
            if ("red".equals(risk.level)) return "red";
            if ("amber".equals(risk.level)) return "amber";
            return "green";
        }
        if (f.statusIssue != null) return "amber";
        if ("done".equals(f.project.getStatus())) return "green";
        if ("hold".equals(f.project.getStatus())) return "unknown";
        if (f.total == 0) return "unknown";
        boolean red = f.overdue * 100 > f.total * 10
                && f.daysSinceCompletion != null && f.daysSinceCompletion >= 7;
        if (red) return "red";
        if (f.overdue > 0 || f.overloadedMembers > 0) return "amber";
        return "green";
    }

    /**
     * 项目级超载：项目内还有未完成任务、且该成员在本空间本周的未完成预估负载超过个人容量。
     * 用全局负载而不是只算本项目，避免成员在多个项目各占 60% 时被漏判。
     */
    private int projectOverloadedMembers(ProjectFacts f, Context ctx, Map<String, Integer> weekEstimates,
                                         LocalDate weekStart) {
        LocalDate weekEnd = weekStart.plusDays(6);
        Set<String> owners = new HashSet<String>();
        for (Task t : f.tasks) {
            if (Consts.COL_DONE.equals(t.getBoardColumn())) continue;
            String key = ownerKey(t);
            /* 未绑定账号的池子不是“人”，不参与超载人数统计 */
            if (key.startsWith("u:")) owners.add(key);
        }
        int overloaded = 0;
        for (String key : owners) {
            int maxHours = 8;
            AppUser u = ctx.userById.get(key.substring(2));
            if (u != null && u.getWorkMaxHours() != null) maxHours = u.getWorkMaxHours();
            int capacity = Math.max(1, maxHours * 60 * WorkCalendar.workingDays(weekStart, weekEnd));
            Integer estimate = weekEstimates.get(key);
            if (estimate != null && Math.round(estimate * 100f / capacity) >= 100) overloaded++;
        }
        return overloaded;
    }

    /** 本周未完成任务的分摊预估，按负责人汇总（与负载明细同口径）。 */
    private Map<String, Integer> weekEstimateByOwner(List<Task> tasks, LocalDate weekStart, LocalDate weekEnd) {
        Map<String, Integer> estimates = new HashMap<String, Integer>();
        for (Task t : tasks) {
            if (Consts.COL_DONE.equals(t.getBoardColumn())) continue;
            if (t.getEstimateMinutes() == null || t.getEstimateMinutes() <= 0) continue;
            LocalDate s = effectiveStart(t);
            LocalDate e = effectiveEnd(t);
            if (s == null || e == null || e.isBefore(weekStart) || s.isAfter(weekEnd)) continue;
            LocalDate is = s.isAfter(weekStart) ? s : weekStart;
            LocalDate ie = e.isBefore(weekEnd) ? e : weekEnd;
            int totalWork = WorkCalendar.workingDays(t.getStartDate() == null ? s : t.getStartDate(),
                    t.getDueDate() == null ? e : t.getDueDate());
            if (totalWork <= 0) totalWork = 1;
            int wd = WorkCalendar.workingDays(is, ie);
            if (wd <= 0) continue;
            int est = (int) Math.round(t.getEstimateMinutes() * 1.0 * wd / totalWork);
            String key = ownerKey(t);
            estimates.put(key, (estimates.containsKey(key) ? estimates.get(key) : 0) + est);
        }
        return estimates;
    }

    /* ==================== 负载 ==================== */

    private ManagementWorkloadResponse workload(Context ctx, LocalDate from, LocalDate to) {
        if (from == null) from = mondayOf(LocalDate.now(ZONE));
        if (to == null) to = from.plusDays(6);
        if (to.isBefore(from)) {
            throw com.devstudio.kanban.common.AppException.badRequest("负载区间不合法");
        }
        if (ChronoUnit.DAYS.between(from, to) > 182) {
            to = from.plusDays(182);
        }
        ManagementWorkloadResponse out = new ManagementWorkloadResponse();
        out.setFrom(from.toString());
        out.setTo(to.toString());
        List<LocalDate> weeks = new ArrayList<LocalDate>();
        LocalDate cursor = mondayOf(from);
        while (!cursor.isAfter(to)) {
            weeks.add(cursor);
            cursor = cursor.plusWeeks(1);
        }
        out.setWeeks(new ArrayList<String>());
        for (LocalDate w : weeks) out.getWeeks().add(w.toString());

        Map<String, MemberBucket> buckets = new LinkedHashMap<String, MemberBucket>();
        Map<String, Integer> taskTotal = new HashMap<String, Integer>();
        Map<String, Integer> taskEstimated = new HashMap<String, Integer>();
        Set<String> taskIds = new HashSet<String>();
        /* 先按“人”统计全部任务，覆盖率不被“只有估时的任务”误导 */
        for (Task t : ctx.tasks) {
            String key = ownerKey(t);
            MemberBucket mb = buckets.get(key);
            if (mb == null) {
                mb = new MemberBucket();
                mb.name = ownerName(ctx, t, key);
                mb.userId = key.startsWith("u:") ? key.substring(2) : null;
                buckets.put(key, mb);
            }
            taskTotal.put(key, taskTotal.containsKey(key) ? taskTotal.get(key) + 1 : 1);
            if (t.getEstimateMinutes() != null && t.getEstimateMinutes() > 0) {
                taskEstimated.put(key, taskEstimated.containsKey(key) ? taskEstimated.get(key) + 1 : 1);
            }
            taskIds.add(t.getId());
        }
        for (Task t : ctx.tasks) {
            if (t.getEstimateMinutes() == null || t.getEstimateMinutes() <= 0) continue;
            LocalDate s = effectiveStart(t);
            LocalDate e = effectiveEnd(t);
            if (s == null || e == null) continue;
            if (s.isBefore(from)) s = from;
            if (e.isAfter(to)) e = to;
            if (e.isBefore(s)) continue;
            String key = ownerKey(t);
            MemberBucket mb = buckets.get(key);
            if (mb == null) {
                mb = new MemberBucket();
                mb.name = ownerName(ctx, t, key);
                mb.userId = key.startsWith("u:") ? key.substring(2) : null;
                buckets.put(key, mb);
            }
            int totalWork = WorkCalendar.workingDays(t.getStartDate() == null ? s : t.getStartDate(),
                    t.getDueDate() == null ? e : t.getDueDate());
            if (totalWork <= 0) totalWork = 1;
            for (LocalDate week : weeks) {
                LocalDate ws = week;
                LocalDate we = week.plusDays(6);
                LocalDate is = s.isAfter(ws) ? s : ws;
                LocalDate ie = e.isBefore(we) ? e : we;
                if (ie.isBefore(is)) continue;
                int wd = WorkCalendar.workingDays(is, ie);
                if (wd <= 0) continue;
                int est = (int) Math.round(t.getEstimateMinutes() * 1.0 * wd / totalWork);
                WeekBucket wb = mb.week(week);
                wb.estimateMinutes += est;
                if (t.getStartDate() == null) wb.unscheduled = true;
            }
        }
        Map<String, Integer> actual = new HashMap<String, Integer>();
        if (!taskIds.isEmpty()) {
            List<String> ids = new ArrayList<String>(taskIds);
            for (UserWeekRow row : timeLogMapper.sumUserWeeklyMinutes(ctx.workspaceId,
                    from.atStartOfDay(), to.plusDays(1).atStartOfDay(), ids)) {
                if (row.getWeekStart() == null || row.getUserId() == null) continue;
                String key = "u:" + row.getUserId();
                String k = key + "\u0000" + row.getWeekStart();
                actual.put(k, (actual.containsKey(k) ? actual.get(k) : 0)
                        + (row.getTotalMinutes() == null ? 0 : row.getTotalMinutes()));
            }
        }
        // 有实际工时但任务已无估时/负责人时，也显示出来
        for (String k : actual.keySet()) {
            String[] parts = k.split("\u0000", 2);
            if (!buckets.containsKey(parts[0])) {
                MemberBucket mb = new MemberBucket();
                mb.userId = parts[0].startsWith("u:") ? parts[0].substring(2) : null;
                mb.name = nameOf(ctx, mb.userId);
                buckets.put(parts[0], mb);
            }
        }
        for (MemberBucket mb : buckets.values()) {
            ManagementWorkloadResponse.Member m = new ManagementWorkloadResponse.Member();
            m.setUserId(mb.userId);
            m.setName(mb.name);
            int maxHours = mb.userId == null ? 8
                    : (ctx.userById.get(mb.userId) == null || ctx.userById.get(mb.userId).getWorkMaxHours() == null
                    ? 8 : ctx.userById.get(mb.userId).getWorkMaxHours());
            String memberKey = ownerKeyOf(mb);
            Integer totalTasks = taskTotal.get(memberKey);
            Integer estimatedTasks = taskEstimated.get(memberKey);
            int coverage = totalTasks == null || totalTasks == 0 ? 0
                    : Math.round((estimatedTasks == null ? 0 : estimatedTasks) * 100f / totalTasks);
            for (LocalDate week : weeks) {
                WeekBucket wb = mb.week(week);
                ManagementWorkloadResponse.Week w = new ManagementWorkloadResponse.Week();
                w.setWeekStart(week.toString());
                int workdays = WorkCalendar.workingDays(week, week.plusDays(6));
                int capacity = Math.max(1, maxHours * 60 * workdays);
                w.setCapacityMinutes(capacity);
                w.setEstimateMinutes(wb.estimateMinutes);
                String key = (mb.userId == null ? "u:" : "u:" + mb.userId) + "\u0000" + week;
                w.setActualMinutes(actual.containsKey(key) ? actual.get(key) : 0);
                w.setEstimatedPct(capacity == 0 ? 0 : Math.round(wb.estimateMinutes * 100f / capacity));
                w.setEstimateCoverage(coverage);
                w.setUnscheduled(wb.unscheduled);
                m.getWeeks().add(w);
            }
            out.getMembers().add(m);
        }
        Collections.sort(out.getMembers(), new Comparator<ManagementWorkloadResponse.Member>() {
            @Override
            public int compare(ManagementWorkloadResponse.Member a, ManagementWorkloadResponse.Member b) {
                return (a.getName() == null ? "" : a.getName()).compareTo(b.getName() == null ? "" : b.getName());
            }
        });
        return out;
    }

    private static String ownerKeyOf(MemberBucket mb) {
        return mb.userId == null ? "n:" + (mb.name == null ? "未绑定账号" : mb.name) : "u:" + mb.userId;
    }

    /* ==================== 风险与工具 ==================== */

    private List<RiskWithProject> allRisks(Context ctx) {
        List<RiskWithProject> out = new ArrayList<RiskWithProject>();
        for (Computed c : ctx.computed) {
            if (!"active".equals(c.row.getStatus())) continue;
            for (ProjectRiskService.RiskItem item : c.risk.risks) {
                RiskWithProject x = new RiskWithProject();
                x.risk = riskRow(c, item);
                x.project = c.row;
                out.add(x);
            }
        }
        return out;
    }

    private ManagementRiskRow riskRow(Computed c, ProjectRiskService.RiskItem item) {
        ManagementRiskRow r = new ManagementRiskRow();
        r.setType(item.type);
        r.setSeverity(item.severity);
        r.setProjectId(c.row.getId());
        r.setProjectName(c.row.getName());
        r.setManager(c.row.getManager());
        r.setDays(item.days);
        r.setReason(item.reason);
        r.setEvidence(item.evidence);
        r.setSuggestedAction(item.suggestedAction);
        r.setTarget("project");
        return r;
    }

    private void sortRisks(List<RiskWithProject> list) {
        Collections.sort(list, new Comparator<RiskWithProject>() {
            @Override
            public int compare(RiskWithProject a, RiskWithProject b) {
                int s = severity(b.risk.getSeverity()) - severity(a.risk.getSeverity());
                if (s != 0) return s;
                int da = a.risk.getDays() == null ? -1 : a.risk.getDays();
                int db = b.risk.getDays() == null ? -1 : b.risk.getDays();
                if (da != db) return db - da;
                int pa = priority(a.project.getPriority());
                int pb = priority(b.project.getPriority());
                if (pa != pb) return pa - pb;
                return (a.project.getName() == null ? "" : a.project.getName())
                        .compareTo(b.project.getName() == null ? "" : b.project.getName());
            }
        });
    }

    private void sortRows(List<ManagementProjectRow> rows, String sort) {
        final boolean riskSort = "risk".equals(sort);
        final boolean dueSort = "due".equals(sort);
        final boolean varianceSort = "variance".equals(sort);
        Collections.sort(rows, new Comparator<ManagementProjectRow>() {
            @Override
            public int compare(ManagementProjectRow a, ManagementProjectRow b) {
                if (riskSort) {
                    int r = riskRank(a.getRiskLevel()) - riskRank(b.getRiskLevel());
                    if (r != 0) return r;
                    int v = nullInt(a.getVariancePct(), 999) - nullInt(b.getVariancePct(), 999);
                    if (v != 0) return v;
                }
                if (dueSort) {
                    int d = nullDate(a.getDueDate()).compareTo(nullDate(b.getDueDate()));
                    if (d != 0) return d;
                }
                if (varianceSort) {
                    int v = nullInt(a.getVariancePct(), 999) - nullInt(b.getVariancePct(), 999);
                    if (v != 0) return v;
                }
                String an = a.getName() == null ? "" : a.getName();
                String bn = b.getName() == null ? "" : b.getName();
                return an.compareTo(bn);
            }
        });
    }

    private static String nullDate(LocalDate d) {
        return d == null ? "9999-12-31" : d.toString();
    }

    private static int nullInt(Integer v, int fallback) {
        return v == null ? fallback : v;
    }

    private static int riskRank(String level) {
        if ("red".equals(level)) return 0;
        if ("amber".equals(level)) return 1;
        if ("green".equals(level)) return 2;
        return 3;
    }

    private static int severity(String s) {
        return "red".equals(s) ? 2 : "amber".equals(s) ? 1 : 0;
    }

    private static int priority(String p) {
        if ("P0".equals(p)) return 0;
        if ("P1".equals(p)) return 1;
        if ("P2".equals(p)) return 2;
        return 3;
    }

    private static Map<LocalDate, Integer> weeklyMap(List<ManagementWeeklyRow> rows) {
        Map<LocalDate, Integer> out = new HashMap<LocalDate, Integer>();
        for (ManagementWeeklyRow r : rows) {
            if (r.getWeekStart() != null) out.put(r.getWeekStart(), r.getCount());
        }
        return out;
    }

    private static LocalDate mondayOf(LocalDate d) {
        return d.minusDays(d.getDayOfWeek().getValue() - DayOfWeek.MONDAY.getValue());
    }

    private static String trim(String s) {
        return s == null || s.trim().isEmpty() ? null : s.trim();
    }

    private String topOverdueProject(Context ctx) {
        String best = null;
        int max = 0;
        for (Computed c : ctx.computed) {
            if (!"active".equals(c.row.getStatus())) continue;
            if (c.facts.overdue > max) {
                max = c.facts.overdue;
                best = c.row.getName();
            }
        }
        return best;
    }

    private String topEstimateProject(Context ctx, LocalDate from, LocalDate to) {
        Map<String, Integer> byProject = new HashMap<String, Integer>();
        for (Task t : ctx.tasks) {
            if (t.getEstimateMinutes() == null || t.getEstimateMinutes() <= 0 || t.getReqId() == null) continue;
            LocalDate s = effectiveStart(t);
            LocalDate e = effectiveEnd(t);
            if (s == null || e == null || e.isBefore(from) || s.isAfter(to)) continue;
            LocalDate is = s.isAfter(from) ? s : from;
            LocalDate ie = e.isBefore(to) ? e : to;
            int totalWork = WorkCalendar.workingDays(t.getStartDate() == null ? s : t.getStartDate(),
                    t.getDueDate() == null ? e : t.getDueDate());
            if (totalWork <= 0) totalWork = 1;
            int wd = WorkCalendar.workingDays(is, ie);
            if (wd <= 0) continue;
            /* 与负载明细同口径：长任务只计入落在本周的估时份额 */
            int est = (int) Math.round(t.getEstimateMinutes() * 1.0 * wd / totalWork);
            byProject.put(t.getReqId(), (byProject.containsKey(t.getReqId()) ? byProject.get(t.getReqId()) : 0)
                    + est);
        }
        String best = null;
        int max = 0;
        for (Map.Entry<String, Integer> e : byProject.entrySet()) {
            if (e.getValue() > max) {
                max = e.getValue();
                best = e.getKey();
            }
        }
        if (best == null) return null;
        for (Requirement p : ctx.projects) if (best.equals(p.getId())) return p.getName();
        return null;
    }

    private int estimateCoverage(List<Task> tasks) {
        if (tasks.isEmpty()) return 0;
        int n = 0;
        for (Task t : tasks) if (t.getEstimateMinutes() != null && t.getEstimateMinutes() > 0) n++;
        return Math.round(n * 100f / tasks.size());
    }

    private String nextNode(List<Task> tasks) {
        Task best = null;
        for (Task t : tasks) {
            if (Consts.COL_DONE.equals(t.getBoardColumn()) || t.getDueDate() == null) continue;
            if (best == null || t.getDueDate().isBefore(best.getDueDate())) best = t;
        }
        if (best == null) return null;
        return best.getTitle() + " · " + best.getDueDate();
    }

    private static LocalDate effectiveStart(Task t) {
        LocalDate s = t.getStartDate() != null ? t.getStartDate() : t.getDueDate();
        LocalDate e = t.getDueDate() != null ? t.getDueDate() : t.getStartDate();
        return (s != null && e != null && s.isAfter(e)) ? e : s;
    }

    private static LocalDate effectiveEnd(Task t) {
        LocalDate s = t.getStartDate() != null ? t.getStartDate() : t.getDueDate();
        LocalDate e = t.getDueDate() != null ? t.getDueDate() : t.getStartDate();
        return (s != null && e != null && s.isAfter(e)) ? s : e;
    }

    private static String ownerKey(Task t) {
        if (t.getOwnerUserId() != null && !t.getOwnerUserId().isEmpty()) return "u:" + t.getOwnerUserId();
        return "n:" + (t.getOwner() == null ? "未绑定账号" : t.getOwner());
    }

    private static String ownerName(Context ctx, Task t, String key) {
        if (key.startsWith("u:")) return nameOf(ctx, key.substring(2));
        return key.substring(2);
    }

    private static String nameOf(Context ctx, String userId) {
        if (userId == null) return "未指定";
        String n = ctx.memberNames.get(userId);
        return n == null ? "未知账号" : n;
    }

    /* ==================== 内部结构 ==================== */

    private static class Context {
        String workspaceId;
        LocalDate today;
        List<Requirement> projects;
        List<Task> tasks;
        List<AppUser> users;
        Map<String, AppUser> userById = new HashMap<String, AppUser>();
        Map<String, String> memberRoles;
        Set<String> activeMemberIds;
        Map<String, String> memberNames;
        LocalDate earliestCompletion;
        List<Computed> computed = new ArrayList<Computed>();
        Map<String, Computed> byProject = new HashMap<String, Computed>();
    }

    private static class Computed {
        ProjectFacts facts;
        ProjectRiskService.RiskResult risk;
        ManagementProjectRow row;
    }

    private static class RiskWithProject {
        ManagementRiskRow risk;
        ManagementProjectRow project;
    }

    private static class MemberBucket {
        String userId;
        String name;
        Map<LocalDate, WeekBucket> weeks = new LinkedHashMap<LocalDate, WeekBucket>();
        WeekBucket week(LocalDate w) {
            WeekBucket b = weeks.get(w);
            if (b == null) {
                b = new WeekBucket();
                weeks.put(w, b);
            }
            return b;
        }
    }

    private static class WeekBucket {
        int estimateMinutes;
        boolean unscheduled;
    }
}
