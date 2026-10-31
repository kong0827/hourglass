package com.devstudio.kanban.service;

import com.devstudio.kanban.common.AppException;
import com.devstudio.kanban.common.Ids;
import com.devstudio.kanban.dto.BoardQuery;
import com.devstudio.kanban.dto.GanttDepRequest;
import com.devstudio.kanban.dto.GanttLoadResponse;
import com.devstudio.kanban.dto.GanttQuery;
import com.devstudio.kanban.dto.GanttResponse;
import com.devstudio.kanban.dto.GanttShareResponse;
import com.devstudio.kanban.dto.PublicGanttTask;
import com.devstudio.kanban.entity.AppUser;
import com.devstudio.kanban.entity.GanttShare;
import com.devstudio.kanban.entity.Task;
import com.devstudio.kanban.entity.TaskBaseline;
import com.devstudio.kanban.entity.TaskDependency;
import com.devstudio.kanban.entity.TimeLog;
import com.devstudio.kanban.entity.Workspace;
import com.devstudio.kanban.mapper.GanttShareMapper;
import com.devstudio.kanban.mapper.TaskBaselineMapper;
import com.devstudio.kanban.mapper.TaskDependencyMapper;
import com.devstudio.kanban.mapper.TaskMapper;
import com.devstudio.kanban.mapper.TimeLogMapper;
import com.devstudio.kanban.mapper.UserMapper;
import com.devstudio.kanban.mapper.WorkspaceMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalDateTime;
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
 * 甘特图数据服务（V1.4）。
 *
 * 口径与看板保持一致：筛选条件在 SQL 层复刻 TaskService.match()，扩展字段只为本页任务补齐。
 * 这里只负责三件事：稳定分页、依赖图校验、基线与分享。
 */
@Service
public class GanttService {

    private static final int DEFAULT_LIMIT = 300;
    private static final int MAX_LIMIT = 2000;
    private static final int MAX_DEPS = 5000;
    /** 未排期列表一次最多返回多少条（前端只展示前 50） */
    private static final int UNSCHEDULED_LIMIT = 200;
    /** 负载面板一次最多统计多少条排期任务 */
    private static final int LOAD_MAX_TASKS = 20000;
    /** 每人每周容量：5 个工作日 × 8 小时 */
    private static final int WEEK_CAPACITY_MINUTES = 5 * 8 * 60;
    private static final int SHARE_DAYS = 30;

    private final TaskService taskService;
    private final TaskMapper taskMapper;
    private final TaskDependencyMapper dependencyMapper;
    private final TaskBaselineMapper baselineMapper;
    private final GanttShareMapper shareMapper;
    private final TimeLogMapper timeLogMapper;
    private final UserMapper userMapper;
    private final WorkspaceMapper workspaceMapper;

    public GanttService(TaskService taskService, TaskMapper taskMapper,
                        TaskDependencyMapper dependencyMapper, TaskBaselineMapper baselineMapper,
                        GanttShareMapper shareMapper, TimeLogMapper timeLogMapper,
                        UserMapper userMapper, WorkspaceMapper workspaceMapper) {
        this.taskService = taskService;
        this.taskMapper = taskMapper;
        this.dependencyMapper = dependencyMapper;
        this.baselineMapper = baselineMapper;
        this.shareMapper = shareMapper;
        this.timeLogMapper = timeLogMapper;
        this.userMapper = userMapper;
        this.workspaceMapper = workspaceMapper;
    }

    /* ==================== 任务分页 ==================== */

    public GanttResponse gantt(String workspaceId, BoardQuery query, LocalDate from, LocalDate to,
                               boolean includeDone, int offset, int limit) {
        int safeOffset = Math.max(0, offset);
        int safeLimit = limit <= 0 ? DEFAULT_LIMIT : Math.min(limit, MAX_LIMIT);
        GanttQuery gq = GanttQuery.from(query, LocalDate.now(), from, to, includeDone);

        GanttResponse resp = new GanttResponse();
        int total = taskMapper.countGantt(workspaceId, gq);
        resp.setTotal(total);
        resp.setOffset(safeOffset);
        resp.setLimit(safeLimit);
        if (safeOffset >= total) {
            resp.setItems(new ArrayList<Task>());
            resp.setHasMore(false);
        } else {
            List<Task> items = taskMapper.selectGantt(workspaceId, gq, safeOffset, safeLimit);
            /* 只为本页任务补扩展字段，不再全空间聚合 */
            taskService.mergeGanttExtras(workspaceId, items);
            resp.setItems(items);
            resp.setHasMore(safeOffset + items.size() < total);
        }
        /* 未排期 / 依赖 / 基线只随第一页返回 */
        if (safeOffset == 0) {
            resp.setUnscheduledCount(taskMapper.countGanttUnscheduled(workspaceId, gq));
            List<Task> unscheduled = taskMapper.selectGanttUnscheduled(workspaceId, gq, UNSCHEDULED_LIMIT);
            taskService.mergeGanttExtras(workspaceId, unscheduled);
            resp.setUnscheduled(unscheduled);
            resp.setDeps(dependencyMapper.selectByWorkspace(workspaceId));
            resp.setBaseline(baselineMap(workspaceId));
            resp.setBaselineAt(baselineMapper.selectCapturedAt(workspaceId));
        }
        return resp;
    }

    private LocalDate effectiveStart(Task t) {
        LocalDate s = t.getStartDate() != null ? t.getStartDate() : t.getDueDate();
        LocalDate e = t.getDueDate() != null ? t.getDueDate() : t.getStartDate();
        return (s != null && e != null && s.isAfter(e)) ? e : s;
    }

    private LocalDate effectiveEnd(Task t) {
        LocalDate s = t.getStartDate() != null ? t.getStartDate() : t.getDueDate();
        LocalDate e = t.getDueDate() != null ? t.getDueDate() : t.getStartDate();
        return (s != null && e != null && s.isAfter(e)) ? s : e;
    }

    /* ==================== 依赖 ==================== */

    public List<TaskDependency> deps(String workspaceId) {
        return dependencyMapper.selectByWorkspace(workspaceId);
    }

    public TaskDependency createDep(String workspaceId, GanttDepRequest req) {
        String from = req.getFromTaskId();
        String to = req.getToTaskId();
        if (from == null || to == null || from.equals(to)) {
            throw AppException.badRequest("依赖的两端必须是两个不同任务");
        }
        Task a = taskMapper.selectById(from);
        Task b = taskMapper.selectById(to);
        if (a == null || b == null || a.getDeletedAt() != null || b.getDeletedAt() != null
                || !workspaceId.equals(a.getWorkspaceId()) || !workspaceId.equals(b.getWorkspaceId())) {
            throw AppException.badRequest("依赖任务不存在或不属于当前空间");
        }
        if (dependencyMapper.countByWorkspace(workspaceId) >= MAX_DEPS) {
            throw AppException.badRequest("依赖数量已达上限（" + MAX_DEPS + "），请先清理");
        }
        if (dependencyMapper.countEdge(from, to) > 0) {
            throw AppException.badRequest("这两个任务之间已经存在依赖");
        }
        assertNoCycle(workspaceId, from, to);

        TaskDependency dep = new TaskDependency();
        dep.setId(Ids.gen("D"));
        dep.setWorkspaceId(workspaceId);
        dep.setFromTaskId(from);
        dep.setToTaskId(to);
        String depType = req.getDepType() == null ? "FS" : req.getDepType();
        if (!"FS".equals(depType) && !"SS".equals(depType) && !"FF".equals(depType) && !"SF".equals(depType)) {
            throw AppException.badRequest("依赖类型不合法：" + depType);
        }
        dep.setDepType(depType);
        dep.setLagDays(req.getLagDays() == null ? 0 : req.getLagDays());
        dependencyMapper.insert(dep);
        return dependencyMapper.selectById(dep.getId());
    }

    public TaskDependency updateDep(String workspaceId, String id, GanttDepRequest req) {
        TaskDependency dep = dependencyMapper.selectById(id);
        if (dep == null || !workspaceId.equals(dep.getWorkspaceId())) {
            throw AppException.notFound("依赖不存在：" + id);
        }
        String type = req.getDepType() == null ? dep.getDepType() : req.getDepType();
        if (!"FS".equals(type) && !"SS".equals(type) && !"FF".equals(type) && !"SF".equals(type)) {
            throw AppException.badRequest("依赖类型不合法：" + type);
        }
        dep.setDepType(type);
        dep.setLagDays(req.getLagDays() == null ? dep.getLagDays() : req.getLagDays());
        dependencyMapper.update(dep);
        return dependencyMapper.selectById(id);
    }

    public void deleteDep(String workspaceId, String id) {
        if (dependencyMapper.deleteById(id, workspaceId) == 0) {
            throw AppException.notFound("依赖不存在：" + id);
        }
    }

    /** 新增 from → to 时，若 to 已能走到 from，则成环 */
    private void assertNoCycle(String workspaceId, String from, String to) {
        List<TaskDependency> all = dependencyMapper.selectByWorkspace(workspaceId);
        /* 软删除任务上的历史边不参与环检测，否则会挡住正常依赖 */
        Set<String> active = new HashSet<String>();
        for (Task t : taskMapper.selectAll(workspaceId)) {
            active.add(t.getId());
        }
        Map<String, List<String>> adj = new HashMap<String, List<String>>();
        for (TaskDependency d : all) {
            if (!active.contains(d.getFromTaskId()) || !active.contains(d.getToTaskId())) {
                continue;
            }
            List<String> next = adj.get(d.getFromTaskId());
            if (next == null) {
                next = new ArrayList<String>();
                adj.put(d.getFromTaskId(), next);
            }
            next.add(d.getToTaskId());
        }
        Set<String> seen = new HashSet<String>();
        List<String> stack = new ArrayList<String>();
        stack.add(to);
        while (!stack.isEmpty()) {
            String cur = stack.remove(stack.size() - 1);
            if (!seen.add(cur)) {
                continue;
            }
            if (cur.equals(from)) {
                throw AppException.badRequest("会形成循环依赖，已拒绝");
            }
            List<String> next = adj.get(cur);
            if (next != null) {
                stack.addAll(next);
            }
        }
    }

    /* ==================== 基线 ==================== */

    public GanttResponse.BaselinePointMapHolder baselineInfo(String workspaceId) {
        GanttResponse.BaselinePointMapHolder holder = new GanttResponse.BaselinePointMapHolder();
        holder.setBaseline(baselineMap(workspaceId));
        holder.setBaselineAt(baselineMapper.selectCapturedAt(workspaceId));
        return holder;
    }

    @Transactional
    public GanttResponse.BaselinePointMapHolder captureBaseline(String workspaceId) {
        /* 基线只要计划日期，不需要子任务/工时等扩展字段 */
        List<Task> all = taskMapper.selectAll(workspaceId);
        LocalDateTime now = LocalDateTime.now();
        List<TaskBaseline> rows = new ArrayList<TaskBaseline>();
        for (Task t : all) {
            if (t.getStartDate() == null && t.getDueDate() == null) {
                continue;
            }
            TaskBaseline b = new TaskBaseline();
            b.setWorkspaceId(workspaceId);
            b.setTaskId(t.getId());
            b.setStartDate(t.getStartDate());
            b.setDueDate(t.getDueDate());
            b.setCapturedAt(now);
            rows.add(b);
        }
        baselineMapper.deleteByWorkspace(workspaceId);
        if (!rows.isEmpty()) {
            baselineMapper.insertBatch(rows);
        }
        return baselineInfo(workspaceId);
    }

    @Transactional
    public void clearBaseline(String workspaceId) {
        baselineMapper.deleteByWorkspace(workspaceId);
    }

    private Map<String, GanttResponse.BaselinePoint> baselineMap(String workspaceId) {
        Map<String, GanttResponse.BaselinePoint> map = new LinkedHashMap<String, GanttResponse.BaselinePoint>();
        for (TaskBaseline b : baselineMapper.selectByWorkspace(workspaceId)) {
            GanttResponse.BaselinePoint p = new GanttResponse.BaselinePoint();
            p.setStartDate(b.getStartDate());
            p.setDueDate(b.getDueDate());
            map.put(b.getTaskId(), p);
        }
        return map;
    }

    /* ==================== 资源负载 ==================== */

    public GanttLoadResponse load(String workspaceId, BoardQuery query, LocalDate from, LocalDate to) {
        LocalDate rangeFrom = from == null ? LocalDate.now().withDayOfMonth(1) : from;
        LocalDate rangeTo = to == null ? rangeFrom.plusMonths(1).minusDays(1) : to;
        if (rangeTo.isBefore(rangeFrom)) {
            throw AppException.badRequest("负载区间不合法");
        }
        if (ChronoUnit.DAYS.between(rangeFrom, rangeTo) > 366) {
            rangeTo = rangeFrom.plusDays(366);
        }
        List<LocalDate> weeks = new ArrayList<LocalDate>();
        LocalDate cursor = mondayOf(rangeFrom);
        while (!cursor.isAfter(rangeTo)) {
            weeks.add(cursor);
            cursor = cursor.plusWeeks(1);
        }

        Map<String, GanttLoadResponse.Member> members = new LinkedHashMap<String, GanttLoadResponse.Member>();
        Map<String, String> nameByKey = new HashMap<String, String>();
        GanttQuery gq = GanttQuery.from(query, LocalDate.now(), rangeFrom, rangeTo, true);
        List<Task> tasks = taskMapper.selectGantt(workspaceId, gq, 0, LOAD_MAX_TASKS);
        for (Task t : tasks) {
            if (t.getEstimateMinutes() == null || t.getEstimateMinutes() <= 0) {
                continue;
            }
            LocalDate s = effectiveStart(t), e = effectiveEnd(t);
            if (s == null || e == null) {
                continue;
            }
            if (s.isBefore(rangeFrom)) s = rangeFrom;
            if (e.isAfter(rangeTo)) e = rangeTo;
            if (e.isBefore(s)) {
                continue;
            }
            /* 估时与工时统一按账号归属；没有账号时回落到负责人文本 */
            String key;
            String name;
            if (t.getOwnerUserId() != null && !t.getOwnerUserId().isEmpty()) {
                key = "u:" + t.getOwnerUserId();
                name = nameOfUser(t.getOwnerUserId(), t.getOwner());
            } else {
                name = t.getOwner() == null || t.getOwner().isEmpty() ? "未分配" : t.getOwner();
                key = "n:" + name;
            }
            nameByKey.put(key, name);
            GanttLoadResponse.Member m = members.get(key);
            if (m == null) {
                m = new GanttLoadResponse.Member();
                m.setName(name);
                members.put(key, m);
            }
            int totalWork = workingDays(t.getStartDate() == null ? s : t.getStartDate(),
                    t.getDueDate() == null ? e : t.getDueDate());
            if (totalWork <= 0) {
                totalWork = 1;
            }
            for (LocalDate week : weeks) {
                LocalDate ws = week, we = week.plusDays(6);
                LocalDate is = s.isAfter(ws) ? s : ws;
                LocalDate ie = e.isBefore(we) ? e : we;
                if (ie.isBefore(is)) {
                    continue;
                }
                int wd = workingDays(is, ie);
                if (wd <= 0) {
                    continue;
                }
                int est = (int) Math.round(t.getEstimateMinutes() * 1.0 * wd / totalWork);
                bucket(m, week).setEstimateMinutes(bucket(m, week).getEstimateMinutes() + est);
            }
        }

        /* 实际工时：按计时人 + 周汇总（只查统计区间，避免整空间全量加载） */
        for (TimeLog log : timeLogMapper.selectByWorkspaceBetween(workspaceId,
                rangeFrom.minusDays(6).atStartOfDay(), rangeTo.plusDays(1).atStartOfDay())) {
            if (log.getStartedAt() == null || log.getMinutes() == null) {
                continue;
            }
            LocalDate d = log.getStartedAt().toLocalDate();
            if (d.isBefore(rangeFrom.minusDays(6)) || d.isAfter(rangeTo)) {
                continue;
            }
            LocalDate week = mondayOf(d);
            if (week.isBefore(weeks.get(0)) || week.isAfter(weeks.get(weeks.size() - 1))) {
                continue;
            }
            String key;
            String name;
            if (log.getUserId() != null && !log.getUserId().isEmpty()) {
                key = "u:" + log.getUserId();
                name = nameByKey.get(key);
                if (name == null) {
                    name = nameOfUser(log.getUserId(), null);
                    /* 账号行不存在时，尝试并到同名文本负责人那一行 */
                    if (members.containsKey("n:" + name)) {
                        key = "n:" + name;
                    }
                }
            } else {
                name = "未绑定账号";
                key = "n:" + name;
            }
            nameByKey.put(key, name);
            GanttLoadResponse.Member m = members.get(key);
            if (m == null) {
                m = new GanttLoadResponse.Member();
                m.setName(name);
                members.put(key, m);
            }
            bucket(m, week).setActualMinutes(bucket(m, week).getActualMinutes() + log.getMinutes());
        }

        List<GanttLoadResponse.Member> list = new ArrayList<GanttLoadResponse.Member>(members.values());
        /* 估算多的人排前面，便于一眼看到谁最忙 */
        Collections.sort(list, new Comparator<GanttLoadResponse.Member>() {
            @Override
            public int compare(GanttLoadResponse.Member a, GanttLoadResponse.Member b) {
                return sumEstimate(b) - sumEstimate(a);
            }
        });

        GanttLoadResponse resp = new GanttLoadResponse();
        resp.setFrom(rangeFrom.toString());
        resp.setTo(rangeTo.toString());
        resp.setWeeks(weeks);
        resp.setMembers(list);
        return resp;
    }

    /** 负载行的显示名：账号优先，取不到时回落到任务上的负责人文本 */
    private String nameOfUser(String userId, String fallback) {
        AppUser u = userId == null ? null : userMapper.selectById(userId);
        if (u != null) {
            if (u.getDisplayName() != null && !u.getDisplayName().trim().isEmpty()) {
                return u.getDisplayName().trim();
            }
            if (u.getUsername() != null && !u.getUsername().trim().isEmpty()) {
                return u.getUsername().trim();
            }
        }
        return fallback == null || fallback.trim().isEmpty() ? "未绑定账号" : fallback.trim();
    }

    private int sumEstimate(GanttLoadResponse.Member m) {        int sum = 0;
        for (GanttLoadResponse.Bucket b : m.getBuckets()) {
            sum += b.getEstimateMinutes();
        }
        return sum;
    }

    /** 每个成员每个桶只建一次，未访问的桶补空 */
    private GanttLoadResponse.Bucket bucket(GanttLoadResponse.Member m, LocalDate week) {
        for (GanttLoadResponse.Bucket b : m.getBuckets()) {
            if (week.equals(b.getWeekStart())) {
                return b;
            }
        }
        GanttLoadResponse.Bucket b = new GanttLoadResponse.Bucket();
        b.setWeekStart(week);
        b.setCapacityMinutes(WEEK_CAPACITY_MINUTES);
        m.getBuckets().add(b);
        return b;
    }

    private static LocalDate mondayOf(LocalDate d) {
        return d.minusDays(d.getDayOfWeek().getValue() - DayOfWeek.MONDAY.getValue());
    }

    private static int workingDays(LocalDate from, LocalDate to) {
        if (from == null || to == null || to.isBefore(from)) {
            return 0;
        }
        int days = 0;
        for (LocalDate d = from; !d.isAfter(to); d = d.plusDays(1)) {
            DayOfWeek w = d.getDayOfWeek();
            if (w != DayOfWeek.SATURDAY && w != DayOfWeek.SUNDAY) {
                days++;
            }
        }
        return days;
    }

    /* ==================== 只读分享 ==================== */

    @Transactional
    public GanttShare createShare(String workspaceId) {
        GanttShare share = new GanttShare();
        share.setWorkspaceId(workspaceId);
        share.setToken(Ids.genToken());
        share.setCreatedAt(LocalDateTime.now());
        share.setExpiresAt(LocalDateTime.now().plusDays(SHARE_DAYS));
        shareMapper.upsert(share);
        return shareMapper.selectByWorkspace(workspaceId);
    }

    public GanttShare shareInfo(String workspaceId) {
        GanttShare share = shareMapper.selectByWorkspace(workspaceId);
        if (share != null && share.getExpiresAt() != null && share.getExpiresAt().isBefore(LocalDateTime.now())) {
            return null;
        }
        return share;
    }

    public void revokeShare(String workspaceId) {
        shareMapper.deleteByWorkspace(workspaceId);
    }

    /** 公开只读：按 token 返回，过滤敏感字段；token 无效或过期一律 404 */
    public GanttShareResponse publicShare(String token) {
        if (token == null || token.trim().isEmpty()) {
            throw AppException.notFound("分享链接无效或已过期");
        }
        GanttShare share = shareMapper.selectByToken(token.trim());
        if (share == null || (share.getExpiresAt() != null && share.getExpiresAt().isBefore(LocalDateTime.now()))) {
            throw AppException.notFound("分享链接无效或已过期");
        }
        Workspace ws = workspaceMapper.selectById(share.getWorkspaceId());
        if (ws == null) {
            throw AppException.notFound("分享链接无效或已过期");
        }
        List<Task> all = taskService.allWithExtras(share.getWorkspaceId());
        if (all.size() > LOAD_MAX_TASKS) {
            all = new ArrayList<Task>(all.subList(0, LOAD_MAX_TASKS));
        }
        List<PublicGanttTask> tasks = new ArrayList<PublicGanttTask>(all.size());
        Set<String> visibleIds = new HashSet<String>();
        for (Task t : all) {
            PublicGanttTask p = new PublicGanttTask();
            p.setId(t.getId());
            p.setTitle(t.getTitle());
            p.setPriority(t.getPriority());
            p.setOwner(t.getOwner());
            p.setBoardColumn(t.getBoardColumn());
            p.setStartDate(t.getStartDate());
            p.setDueDate(t.getDueDate());
            p.setProgress(t.getProgress());
            p.setIsMilestone(t.getIsMilestone());
            p.setBlocked(t.getBlocked());
            p.setEstimateMinutes(t.getEstimateMinutes());
            p.setTotalMinutes(t.getTotalMinutes());
            tasks.add(p);
            visibleIds.add(p.getId());
        }
        List<TaskDependency> deps = new ArrayList<TaskDependency>();
        for (TaskDependency d : dependencyMapper.selectByWorkspace(share.getWorkspaceId())) {
            if (visibleIds.contains(d.getFromTaskId()) && visibleIds.contains(d.getToTaskId())) {
                deps.add(d);
            }
        }
        Map<String, GanttResponse.BaselinePoint> baseline = new LinkedHashMap<String, GanttResponse.BaselinePoint>();
        for (Map.Entry<String, GanttResponse.BaselinePoint> e : baselineMap(share.getWorkspaceId()).entrySet()) {
            if (visibleIds.contains(e.getKey())) {
                baseline.put(e.getKey(), e.getValue());
            }
        }
        GanttShareResponse resp = new GanttShareResponse();
        resp.setWorkspaceName(ws.getName());
        resp.setGeneratedAt(LocalDateTime.now());
        resp.setBaselineAt(baselineMapper.selectCapturedAt(share.getWorkspaceId()));
        resp.setTasks(tasks);
        resp.setDeps(deps);
        resp.setBaseline(baseline);
        return resp;
    }


}
