package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.common.Consts;
import com.hourglass.common.TaskCalc;
import com.hourglass.common.WorkTime;
import com.hourglass.dto.PageResult;
import com.hourglass.entity.Category;
import com.hourglass.entity.ProjectMemberRole;
import com.hourglass.entity.Requirement;
import com.hourglass.entity.Task;
import com.hourglass.entity.TimeAgg;
import com.hourglass.entity.TimeLog;
import com.hourglass.entity.WorkspaceMember;
import com.hourglass.mapper.ProjectMemberRoleMapper;
import com.hourglass.mapper.RequirementMapper;
import com.hourglass.mapper.TaskMapper;
import com.hourglass.mapper.TimeLogMapper;
import com.hourglass.mapper.WorkspaceMemberMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.time.Clock;
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
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** 管理组只读聚合与站内催办。 */
@Service
public class ManagerService {

    /** 与 WorkTime 的每日上限统一：默认 8 小时 × 标准工作日 */
    public static final int DAILY_CAPACITY_MINUTES = WorkTime.MAX_MINUTES_PER_DAY;

    private static final int DEFAULT_WORKDAYS = 5;
    private static final int MIN_WORKDAYS = 1;
    /* 负载容量按“今天到最晚截止日”的工作日折算，最多算 30 个工作日（约 6 周）：
       再远的截止日不再摊薄负载，避免长排期被永久判成低负载。 */
    private static final int MAX_WORKDAYS = 30;
    private static final int BURNDOWN_DAYS = 14;
    private static final int VELOCITY_WEEKS = 4;
    private static final int FLOW_WEEKS = 8;
    private static final int DEFECT_WEEKS = 8;
    private static final int PROJECT_WEEKS = 8;
    private static final int WEEK_DAYS = 7;
    /** 手机端团队视图的区间上限：再长就退化成「全部历史」，快照与七日格表格都吃不消 */
    private static final int MAX_RANGE_DAYS = 92;
    private static final int STAGNANT_DAYS = 7;
    private static final int RED_OVERDUE_PERCENT = 10;
    private static final int PERCENT = 100;
    private static final int MAX_NUDGES = 100;
    private static final int DRILL_MAX_LIMIT = 100;
    private static final String UNASSIGNED_KEY = "unassigned";
    private static final String UNASSIGNED_NAME = "未指派";
    private static final String UNCATEGORIZED_NAME = "未归类";
    private static final String UNSET_FILTER = "__unset__";

    private final TaskMapper taskMapper;
    private final RequirementMapper requirementMapper;
    private final TimeLogMapper timeLogMapper;
    private final WorkspaceMemberMapper memberMapper;
    private final AppNotificationService notificationService;
    private final ProjectAccessService projectAccess;
    private final CategoryService categoryService;
    private final ReleasePermissionService releasePermission;
    private final Clock clock;

    /** 展示标签可选注入，保留已有构造器与调用方；不参与鉴权。 */
    @Autowired(required = false)
    private ProjectMemberRoleMapper roleMapper;

    @Autowired
    public ManagerService(TaskMapper taskMapper, RequirementMapper requirementMapper,
                          TimeLogMapper timeLogMapper, WorkspaceMemberMapper memberMapper,
                          AppNotificationService notificationService, ProjectAccessService projectAccess,
                          CategoryService categoryService, ReleasePermissionService releasePermission) {
        this(taskMapper, requirementMapper, timeLogMapper, memberMapper, notificationService,
                projectAccess, categoryService, releasePermission, Clock.systemDefaultZone());
    }

    ManagerService(TaskMapper taskMapper, RequirementMapper requirementMapper,
                   TimeLogMapper timeLogMapper, WorkspaceMemberMapper memberMapper,
                   AppNotificationService notificationService, ProjectAccessService projectAccess,
                   CategoryService categoryService, ReleasePermissionService releasePermission, Clock clock) {
        this.taskMapper = taskMapper;
        this.requirementMapper = requirementMapper;
        this.timeLogMapper = timeLogMapper;
        this.memberMapper = memberMapper;
        this.notificationService = notificationService;
        this.projectAccess = projectAccess;
        this.categoryService = categoryService;
        this.releasePermission = releasePermission;
        this.clock = clock;
    }

    public Map<String, Object> portfolio(String workspaceId, String userId) {
        LocalDate today = today();
        LocalDate weekStart = mondayOf(today);
        Snapshot snapshot = load(workspaceId, weekStart, weekStart.plusWeeks(1), userId);
        Map<String, String> reqNames = requirementNames(snapshot.requirements);

        List<Map<String, Object>> projects = new ArrayList<Map<String, Object>>();
        int activeProjects = 0;
        for (Requirement requirement : snapshot.requirements) {
            if ("active".equals(requirement.getStatus())) {
                activeProjects++;
            }
            List<Task> projectTasks = tasksForReq(snapshot.tasks, requirement.getId());
            projects.add(projectCard(requirement, projectTasks, snapshot, today));
        }

        Map<String, Object> kpis = new LinkedHashMap<String, Object>();
        kpis.put("activeProjects", activeProjects);
        kpis.put("overdueTasks", countTasks(snapshot.tasks, today).overdue);
        kpis.put("weekCompleted", completedBetween(snapshot.tasks, weekStart, weekStart.plusWeeks(1)).size());
        kpis.put("weekWorkMinutes", sumLogs(snapshot.logs));
        Map<String, Integer> weekWorkByTask = new LinkedHashMap<String, Integer>();
        for (TimeLog log : snapshot.logs) {
            if (log != null && hasText(log.getTaskId())) {
                Integer current = weekWorkByTask.get(log.getTaskId());
                weekWorkByTask.put(log.getTaskId(), (current == null ? 0 : current) + minutes(log.getMinutes()));
            }
        }

        Map<String, Object> result = new LinkedHashMap<String, Object>();
        result.put("today", today);
        result.put("kpis", kpis);
        result.put("weekWorkByTask", weekWorkByTask);
        result.put("projects", projects);
        result.put("tasks", taskMaps(snapshot.tasks, reqNames));
        return result;
    }

    public Map<String, Object> project(String workspaceId, String reqId, String userId) {
        LocalDate today = today();
        LocalDate weekStart = mondayOf(today);
        Snapshot snapshot = load(workspaceId, weekStart, weekStart.plusWeeks(1), userId);
        Requirement requirement = requireProject(snapshot.requirements, reqId);
        List<Task> tasks = tasksForReq(snapshot.tasks, requirement.getId());
        Counts counts = countTasks(tasks, today);

        Map<String, Object> project = new LinkedHashMap<String, Object>();
        project.put("id", requirement.getId());
        project.put("reqId", requirement.getId());
        project.put("name", requirement.getName());
        project.put("description", requirement.getDescription());
        project.put("objective", requirement.getObjective());
        project.put("status", requirement.getStatus());
        project.put("ownerUserId", requirement.getOwnerUserId());
        project.put("ownerName", memberDisplayName(snapshot.members, requirement.getOwnerUserId()));
        project.put("plannedStart", requirement.getPlannedStart());
        project.put("plannedEnd", requirement.getPlannedEnd());
        project.put("archivedAt", requirement.getArchivedAt());
        project.put("firstReleasedAt", requirement.getFirstReleasedAt());
        project.put("createdAt", requirement.getCreatedAt());
        project.put("updatedAt", requirement.getUpdatedAt());

        Map<String, Object> metrics = new LinkedHashMap<String, Object>();
        metrics.put("startDate", minStartDate(tasks));
        metrics.put("dueDate", maxDueDate(tasks));
        metrics.putAll(metricTotals(tasks));

        /* 模块统计与项目统计共用同一批任务和同一套公式：Σ模块 + 未指定 = 项目合计 */
        List<Category> modules = categoryService.list(workspaceId, requirement.getId());
        Set<String> moduleIds = new HashSet<String>();
        for (Category category : modules) {
            moduleIds.add(category.getId());
        }
        Map<String, List<Task>> grouped = new HashMap<String, List<Task>>();
        List<Task> unassignedTasks = new ArrayList<Task>();
        for (Task task : tasks) {
            String categoryId = task.getCategoryId();
            if (!hasText(categoryId) || !moduleIds.contains(categoryId)) {
                unassignedTasks.add(task);
                continue;
            }
            List<Task> bucket = grouped.get(categoryId);
            if (bucket == null) {
                bucket = new ArrayList<Task>();
                grouped.put(categoryId, bucket);
            }
            bucket.add(task);
        }
        List<Map<String, Object>> moduleStats = new ArrayList<Map<String, Object>>();
        for (Category category : modules) {
            List<Task> moduleTasks = grouped.get(category.getId());
            Map<String, Object> row = new LinkedHashMap<String, Object>();
            row.put("id", category.getId());
            row.put("name", category.getName());
            row.put("color", category.getColor());
            row.put("sortOrder", category.getSortOrder());
            row.putAll(bucketMetrics(moduleTasks == null ? Collections.<Task>emptyList() : moduleTasks, today));
            moduleStats.add(row);
        }

        Map<String, Object> result = new LinkedHashMap<String, Object>();
        result.put("today", today);
        result.put("project", project);
        result.put("metrics", metrics);
        result.put("counts", countsMap(counts));
        result.put("modules", moduleStats);
        result.put("unassigned", bucketMetrics(unassignedTasks, today));
        result.put("canManageModules", releasePermission.canManageProject(
                userId, workspaceId, requirement.getId()));
        result.put("weekly", weekly(tasks, today));
        result.put("epics", epics(tasks));
        RoleContext roles = roleContext(workspaceId, Collections.singletonList(requirement), snapshot.members);
        List<Map<String, Object>> members = projectMembers(tasks, snapshot.members, snapshot.logs, today);
        Map<String, MemberAccumulator> owners = memberAccumulators(openTasks(tasks), snapshot.members);
        for (Map<String, Object> row : members) {
            MemberAccumulator owner = owners.get(row.get("key"));
            putMemberLabels(row, memberLabels(roles, requirement.getId(), memberUserId(owner, roles)));
        }
        result.put("members", members);
        result.put("capacityMinutesPerDay", DAILY_CAPACITY_MINUTES);
        result.put("tasks", taskMaps(tasks, requirementNames(snapshot.requirements)));
        return result;
    }

    public Map<String, Object> reports(String workspaceId, String reqId, String userId) {
        return reports(workspaceId, reqId, userId, null, null);
    }

    public Map<String, Object> reports(String workspaceId, String reqId, String userId,
                                       String roleTitle, String companyName) {
        DisplayFilter filter = displayFilter(reqId, roleTitle, companyName);
        LocalDate today = today();
        Snapshot snapshot = load(workspaceId, null, null, userId);
        List<Requirement> requirements = scopedRequirements(snapshot, filter.reqId);
        RoleContext roles = roleContext(workspaceId, requirements, snapshot.members);
        List<Task> baseTasks = filter.reqId == null ? snapshot.tasks : tasksForReq(snapshot.tasks, filter.reqId);
        Map<String, Object> options = filterOptions(baseTasks, roles);
        List<Task> tasks = filterTasks(baseTasks, roles, filter);

        Map<String, Object> result = new LinkedHashMap<String, Object>();
        result.put("burndown", burndown(tasks, today));
        result.put("velocity", velocity(tasks, today));
        result.put("flow", flow(tasks, today));
        result.put("delivery", delivery(tasks));
        result.put("defects", defects(tasks, today));
        putFilterMetadata(result, options, filter);
        return result;
    }

    /**
     * 交付图表下钻：与 reports 共用同一批任务和筛选标签，按图表口径挑出明细后分页。
     * 图表本身由后台按同一范围重算，这里只是把参与该点的任务列出来。
     */
    public PageResult<Map<String, Object>> reportTasks(String workspaceId, String userId,
                                                       String reqId, String roleTitle, String companyName,
                                                       String chart, String weekStart, String state,
                                                       String bucket, String date,
                                                       Integer offset, Integer limit) {
        DisplayFilter filter = displayFilter(reqId, roleTitle, companyName);
        Snapshot snapshot = load(workspaceId, null, null, userId);
        List<Requirement> requirements = scopedRequirements(snapshot, filter.reqId);
        RoleContext roles = roleContext(workspaceId, requirements, snapshot.members);
        List<Task> baseTasks = filter.reqId == null ? snapshot.tasks : tasksForReq(snapshot.tasks, filter.reqId);
        List<Task> tasks = filterTasks(baseTasks, roles, filter);

        String kind = chart == null ? "" : chart.trim();
        List<Task> matched = new ArrayList<Task>();
        if ("velocity".equals(kind)) {
            LocalDate start = requiredDate(weekStart, "weekStart");
            matched = completedBetween(tasks, start, start.plusDays(WEEK_DAYS));
            sortByCompletedDesc(matched);
        } else if ("flow".equals(kind)) {
            LocalDate start = requiredDate(weekStart, "weekStart");
            LocalDate weekEnd = start.plusDays(WEEK_DAYS - 1L);
            String expected = state == null ? "" : state.trim();
            if (!"done".equals(expected) && !"ended".equals(expected)
                    && !"doing".equals(expected) && !"backlog".equals(expected)) {
                throw AppException.badRequest("不支持的累积流状态");
            }
            for (Task task : tasks) {
                if (expected.equals(flowState(task, weekEnd))) {
                    matched.add(task);
                }
            }
        } else if ("delivery".equals(kind)) {
            String expected = bucket == null ? "" : bucket.trim();
            if (expected.isEmpty()) {
                throw AppException.badRequest("缺少交付周期分桶");
            }
            for (Task task : tasks) {
                Long days = deliveryDays(task);
                if (days != null && expected.equals(deliveryBucketLabel(days))) {
                    matched.add(task);
                }
            }
            sortByCompletedDesc(matched);
        } else if ("defects".equals(kind)) {
            LocalDate start = requiredDate(weekStart, "weekStart");
            LocalDate end = start.plusDays(WEEK_DAYS - 1L);
            String expected = state == null ? "" : state.trim();
            if (!"opened".equals(expected) && !"closed".equals(expected) && !"open".equals(expected)) {
                throw AppException.badRequest("不支持的缺陷口径");
            }
            for (Task task : tasks) {
                if (!"bug".equals(task.getItemType())) {
                    continue;
                }
                LocalDate created = date(task.getCreatedAt());
                LocalDate completed = task.getCompletedAt();
                if ("opened".equals(expected) && created != null
                        && !created.isBefore(start) && !created.isAfter(end)) {
                    matched.add(task);
                } else if ("closed".equals(expected) && completed != null
                        && !completed.isBefore(start) && !completed.isAfter(end)) {
                    matched.add(task);
                } else if ("open".equals(expected) && created != null && !created.isAfter(end)
                        && (completed == null || completed.isAfter(end))) {
                    matched.add(task);
                }
            }
            if ("opened".equals(expected) || "open".equals(expected)) {
                sortByCreatedDesc(matched);
            } else {
                sortByCompletedDesc(matched);
            }
        } else if ("burn".equals(kind)) {
            LocalDate point = requiredDate(date, "date");
            for (Task task : tasks) {
                if (isDone(task) && task.getCompletedAt() != null
                        && !task.getCompletedAt().isAfter(point)) {
                    matched.add(task);
                }
            }
            sortByCompletedDesc(matched);
        } else {
            throw AppException.badRequest("不支持的图表下钻");
        }

        int safeOffset = Math.max(0, offset == null ? 0 : offset);
        int safeLimit = limit == null || limit <= 0 ? DRILL_MAX_LIMIT : Math.min(limit, DRILL_MAX_LIMIT);
        int total = matched.size();
        List<Task> pageTasks = safeOffset >= total ? Collections.<Task>emptyList()
                : matched.subList(safeOffset, Math.min(total, safeOffset + safeLimit));
        return PageResult.of(taskMaps(pageTasks, requirementNames(requirements)),
                total, safeOffset, safeLimit);
    }

    public Map<String, Object> workload(String workspaceId, String userId) {
        return workload(workspaceId, userId, null, null);
    }

    /**
     * 成员负载。
     *
     * <p>周口径（{@code weekStart} / {@code dayMinutes} / {@code lastWeekMinutes}）始终按本周与上周计算，
     * 不传区间时与桌面端历史行为完全一致；传入 {@code rangeFrom}/{@code rangeTo} 时额外产出
     * {@code rangeMinutes}（成员在该区间内的实际计时）与 {@code rangeFrom}/{@code rangeTo}/{@code rangeWorkdays}，
     * 供手机端团队视图按「本月 / 近 30 天」等区间统计投入。区间超过 {@link #MAX_RANGE_DAYS} 天会被从终点往前截断。</p>
     */
    public Map<String, Object> workload(String workspaceId, String userId,
                                        LocalDate rangeFrom, LocalDate rangeTo) {
        return workload(workspaceId, userId, rangeFrom, rangeTo, null, null, null);
    }

    public Map<String, Object> workload(String workspaceId, String userId,
                                        String reqId, String roleTitle, String companyName) {
        return workload(workspaceId, userId, null, null, reqId, roleTitle, companyName);
    }

    public Map<String, Object> workload(String workspaceId, String userId,
                                        LocalDate rangeFrom, LocalDate rangeTo,
                                        String reqId, String roleTitle, String companyName) {
        DisplayFilter filter = displayFilter(reqId, roleTitle, companyName);
        LocalDate today = today();
        LocalDate weekStart = mondayOf(today);
        LocalDate[] range = normalizeRange(rangeFrom, rangeTo);
        LocalDate logFrom = weekStart.minusWeeks(1);
        LocalDate logBefore = weekStart.plusWeeks(1);
        if (range != null) {
            if (range[0].isBefore(logFrom)) {
                logFrom = range[0];
            }
            if (range[1].plusDays(1).isAfter(logBefore)) {
                logBefore = range[1].plusDays(1);
            }
        }
        Snapshot snapshot = load(workspaceId, logFrom, logBefore, userId);
        List<Requirement> requirements = scopedRequirements(snapshot, filter.reqId);
        RoleContext roles = roleContext(workspaceId, requirements, snapshot.members);
        List<Task> baseTasks = filter.reqId == null ? snapshot.tasks : tasksForReq(snapshot.tasks, filter.reqId);
        List<TimeLog> baseLogs = filter.reqId == null ? snapshot.logs : logsForTasks(snapshot.logs, baseTasks);
        Map<String, Object> options = filterOptions(baseTasks, roles);
        List<Task> tasks = filterTasks(baseTasks, roles, filter);
        // 计时按关联任务的负责人和项目标签裁剪，不能按计时人自己的角色裁剪。
        List<TimeLog> logs = filter.hasMemberFilter() ? logsForTasks(baseLogs, tasks) : baseLogs;
        Map<String, String> reqNames = requirementNames(requirements);
        LinkedHashMap<String, MemberAccumulator> accumulators = memberAccumulators(openTasks(tasks), snapshot.members);
        includeLoggedMembers(accumulators, logs, snapshot.members);

        List<Map<String, Object>> projects = new ArrayList<Map<String, Object>>();
        for (Requirement requirement : requirements) {
            Map<String, Object> item = new LinkedHashMap<String, Object>();
            item.put("id", requirement.getId());
            item.put("name", requirement.getName());
            projects.add(item);
        }

        Map<String, Task> tasksById = new HashMap<String, Task>();
        for (Task task : tasks) {
            tasksById.put(task.getId(), task);
        }

        List<Map<String, Object>> members = new ArrayList<Map<String, Object>>();
        for (MemberAccumulator member : accumulators.values()) {
            Map<String, Object> item = workloadMember(member, logs, weekStart, today, reqNames, tasksById);
            putWorkloadLabels(item, member, roles, filter.reqId, logs, tasksById);
            if (range != null) {
                item.put("rangeMinutes", minutesInRange(member.userId, logs, range[0], range[1]));
            }
            members.add(item);
        }

        Map<String, Object> result = new LinkedHashMap<String, Object>();
        result.put("capacityMinutesPerDay", DAILY_CAPACITY_MINUTES);
        result.put("workdays", DEFAULT_WORKDAYS);
        result.put("weekStart", weekStart.toString());
        result.put("lastWeekStart", weekStart.minusWeeks(1).toString());
        if (range != null) {
            result.put("rangeFrom", range[0].toString());
            result.put("rangeTo", range[1].toString());
            result.put("rangeWorkdays", countWorkdays(range[0], range[1]));
        }
        result.put("projects", projects);
        result.put("members", members);
        putFilterMetadata(result, options, filter);
        return result;
    }

    public Map<String, Object> risks(String workspaceId, String userId) {
        return risksFromSnapshot(load(workspaceId, null, null, userId), today());
    }

    /** 手机团队页一次加载任务与风险，避免同一请求内重复全量查询。 */
    public Map<String, Object> mobileTeamSnapshot(String workspaceId, String userId) {
        Snapshot snapshot = load(workspaceId, null, null, userId);
        Map<String, Object> result = new LinkedHashMap<String, Object>();
        result.put("tasks", snapshot.tasks);
        result.put("risks", risksFromSnapshot(snapshot, today()));
        return result;
    }

    private Map<String, Object> risksFromSnapshot(Snapshot snapshot, LocalDate today) {
        Map<String, String> reqNames = requirementNames(snapshot.requirements);
        List<Task> overdue = new ArrayList<Task>();
        List<Task> blocked = new ArrayList<Task>();
        List<Task> stagnant = new ArrayList<Task>();
        Set<String> riskIds = new LinkedHashSet<String>();

        for (Task task : snapshot.tasks) {
            if (isDone(task)) {
                continue;
            }
            boolean risk = false;
            if (isOverdue(task, today)) {
                overdue.add(task);
                risk = true;
            }
            if (Boolean.TRUE.equals(task.getBlocked())) {
                blocked.add(task);
                risk = true;
            }
            if (isStagnant(task, today)) {
                stagnant.add(task);
                risk = true;
            }
            if (risk) {
                riskIds.add(task.getId());
            }
        }

        Comparator<Task> severityDate = severityDateComparator();
        Collections.sort(overdue, severityDate);
        Collections.sort(blocked, severityDate);
        Collections.sort(stagnant, new Comparator<Task>() {
            @Override
            public int compare(Task left, Task right) {
                int severity = Integer.compare(priorityRank(left.getPriority()), priorityRank(right.getPriority()));
                if (severity != 0) {
                    return severity;
                }
                int date = compareNullable(updatedDate(left), updatedDate(right));
                return date != 0 ? date : compareNullable(left.getId(), right.getId());
            }
        });

        List<Map<String, Object>> overloaded = new ArrayList<Map<String, Object>>();
        LinkedHashMap<String, MemberAccumulator> members = memberAccumulators(openTasks(snapshot.tasks), snapshot.members);
        for (MemberAccumulator member : members.values()) {
            int remainingMinutes = remaining(member.tasks);
            int workdays = workdays(member.latestDue, today);
            int loadPct = loadPct(remainingMinutes, workdays);
            if (loadPct > PERCENT) {
                Map<String, Object> item = new LinkedHashMap<String, Object>();
                item.put("key", member.key);
                item.put("name", member.name);
                item.put("loadPct", loadPct);
                item.put("remainingMinutes", remainingMinutes);
                overloaded.add(item);
            }
        }
        Collections.sort(overloaded, new Comparator<Map<String, Object>>() {
            @Override
            public int compare(Map<String, Object> left, Map<String, Object> right) {
                return Integer.compare((Integer) right.get("loadPct"), (Integer) left.get("loadPct"));
            }
        });

        Map<String, Object> result = new LinkedHashMap<String, Object>();
        result.put("today", today);
        result.put("overdue", taskMaps(overdue, reqNames));
        result.put("blocked", taskMaps(blocked, reqNames));
        result.put("stagnant", taskMaps(stagnant, reqNames));
        result.put("overloaded", overloaded);
        result.put("total", riskIds.size());
        return result;
    }

    public Map<String, Object> nudges(String workspaceId, String userId, List<String> taskIds) {
        if (!projectAccess.canManage(workspaceId, userId)) {
            throw new AppException(403, "仅空间主或管理员可发起催办");
        }
        if (taskIds == null || taskIds.isEmpty()) {
            throw AppException.badRequest("taskIds 不能为空");
        }
        if (taskIds.size() > MAX_NUDGES) {
            throw AppException.badRequest("单次最多催办 " + MAX_NUDGES + " 个任务");
        }
        LinkedHashSet<String> uniqueIds = new LinkedHashSet<String>();
        for (String taskId : taskIds) {
            if (!hasText(taskId)) {
                throw AppException.badRequest("taskIds 不能包含空值");
            }
            uniqueIds.add(taskId.trim());
        }

        Set<String> hiddenReqs = projectAccess.hiddenProjectIds(workspaceId, userId);
        Map<String, Task> tasksById = new HashMap<String, Task>();
        for (Task task : emptyIfNull(taskMapper.selectAll(workspaceId))) {
            if (task.getDeletedAt() != null) {
                continue;
            }
            if (task.getReqId() != null && hiddenReqs.contains(task.getReqId())) {
                continue;
            }
            tasksById.put(task.getId(), task);
        }
        List<Task> selected = new ArrayList<Task>();
        for (String taskId : uniqueIds) {
            Task task = tasksById.get(taskId);
            if (task == null) {
                throw AppException.badRequest("任务不存在或不属于当前空间：" + taskId);
            }
            if (isDone(task)) {
                throw AppException.badRequest("只能催办未完成任务：" + taskId);
            }
            selected.add(task);
        }

        List<WorkspaceMember> members = emptyIfNull(memberMapper.selectByWorkspace(workspaceId));
        Map<String, WorkspaceMember> membersById = membersById(members);
        Map<String, String> userIdsByName = userIdsByName(members);
        LocalDate today = today();
        int sent = 0;
        int skipped = 0;
        int deduped = 0;
        for (Task task : selected) {
            String ownerUserId = null;
            if (hasText(task.getOwnerUserId())) {
                WorkspaceMember member = membersById.get(task.getOwnerUserId().trim());
                ownerUserId = member == null ? null : member.getUserId();
            } else if (hasText(task.getOwner())) {
                ownerUserId = userIdsByName.get(task.getOwner().trim());
            }
            if (ownerUserId == null) {
                skipped++;
                continue;
            }
            /* 接收人也必须当前可见该任务/项目，避免向被设为 none 的成员泄露标题与逾期原因 */
            if (!projectAccess.canViewTask(workspaceId, ownerUserId, task)) {
                skipped++;
                continue;
            }
            /* 同一任务 6 小时内已催办过会被去重：不计入「已发送」，单独返回，避免提示虚高 */
            if (notificationService.push(ownerUserId, workspaceId, "manager_nudge",
                    "管理催办：" + safe(task.getTitle()), nudgeBody(task, today), task.getId())) {
                sent++;
            } else {
                deduped++;
            }
        }

        Map<String, Object> result = new LinkedHashMap<String, Object>();
        result.put("sent", sent);
        result.put("skipped", skipped);
        result.put("deduped", deduped);
        return result;
    }

    private Map<String, Object> projectCard(Requirement requirement, List<Task> tasks,
                                            Snapshot snapshot, LocalDate today) {
        Counts counts = countTasks(tasks, today);
        LocalDate lastCompletedAt = lastCompletedAt(tasks);
        int stagnantDays = stagnantDays(tasks, lastCompletedAt, today);
        List<Map<String, Object>> members = projectMembers(tasks, snapshot.members, snapshot.logs, today);
        int overloadedMembers = 0;
        LinkedHashSet<String> ownerNames = new LinkedHashSet<String>();
        Map<String, WorkspaceMember> membersById = membersById(snapshot.members);
        for (Map<String, Object> member : members) {
            if (Boolean.TRUE.equals(member.get("overloaded"))) {
                overloadedMembers++;
            }
        }
        for (Task task : tasks) {
            String ownerName = ownerName(task, membersById);
            if (hasText(ownerName)) {
                ownerNames.add(ownerName.trim());
            }
        }

        boolean red = counts.total > 0
                && counts.overdue * PERCENT > counts.total * RED_OVERDUE_PERCENT
                && stagnantDays >= STAGNANT_DAYS;
        String health = red ? "red" : (counts.overdue > 0 || overloadedMembers > 0 ? "orange" : "green");
        Set<String> taskIds = taskIds(tasks);
        int weekWorkMinutes = 0;
        for (TimeLog log : snapshot.logs) {
            if (log != null && taskIds.contains(log.getTaskId())) {
                weekWorkMinutes += minutes(log.getMinutes());
            }
        }

        Map<String, Object> item = new LinkedHashMap<String, Object>();
        item.put("reqId", requirement.getId());
        item.put("name", requirement.getName());
        item.put("status", requirement.getStatus());
        item.put("health", health);
        item.put("total", counts.total);
        item.put("backlog", counts.backlog);
        item.put("doing", counts.doing);
        item.put("ended", counts.ended);
        item.put("done", counts.done);
        item.put("overdue", counts.overdue);
        item.put("blocked", counts.blocked);
        item.put("progressPct", averageProgress(tasks));
        item.put("estimateMinutes", sumEstimate(tasks));
        item.put("actualMinutes", sumActual(tasks));
        item.put("weekCompleted", completedBetween(tasks, mondayOf(today), mondayOf(today).plusWeeks(1)).size());
        item.put("weekWorkMinutes", weekWorkMinutes);
        item.put("lastCompletedAt", lastCompletedAt);
        item.put("stagnantDays", stagnantDays);
        item.put("overloadedMembers", overloadedMembers);
        item.put("members", new ArrayList<String>(ownerNames));
        return item;
    }

    private List<Map<String, Object>> projectMembers(List<Task> tasks, List<WorkspaceMember> workspaceMembers,
                                                     List<TimeLog> logs, LocalDate today) {
        LinkedHashMap<String, MemberAccumulator> members = memberAccumulators(openTasks(tasks), workspaceMembers);
        Set<String> projectTaskIds = taskIds(tasks);
        List<Map<String, Object>> result = new ArrayList<Map<String, Object>>();
        for (MemberAccumulator member : members.values()) {
            int remainingMinutes = remaining(member.tasks);
            int workdays = workdays(member.latestDue, today);
            int loadPct = loadPct(remainingMinutes, workdays);
            Map<String, Object> item = new LinkedHashMap<String, Object>();
            item.put("key", member.key);
            item.put("name", member.name);
            item.put("remainingMinutes", remainingMinutes);
            item.put("actualWeekMinutes", actualMinutes(member.userId, projectTaskIds, logs));
            item.put("taskCount", member.tasks.size());
            item.put("loadPct", loadPct);
            item.put("overloaded", loadPct > PERCENT);
            result.add(item);
        }
        return result;
    }

    private Map<String, Object> workloadMember(MemberAccumulator member, List<TimeLog> logs,
                                               LocalDate weekStart, LocalDate today,
                                               Map<String, String> reqNames,
                                               Map<String, Task> tasksById) {
        int remainingMinutes = remaining(member.tasks);
        int workdays = workdays(member.latestDue, today);
        int loadPct = loadPct(remainingMinutes, workdays);
        int weekMinutes = 0;
        int lastWeekMinutes = 0;
        int[] dayMinutes = new int[WEEK_DAYS];
        List<Map<String, Object>> weekLogs = new ArrayList<Map<String, Object>>();
        List<Map<String, Object>> lastWeekLogs = new ArrayList<Map<String, Object>>();
        if (member.userId != null) {
            for (TimeLog log : logs) {
                if (log == null || !member.userId.equals(log.getUserId()) || log.getStartedAt() == null) {
                    continue;
                }
                LocalDate date = log.getStartedAt().toLocalDate();
                int value = minutes(log.getMinutes());
                if (!date.isBefore(weekStart) && date.isBefore(weekStart.plusWeeks(1))) {
                    weekMinutes += value;
                    dayMinutes[date.getDayOfWeek().getValue() - 1] += value;
                    weekLogs.add(weekLogRow(log, tasksById, reqNames));
                } else if (!date.isBefore(weekStart.minusWeeks(1)) && date.isBefore(weekStart)) {
                    lastWeekMinutes += value;
                    lastWeekLogs.add(weekLogRow(log, tasksById, reqNames));
                }
            }
        }
        sortLogsByDateDesc(weekLogs);
        sortLogsByDateDesc(lastWeekLogs);

        LinkedHashMap<String, MemberProject> projectGroups = new LinkedHashMap<String, MemberProject>();
        for (Task task : member.tasks) {
            String reqId = task.getReqId();
            String key = reqId == null ? "" : reqId;
            MemberProject group = projectGroups.get(key);
            if (group == null) {
                group = new MemberProject();
                group.reqId = reqId;
                group.name = reqNames.containsKey(reqId) ? reqNames.get(reqId) : UNCATEGORIZED_NAME;
                projectGroups.put(key, group);
            }
            group.taskCount++;
            group.remainingMinutes += remaining(task);
        }
        List<Map<String, Object>> projects = new ArrayList<Map<String, Object>>();
        for (MemberProject group : projectGroups.values()) {
            Map<String, Object> item = new LinkedHashMap<String, Object>();
            item.put("reqId", group.reqId);
            item.put("name", group.name);
            item.put("remainingMinutes", group.remainingMinutes);
            item.put("taskCount", group.taskCount);
            projects.add(item);
        }

        Map<String, Object> result = new LinkedHashMap<String, Object>();
        result.put("key", member.key);
        result.put("name", member.name);
        result.put("remainingMinutes", remainingMinutes);
        result.put("workdays", workdays);
        result.put("capacityMinutes", workdays * DAILY_CAPACITY_MINUTES);
        result.put("loadPct", loadPct);
        result.put("overloaded", loadPct > PERCENT);
        result.put("weekMinutes", weekMinutes);
        result.put("lastWeekMinutes", lastWeekMinutes);
        List<Integer> days = new ArrayList<Integer>(WEEK_DAYS);
        for (int value : dayMinutes) {
            days.add(value);
        }
        result.put("dayMinutes", days);
        result.put("projects", projects);
        result.put("tasks", taskMaps(member.tasks, reqNames));
        result.put("weekLogs", weekLogs);
        result.put("lastWeekLogs", lastWeekLogs);
        return result;
    }

    private void sortLogsByDateDesc(List<Map<String, Object>> logs) {
        Collections.sort(logs, new Comparator<Map<String, Object>>() {
            @Override
            public int compare(Map<String, Object> a, Map<String, Object> b) {
                return String.valueOf(b.get("date")).compareTo(String.valueOf(a.get("date")));
            }
        });
    }

    private Map<String, Object> weekLogRow(TimeLog log, Map<String, Task> tasksById,
                                           Map<String, String> reqNames) {
        Task task = log.getTaskId() == null ? null : tasksById.get(log.getTaskId());
        Map<String, Object> row = new LinkedHashMap<String, Object>();
        row.put("date", log.getStartedAt().toLocalDate().toString());
        row.put("taskId", log.getTaskId());
        row.put("title", task == null ? "未关联工作项" : task.getTitle());
        String reqName = task == null || task.getReqId() == null ? null : reqNames.get(task.getReqId());
        row.put("reqName", reqName == null ? UNCATEGORIZED_NAME : reqName);
        row.put("minutes", minutes(log.getMinutes()));
        row.put("origin", log.getOrigin());
        return row;
    }

    private LinkedHashMap<String, MemberAccumulator> memberAccumulators(List<Task> openTasks,
                                                                       List<WorkspaceMember> workspaceMembers) {
        Map<String, WorkspaceMember> membersById = membersById(workspaceMembers);
        Map<String, String> userIdsByName = userIdsByName(workspaceMembers);
        LinkedHashMap<String, MemberAccumulator> result = new LinkedHashMap<String, MemberAccumulator>();
        for (Task task : openTasks) {
            String key;
            String name;
            String userId = null;
            if (hasText(task.getOwnerUserId())) {
                key = task.getOwnerUserId().trim();
                WorkspaceMember workspaceMember = membersById.get(key);
                name = workspaceMember == null ? ownerName(task, membersById) : workspaceMember.getDisplayName();
                if (!hasText(name)) {
                    name = key;
                }
                if (workspaceMember != null) {
                    userId = key;
                }
            } else if (hasText(task.getOwner())) {
                name = task.getOwner().trim();
                userId = userIdsByName.get(name);
                /* 历史文本负责人能解析到成员时并入该账号：否则同一人一半任务按ID、一半按名字，
                   成员负载出现两行，两行又各按账号统计一遍工时（移动端合并后翻倍） */
                key = userId == null ? name : userId;
            } else {
                key = UNASSIGNED_KEY;
                name = UNASSIGNED_NAME;
            }
            MemberAccumulator member = result.get(key);
            if (member == null) {
                member = new MemberAccumulator();
                member.key = key;
                member.name = name;
                member.userId = userId;
                result.put(key, member);
            } else if (member.userId == null) {
                member.userId = userId;
            }
            member.tasks.add(task);
            if (task.getDueDate() != null
                    && (member.latestDue == null || task.getDueDate().isAfter(member.latestDue))) {
                member.latestDue = task.getDueDate();
            }
        }
        return result;
    }

    private void includeLoggedMembers(LinkedHashMap<String, MemberAccumulator> accumulators,
                                      List<TimeLog> logs, List<WorkspaceMember> workspaceMembers) {
        Map<String, WorkspaceMember> membersById = membersById(workspaceMembers);
        for (TimeLog log : logs) {
            if (log == null || !hasText(log.getUserId())) {
                continue;
            }
            String userId = log.getUserId().trim();
            WorkspaceMember workspaceMember = membersById.get(userId);
            if (workspaceMember == null || accumulators.containsKey(userId)) {
                continue;
            }
            MemberAccumulator member = new MemberAccumulator();
            member.key = userId;
            member.name = hasText(workspaceMember.getDisplayName()) ? workspaceMember.getDisplayName() : userId;
            member.userId = userId;
            accumulators.put(userId, member);
        }
    }

    private Map<String, Object> burndown(List<Task> tasks, LocalDate today) {
        int totalEstimateMinutes = sumEstimate(tasks);
        LocalDate first = today.minusDays(BURNDOWN_DAYS - 1L);
        List<Map<String, Object>> points = new ArrayList<Map<String, Object>>();
        for (int index = 0; index < BURNDOWN_DAYS; index++) {
            LocalDate date = first.plusDays(index);
            int completedActual = 0;
            for (Task task : tasks) {
                if (isDone(task) && task.getCompletedAt() != null && !task.getCompletedAt().isAfter(date)) {
                    completedActual += actual(task);
                }
            }
            int remainingMinutes = Math.max(0, totalEstimateMinutes - completedActual);
            int idealMinutes = (int) Math.round(totalEstimateMinutes
                    * (double) (BURNDOWN_DAYS - 1 - index) / (BURNDOWN_DAYS - 1));
            Map<String, Object> point = new LinkedHashMap<String, Object>();
            point.put("date", date);
            point.put("remainingMinutes", remainingMinutes);
            point.put("idealMinutes", idealMinutes);
            points.add(point);
        }
        Map<String, Object> result = new LinkedHashMap<String, Object>();
        result.put("totalEstimateMinutes", totalEstimateMinutes);
        result.put("remainingMinutes", points.get(points.size() - 1).get("remainingMinutes"));
        result.put("points", points);
        return result;
    }

    private Map<String, Object> velocity(List<Task> tasks, LocalDate today) {
        LocalDate currentWeek = mondayOf(today);
        List<Map<String, Object>> weeks = new ArrayList<Map<String, Object>>();
        int totalMinutes = 0;
        for (int index = VELOCITY_WEEKS - 1; index >= 0; index--) {
            LocalDate start = currentWeek.minusWeeks(index);
            List<Task> completed = completedBetween(tasks, start, start.plusWeeks(1));
            int completedMinutes = 0;
            for (Task task : completed) {
                completedMinutes += actual(task);
            }
            totalMinutes += completedMinutes;
            Map<String, Object> week = new LinkedHashMap<String, Object>();
            week.put("start", start);
            week.put("completedMinutes", completedMinutes);
            week.put("completedCount", completed.size());
            weeks.add(week);
        }
        Map<String, Object> result = new LinkedHashMap<String, Object>();
        result.put("averageMinutes", (int) Math.round(totalMinutes / (double) VELOCITY_WEEKS));
        result.put("weeks", weeks);
        return result;
    }

    private Map<String, Object> flow(List<Task> tasks, LocalDate today) {
        LocalDate currentWeek = mondayOf(today);
        List<Map<String, Object>> weeks = new ArrayList<Map<String, Object>>();
        for (int index = FLOW_WEEKS - 1; index >= 0; index--) {
            LocalDate start = currentWeek.minusWeeks(index);
            LocalDate weekEnd = start.plusDays(WEEK_DAYS - 1L);
            int backlog = 0;
            int doing = 0;
            int done = 0;
            int ended = 0;
            for (Task task : tasks) {
                String state = flowState(task, weekEnd);
                if (state == null) {
                    continue;
                }
                if ("done".equals(state)) {
                    done++;
                } else if ("ended".equals(state)) {
                    ended++;
                } else if ("doing".equals(state)) {
                    doing++;
                } else {
                    backlog++;
                }
            }
            Map<String, Object> week = new LinkedHashMap<String, Object>();
            week.put("start", start);
            week.put("backlog", backlog);
            week.put("doing", doing);
            week.put("ended", ended);
            week.put("done", done);
            weeks.add(week);
        }
        Map<String, Object> result = new LinkedHashMap<String, Object>();
        result.put("weeks", weeks);
        return result;
    }

    /** 某任务在周末时的累积流状态；尚未创建返回 null（与图表逐周快照同口径）。 */
    private String flowState(Task task, LocalDate weekEnd) {
        LocalDate created = date(task.getCreatedAt());
        if (created != null && created.isAfter(weekEnd)) {
            return null;
        }
        if (isDone(task) && (task.getCompletedAt() == null || !task.getCompletedAt().isAfter(weekEnd))) {
            return "done";
        }
        /* 完成日晚于该周的任务沿用原口径计待处理；其余只有当前列状态，按处理规则归类 */
        String bucket = isDone(task) ? "backlog"
                : TaskCalc.statusBucket(task.getBoardColumn(), task.getProcessingRule());
        if ("ended".equals(bucket)) {
            return "ended";
        }
        if ("doing".equals(bucket)) {
            return "doing";
        }
        return "backlog";
    }

    /** 缺陷趋势：按周统计新增、关闭与周末存量，只看 item_type=bug 的任务。 */
    private Map<String, Object> defects(List<Task> tasks, LocalDate today) {
        LocalDate currentWeek = mondayOf(today);
        List<Map<String, Object>> weeks = new ArrayList<Map<String, Object>>();
        for (int index = DEFECT_WEEKS - 1; index >= 0; index--) {
            LocalDate start = currentWeek.minusWeeks(index);
            LocalDate end = start.plusDays(WEEK_DAYS - 1L);
            int opened = 0;
            int closed = 0;
            int open = 0;
            for (Task task : tasks) {
                if (!"bug".equals(task.getItemType())) {
                    continue;
                }
                LocalDate created = date(task.getCreatedAt());
                LocalDate completed = task.getCompletedAt();
                if (created != null && !created.isBefore(start) && !created.isAfter(end)) {
                    opened++;
                }
                if (completed != null && !completed.isBefore(start) && !completed.isAfter(end)) {
                    closed++;
                }
                if (created != null && !created.isAfter(end)
                        && (completed == null || completed.isAfter(end))) {
                    open++;
                }
            }
            Map<String, Object> week = new LinkedHashMap<String, Object>();
            week.put("start", start);
            week.put("opened", opened);
            week.put("closed", closed);
            week.put("open", open);
            weeks.add(week);
        }
        Map<String, Object> result = new LinkedHashMap<String, Object>();
        result.put("openCount", weeks.get(weeks.size() - 1).get("open"));
        result.put("weeks", weeks);
        return result;
    }

    private Map<String, Object> delivery(List<Task> tasks) {
        List<Long> durations = new ArrayList<Long>();
        int lessThanOne = 0;
        int oneToThree = 0;
        int threeToSeven = 0;
        int moreThanSeven = 0;
        long totalDays = 0;
        for (Task task : tasks) {
            Long value = deliveryDays(task);
            if (value == null) {
                continue;
            }
            long days = value;
            durations.add(days);
            totalDays += days;
            String label = deliveryBucketLabel(days);
            if ("<1天".equals(label)) {
                lessThanOne++;
            } else if ("1-3天".equals(label)) {
                oneToThree++;
            } else if ("3-7天".equals(label)) {
                threeToSeven++;
            } else {
                moreThanSeven++;
            }
        }
        Collections.sort(durations);
        int count = durations.size();
        List<Map<String, Object>> buckets = new ArrayList<Map<String, Object>>();
        buckets.add(deliveryBucket("<1天", lessThanOne, count));
        buckets.add(deliveryBucket("1-3天", oneToThree, count));
        buckets.add(deliveryBucket("3-7天", threeToSeven, count));
        buckets.add(deliveryBucket(">7天", moreThanSeven, count));

        Map<String, Object> result = new LinkedHashMap<String, Object>();
        result.put("p50Days", percentile(durations, 0.50));
        result.put("p85Days", percentile(durations, 0.85));
        result.put("averageDays", count == 0 ? null : round1(totalDays / (double) count));
        result.put("buckets", buckets);
        return result;
    }

    private Map<String, Object> deliveryBucket(String label, int count, int total) {
        Map<String, Object> bucket = new LinkedHashMap<String, Object>();
        bucket.put("label", label);
        bucket.put("count", count);
        bucket.put("pct", total == 0 ? 0.0 : round1(count * (double) PERCENT / total));
        return bucket;
    }

    /** 交付周期天数：开始日期（空则创建日期）到完成日期；未完成或日期倒挂返回 null。 */
    private Long deliveryDays(Task task) {
        if (!isDone(task) || task.getCompletedAt() == null) {
            return null;
        }
        LocalDate start = task.getStartDate() != null ? task.getStartDate() : date(task.getCreatedAt());
        if (start == null) {
            return null;
        }
        long days = ChronoUnit.DAYS.between(start, task.getCompletedAt());
        return days < 0 ? null : Long.valueOf(days);
    }

    private String deliveryBucketLabel(long days) {
        if (days < 1) {
            return "<1天";
        }
        if (days < 3) {
            return "1-3天";
        }
        if (days <= 7) {
            return "3-7天";
        }
        return ">7天";
    }

    private void sortByCompletedDesc(List<Task> tasks) {
        Collections.sort(tasks, new Comparator<Task>() {
            @Override
            public int compare(Task a, Task b) {
                LocalDate left = a.getCompletedAt();
                LocalDate right = b.getCompletedAt();
                if (left == null && right == null) {
                    return 0;
                }
                if (left == null) {
                    return 1;
                }
                if (right == null) {
                    return -1;
                }
                return right.compareTo(left);
            }
        });
    }

    private void sortByCreatedDesc(List<Task> tasks) {
        Collections.sort(tasks, new Comparator<Task>() {
            @Override
            public int compare(Task a, Task b) {
                LocalDateTime left = a.getCreatedAt();
                LocalDateTime right = b.getCreatedAt();
                if (left == null && right == null) {
                    return 0;
                }
                if (left == null) {
                    return 1;
                }
                if (right == null) {
                    return -1;
                }
                return right.compareTo(left);
            }
        });
    }

    private LocalDate requiredDate(String value, String name) {
        if (!hasText(value)) {
            throw AppException.badRequest("缺少 " + name);
        }
        try {
            return LocalDate.parse(value.trim());
        } catch (java.time.format.DateTimeParseException ex) {
            throw AppException.badRequest(name + " 需为 yyyy-MM-dd");
        }
    }

    private Long percentile(List<Long> sorted, double quantile) {
        if (sorted.isEmpty()) {
            return null;
        }
        int rank = (int) Math.ceil(quantile * sorted.size());
        return sorted.get(Math.max(0, Math.min(sorted.size() - 1, rank - 1)));
    }

    private List<Map<String, Object>> weekly(List<Task> tasks, LocalDate today) {
        LocalDate currentWeek = mondayOf(today);
        List<Map<String, Object>> weeks = new ArrayList<Map<String, Object>>();
        for (int index = PROJECT_WEEKS - 1; index >= 0; index--) {
            LocalDate start = currentWeek.minusWeeks(index);
            LocalDate before = start.plusWeeks(1);
            int created = 0;
            int completed = 0;
            for (Task task : tasks) {
                LocalDate createdAt = date(task.getCreatedAt());
                if (createdAt != null && !createdAt.isBefore(start) && createdAt.isBefore(before)) {
                    created++;
                }
                if (isDone(task) && task.getCompletedAt() != null
                        && !task.getCompletedAt().isBefore(start) && task.getCompletedAt().isBefore(before)) {
                    completed++;
                }
            }
            Map<String, Object> week = new LinkedHashMap<String, Object>();
            week.put("start", start);
            week.put("created", created);
            week.put("completed", completed);
            weeks.add(week);
        }
        return weeks;
    }

    private List<Map<String, Object>> epics(List<Task> tasks) {
        List<Map<String, Object>> result = new ArrayList<Map<String, Object>>();
        for (Task epic : tasks) {
            if (!"epic".equals(epic.getItemType())) {
                continue;
            }
            int total = 0;
            int done = 0;
            for (Task child : tasks) {
                if (epic.getId() != null && epic.getId().equals(child.getEpicId())) {
                    total++;
                    if (isDone(child)) {
                        done++;
                    }
                }
            }
            Map<String, Object> item = new LinkedHashMap<String, Object>();
            item.put("id", epic.getId());
            item.put("title", epic.getTitle());
            item.put("total", total);
            item.put("done", done);
            item.put("progressPct", percent(done, total));
            result.add(item);
        }
        return result;
    }

    private Snapshot load(String workspaceId, LocalDate logFrom, LocalDate logBefore, String userId) {
        Snapshot snapshot = new Snapshot();
        Set<String> hiddenReqs = projectAccess.hiddenProjectIds(workspaceId, userId);
        List<Task> tasks = new ArrayList<Task>();
        for (Task task : emptyIfNull(taskMapper.selectAll(workspaceId))) {
            if (task.getDeletedAt() != null) {
                continue;
            }
            if (task.getReqId() == null || !hiddenReqs.contains(task.getReqId())) {
                tasks.add(task);
            }
        }
        snapshot.tasks = tasks;
        List<Requirement> requirements = new ArrayList<Requirement>();
        for (Requirement requirement : emptyIfNull(requirementMapper.selectAll(workspaceId))) {
            if (!hiddenReqs.contains(requirement.getId())) {
                requirements.add(requirement);
            }
        }
        snapshot.requirements = requirements;
        snapshot.members = emptyIfNull(memberMapper.selectByWorkspace(workspaceId));
        Set<String> visibleTaskIds = new HashSet<String>();
        for (Task task : tasks) {
            if (task.getId() != null) {
                visibleTaskIds.add(task.getId());
            }
        }
        List<TimeLog> allLogs = logFrom == null ? Collections.<TimeLog>emptyList()
                : emptyIfNull(timeLogMapper.selectByWorkspaceBetween(workspaceId,
                logFrom.atStartOfDay(), logBefore.atStartOfDay()));
        List<TimeLog> visibleLogs = new ArrayList<TimeLog>();
        for (TimeLog log : allLogs) {
            if (log == null) {
                continue;
            }
            if (log.getTaskId() == null || visibleTaskIds.contains(log.getTaskId())) {
                visibleLogs.add(log);
            }
        }
        snapshot.logs = visibleLogs;
        Map<String, Integer> actualByTask = new HashMap<String, Integer>();
        for (TimeAgg aggregate : emptyIfNull(timeLogMapper.sumByTaskByWorkspace(workspaceId))) {
            if (aggregate != null && aggregate.getTaskId() != null) {
                actualByTask.put(aggregate.getTaskId(), minutes(aggregate.getTotalMinutes()));
            }
        }
        for (Task task : snapshot.tasks) {
            Integer totalMinutes = actualByTask.get(task.getId());
            task.setTotalMinutes(totalMinutes == null ? 0 : totalMinutes);
        }
        return snapshot;
    }

    private DisplayFilter displayFilter(String reqId, String roleTitle, String companyName) {
        DisplayFilter filter = new DisplayFilter();
        filter.reqId = trimmed(reqId);
        filter.roleUnset = UNSET_FILTER.equals(trimmed(roleTitle));
        filter.companyUnset = UNSET_FILTER.equals(trimmed(companyName));
        filter.roleTitle = filterValue(roleTitle, 32, "roleTitle");
        filter.companyName = filterValue(companyName, 64, "companyName");
        return filter;
    }

    private String filterValue(String value, int maxLength, String name) {
        String normalized = trimmed(value);
        if (normalized != null && normalized.startsWith("__label__:")) normalized = normalized.substring(10);
        if (normalized != null && normalized.codePointCount(0, normalized.length()) > maxLength) {
            throw AppException.badRequest(name + " 最多 " + maxLength + " 个字符");
        }
        return normalized;
    }

    private String trimmed(String value) {
        return hasText(value) ? value.trim() : null;
    }

    private List<Requirement> scopedRequirements(Snapshot snapshot, String reqId) {
        return reqId == null ? snapshot.requirements
                : Collections.singletonList(requireProject(snapshot.requirements, reqId));
    }

    /** 只读取经过原有可见性裁剪/requireProject 验证的项目，每个项目一次，不按任务查库。 */
    private RoleContext roleContext(String workspaceId, List<Requirement> requirements,
                                    List<WorkspaceMember> members) {
        RoleContext context = new RoleContext();
        context.members = membersById(members);
        context.userIdsByName = userIdsByName(members);
        for (Requirement requirement : requirements) {
            Map<String, ProjectMemberRole> byUser = new HashMap<String, ProjectMemberRole>();
            if (roleMapper != null) {
                for (ProjectMemberRole role : emptyIfNull(roleMapper.selectByProject(workspaceId, requirement.getId()))) {
                    if (role != null && hasText(role.getUserId())) {
                        byUser.put(role.getUserId().trim(), role);
                    }
                }
            }
            context.projects.put(requirement.getId(), byUser);
        }
        return context;
    }

    private String taskOwnerId(Task task, RoleContext context) {
        return hasText(task.getOwnerUserId()) ? task.getOwnerUserId().trim()
                : context.userIdsByName.get(trimmed(task.getOwner()));
    }

    private String memberUserId(MemberAccumulator member, RoleContext context) {
        if (member.userId != null) {
            return member.userId;
        }
        return member.tasks.isEmpty() ? null : taskOwnerId(member.tasks.get(0), context);
    }

    private MemberLabels memberLabels(RoleContext context, String reqId, String userId) {
        MemberLabels labels = new MemberLabels();
        labels.userId = userId;
        WorkspaceMember member = context.members.get(userId);
        labels.companyName = member == null ? null : trimmed(member.getCompanyName());
        labels.jobTitle = member == null ? null : trimmed(member.getJobTitle());
        Map<String, ProjectMemberRole> project = context.projects.get(reqId);
        ProjectMemberRole role = project == null ? null : project.get(userId);
        labels.effectiveRoleTitle = role == null ? null : trimmed(role.getRoleTitle());
        if (labels.effectiveRoleTitle == null) {
            labels.effectiveRoleTitle = labels.jobTitle;
        }
        if (role != null) {
            for (String secondary : emptyIfNull(role.getSecondaryRoleTitles())) {
                String title = trimmed(secondary);
                if (title != null && !labels.secondaryRoleTitles.contains(title)) {
                    labels.secondaryRoleTitles.add(title);
                }
            }
        }
        return labels;
    }

    private Set<String> roleTitles(MemberLabels labels) {
        Set<String> titles = new LinkedHashSet<String>();
        if (labels.effectiveRoleTitle != null) {
            titles.add(labels.effectiveRoleTitle);
        }
        titles.addAll(labels.secondaryRoleTitles);
        return titles;
    }

    private List<Task> filterTasks(List<Task> tasks, RoleContext roles, DisplayFilter filter) {
        if (!filter.hasMemberFilter()) {
            return tasks;
        }
        List<Task> result = new ArrayList<Task>();
        for (Task task : tasks) {
            MemberLabels labels = memberLabels(roles, task.getReqId(), taskOwnerId(task, roles));
            Set<String> titles = roleTitles(labels);
            boolean roleMatches = filter.roleTitle == null || (filter.roleUnset
                    ? titles.isEmpty() : titles.contains(filter.roleTitle));
            boolean companyMatches = filter.companyName == null || (filter.companyUnset
                    ? labels.companyName == null : filter.companyName.equals(labels.companyName));
            if (roleMatches && companyMatches) {
                result.add(task);
            }
        }
        return result;
    }

    private List<TimeLog> logsForTasks(List<TimeLog> logs, List<Task> tasks) {
        Set<String> ids = taskIds(tasks);
        List<TimeLog> result = new ArrayList<TimeLog>();
        for (TimeLog log : logs) {
            // 无关联工作项无法确定项目/负责人；仅无筛选的原口径保留这些计时。
            if (log != null && log.getTaskId() != null && ids.contains(log.getTaskId())) {
                result.add(log);
            }
        }
        return result;
    }

    private Map<String, Object> filterOptions(List<Task> tasks, RoleContext roles) {
        Set<String> titles = new LinkedHashSet<String>();
        Set<String> companies = new LinkedHashSet<String>();
        for (Task task : tasks) {
            addFilterOptions(memberLabels(roles, task.getReqId(), taskOwnerId(task, roles)), titles, companies);
        }
        Map<String, Object> result = new LinkedHashMap<String, Object>();
        result.put("roleTitles", sorted(titles));
        result.put("companyNames", sorted(companies));
        return result;
    }

    private void addFilterOptions(MemberLabels labels, Set<String> titles, Set<String> companies) {
        Set<String> memberTitles = roleTitles(labels);
        if (memberTitles.isEmpty()) {
            titles.add(UNSET_FILTER);
        } else {
            for (String title : memberTitles) titles.add(labelFilterOption(title));
        }
        companies.add(labels.companyName == null ? UNSET_FILTER : labelFilterOption(labels.companyName));
    }

    private String labelFilterOption(String value) {
        return value != null && (UNSET_FILTER.equals(value) || value.startsWith("__label__:"))
                ? "__label__:" + value : value;
    }

    private List<String> sorted(Set<String> values) {
        List<String> result = new ArrayList<String>(values);
        Collections.sort(result);
        return result;
    }

    private void putFilterMetadata(Map<String, Object> result, Map<String, Object> options, DisplayFilter filter) {
        Map<String, Object> scope = new LinkedHashMap<String, Object>();
        scope.put("reqId", filter.reqId);
        scope.put("roleTitle", filter.roleUnset ? UNSET_FILTER : labelFilterOption(filter.roleTitle));
        scope.put("companyName", filter.companyUnset ? UNSET_FILTER : labelFilterOption(filter.companyName));
        result.put("filterOptions", options);
        result.put("scope", scope);
    }

    private void putMemberLabels(Map<String, Object> row, MemberLabels labels) {
        row.put("userId", labels.userId);
        row.put("companyName", labels.companyName);
        row.put("jobTitle", labels.jobTitle);
        row.put("effectiveRoleTitle", labels.effectiveRoleTitle);
        row.put("secondaryRoleTitles", labels.secondaryRoleTitles);
    }

    @SuppressWarnings("unchecked")
    private void putWorkloadLabels(Map<String, Object> row, MemberAccumulator member, RoleContext roles,
                                    String reqId, List<TimeLog> logs, Map<String, Task> tasksById) {
        String userId = memberUserId(member, roles);
        // 跨项目没有单一有效主角色：保留空间职能，项目职能通过 roleTitles 与项目行展示。
        MemberLabels labels = memberLabels(roles, reqId, userId);
        putMemberLabels(row, labels);
        Set<String> projectIds = new LinkedHashSet<String>();
        for (Task task : member.tasks) {
            projectIds.add(task.getReqId());
        }
        for (TimeLog log : logs) {
            if (userId != null && userId.equals(log.getUserId())) {
                Task task = tasksById.get(log.getTaskId());
                projectIds.add(task == null ? null : task.getReqId());
            }
        }
        Set<String> titles = new LinkedHashSet<String>();
        Set<String> secondary = new LinkedHashSet<String>();
        for (String projectId : projectIds) {
            MemberLabels projectLabels = memberLabels(roles, projectId, userId);
            titles.addAll(roleTitles(projectLabels));
            secondary.addAll(projectLabels.secondaryRoleTitles);
        }
        row.put("roleTitles", sorted(titles));
        row.put("secondaryRoleTitles", sorted(secondary));
        for (Map<String, Object> project : (List<Map<String, Object>>) row.get("projects")) {
            MemberLabels projectLabels = memberLabels(roles, (String) project.get("reqId"), userId);
            project.put("effectiveRoleTitle", projectLabels.effectiveRoleTitle);
            project.put("secondaryRoleTitles", projectLabels.secondaryRoleTitles);
            project.put("roleTitles", sorted(roleTitles(projectLabels)));
        }
    }

    private Requirement requireProject(List<Requirement> requirements, String reqId) {
        for (Requirement requirement : requirements) {
            if (requirement.getId() != null && requirement.getId().equals(reqId)) {
                return requirement;
            }
        }
        throw AppException.notFound("项目不存在或不属于当前空间");
    }

    private List<Task> tasksForReq(List<Task> tasks, String reqId) {
        List<Task> result = new ArrayList<Task>();
        for (Task task : tasks) {
            if (reqId == null ? task.getReqId() == null : reqId.equals(task.getReqId())) {
                result.add(task);
            }
        }
        return result;
    }

    private List<Task> openTasks(List<Task> tasks) {
        List<Task> result = new ArrayList<Task>();
        for (Task task : tasks) {
            if (!isDone(task)) {
                result.add(task);
            }
        }
        return result;
    }

    private Counts countTasks(List<Task> tasks, LocalDate today) {
        Counts counts = new Counts();
        counts.total = tasks.size();
        for (Task task : tasks) {
            if (isDone(task)) {
                counts.done++;
            } else {
                String bucket = TaskCalc.statusBucket(task.getBoardColumn(), task.getProcessingRule());
                if ("ended".equals(bucket)) {
                    counts.ended++;
                } else if ("doing".equals(bucket)) {
                    counts.doing++;
                } else {
                    counts.backlog++;
                }
                if (isOverdue(task, today)) {
                    counts.overdue++;
                }
                if (Boolean.TRUE.equals(task.getBlocked())) {
                    counts.blocked++;
                }
            }
        }
        return counts;
    }

    private Map<String, Object> countsMap(Counts counts) {
        Map<String, Object> result = new LinkedHashMap<String, Object>();
        result.put("backlog", counts.backlog);
        result.put("doing", counts.doing);
        result.put("ended", counts.ended);
        result.put("done", counts.done);
        result.put("overdue", counts.overdue);
        result.put("blocked", counts.blocked);
        return result;
    }

    private List<Task> completedBetween(List<Task> tasks, LocalDate from, LocalDate before) {
        List<Task> result = new ArrayList<Task>();
        for (Task task : tasks) {
            if (isDone(task) && task.getCompletedAt() != null
                    && !task.getCompletedAt().isBefore(from) && task.getCompletedAt().isBefore(before)) {
                result.add(task);
            }
        }
        return result;
    }

    private LocalDate lastCompletedAt(List<Task> tasks) {
        LocalDate latest = null;
        for (Task task : tasks) {
            if (isDone(task) && task.getCompletedAt() != null
                    && (latest == null || task.getCompletedAt().isAfter(latest))) {
                latest = task.getCompletedAt();
            }
        }
        return latest;
    }

    private int stagnantDays(List<Task> tasks, LocalDate lastCompletedAt, LocalDate today) {
        if (tasks.isEmpty()) {
            return 0;
        }
        LocalDate baseline = lastCompletedAt;
        if (baseline == null) {
            for (Task task : tasks) {
                LocalDate created = date(task.getCreatedAt());
                if (created != null && (baseline == null || created.isBefore(baseline))) {
                    baseline = created;
                }
            }
        }
        if (baseline == null) {
            return 0;
        }
        return (int) Math.max(0, ChronoUnit.DAYS.between(baseline, today));
    }

    private LocalDate minStartDate(List<Task> tasks) {
        LocalDate result = null;
        for (Task task : tasks) {
            if (task.getStartDate() != null && (result == null || task.getStartDate().isBefore(result))) {
                result = task.getStartDate();
            }
        }
        return result;
    }

    private LocalDate maxDueDate(List<Task> tasks) {
        LocalDate result = null;
        for (Task task : tasks) {
            if (task.getDueDate() != null && (result == null || task.getDueDate().isAfter(result))) {
                result = task.getDueDate();
            }
        }
        return result;
    }

    private int averageProgress(List<Task> tasks) {
        if (tasks.isEmpty()) {
            return 0;
        }
        int total = 0;
        for (Task task : tasks) {
            total += Math.max(0, Math.min(PERCENT, TaskCalc.progressOf(task)));
        }
        return (int) Math.round(total * 1.0 / tasks.size());
    }

    /** 项目级与模块级共用的工时 / 进度口径，保证两边数字可以直接对账 */
    private Map<String, Object> metricTotals(List<Task> tasks) {
        int completedEstimate = 0;
        int completedActual = 0;
        for (Task task : tasks) {
            if (isDone(task)) {
                completedEstimate += Math.max(0, minutes(task.getEstimateMinutes()));
                completedActual += actual(task);
            }
        }
        Map<String, Object> result = new LinkedHashMap<String, Object>();
        result.put("estimateMinutes", sumEstimate(tasks));
        result.put("actualMinutes", sumActual(tasks));
        result.put("remainingMinutes", sumRemaining(tasks));
        result.put("progressPct", averageProgress(tasks));
        result.put("deviationPct", completedEstimate == 0 ? null
                : round1((completedActual - completedEstimate) * (double) PERCENT / completedEstimate));
        return result;
    }

    private Map<String, Object> bucketMetrics(List<Task> tasks, LocalDate today) {
        Map<String, Object> result = new LinkedHashMap<String, Object>();
        result.put("total", tasks.size());
        result.putAll(metricTotals(tasks));
        result.putAll(countsMap(countTasks(tasks, today)));
        return result;
    }

    private int sumEstimate(List<Task> tasks) {
        int result = 0;
        for (Task task : tasks) {
            result += Math.max(0, task.getEstimateMinutes() == null ? 0 : task.getEstimateMinutes());
        }
        return result;
    }

    private int sumActual(List<Task> tasks) {
        int result = 0;
        for (Task task : tasks) {
            result += actual(task);
        }
        return result;
    }

    private int sumRemaining(List<Task> tasks) {
        return remaining(openTasks(tasks));
    }

    private int remaining(List<Task> tasks) {
        int result = 0;
        for (Task task : tasks) {
            result += remaining(task);
        }
        return result;
    }

    private int remaining(Task task) {
        int estimate = task.getEstimateMinutes() == null ? 0 : Math.max(0, task.getEstimateMinutes());
        return Math.max(0, estimate - actual(task));
    }

    private int actual(Task task) {
        return minutes(task.getTotalMinutes());
    }

    /** 区间规范化：任一缺失即视为不按区间统计（桌面端口径）；起终点反了自动交换；超长时从终点往前截断 */
    private LocalDate[] normalizeRange(LocalDate from, LocalDate to) {
        if (from == null || to == null) {
            return null;
        }
        LocalDate start = from;
        LocalDate end = to;
        if (start.isAfter(end)) {
            LocalDate swap = start;
            start = end;
            end = swap;
        }
        if (end.minusDays(MAX_RANGE_DAYS - 1L).isAfter(start)) {
            start = end.minusDays(MAX_RANGE_DAYS - 1L);
        }
        return new LocalDate[]{start, end};
    }

    /** 成员在区间内的实际计时（snapshot.logs 已按项目可见性裁剪） */
    private int minutesInRange(String userId, List<TimeLog> logs, LocalDate from, LocalDate to) {
        if (userId == null) {
            return 0;
        }
        int result = 0;
        for (TimeLog log : logs) {
            if (log == null || !userId.equals(log.getUserId()) || log.getStartedAt() == null) {
                continue;
            }
            LocalDate date = log.getStartedAt().toLocalDate();
            if (!date.isBefore(from) && !date.isAfter(to)) {
                result += minutes(log.getMinutes());
            }
        }
        return result;
    }

    /** 区间内的标准工作日数（周一~周五），负载容量按它折算 */
    private int countWorkdays(LocalDate from, LocalDate to) {
        int days = 0;
        for (LocalDate date = from; !date.isAfter(to); date = date.plusDays(1)) {
            if (WorkTime.isWorkday(date)) {
                days++;
            }
        }
        return days;
    }

    private int workdays(LocalDate latestDue, LocalDate today) {
        if (latestDue == null) {
            return DEFAULT_WORKDAYS;
        }
        int days = 0;
        for (LocalDate date = today; !date.isAfter(latestDue) && days < MAX_WORKDAYS; date = date.plusDays(1)) {
            if (WorkTime.isWorkday(date)) {
                days++;
            }
        }
        return Math.max(MIN_WORKDAYS, Math.min(MAX_WORKDAYS, days));
    }

    private int loadPct(int remainingMinutes, int workdays) {
        int capacity = workdays * DAILY_CAPACITY_MINUTES;
        return capacity == 0 ? 0 : (int) Math.round(remainingMinutes * (double) PERCENT / capacity);
    }

    private int actualMinutes(String userId, Set<String> taskIds, List<TimeLog> logs) {
        if (userId == null) {
            return 0;
        }
        int result = 0;
        for (TimeLog log : logs) {
            if (log != null && userId.equals(log.getUserId()) && taskIds.contains(log.getTaskId())) {
                result += minutes(log.getMinutes());
            }
        }
        return result;
    }

    private int sumLogs(List<TimeLog> logs) {
        int result = 0;
        for (TimeLog log : logs) {
            if (log != null) {
                result += minutes(log.getMinutes());
            }
        }
        return result;
    }

    private Set<String> taskIds(List<Task> tasks) {
        Set<String> result = new LinkedHashSet<String>();
        for (Task task : tasks) {
            result.add(task.getId());
        }
        return result;
    }

    private List<Map<String, Object>> taskMaps(List<Task> tasks, Map<String, String> reqNames) {
        List<Map<String, Object>> result = new ArrayList<Map<String, Object>>();
        for (Task task : tasks) {
            result.add(taskMap(task, reqNames));
        }
        return result;
    }

    private Map<String, Object> taskMap(Task task, Map<String, String> reqNames) {
        Map<String, Object> item = new LinkedHashMap<String, Object>();
        item.put("id", task.getId());
        item.put("workspaceId", task.getWorkspaceId());
        item.put("title", task.getTitle());
        item.put("description", task.getDescription());
        item.put("priority", task.getPriority());
        item.put("owner", task.getOwner());
        item.put("ownerUserId", task.getOwnerUserId());
        item.put("categoryId", task.getCategoryId());
        item.put("boardColumn", task.getBoardColumn());
        item.put("processingRule", task.getProcessingRule());
        item.put("startDate", task.getStartDate());
        item.put("dueDate", task.getDueDate());
        item.put("reqId", task.getReqId());
        String reqName = reqNames.get(task.getReqId());
        item.put("reqName", reqName == null ? UNCATEGORIZED_NAME : reqName);
        item.put("progress", task.getProgress());
        item.put("estimateMinutes", task.getEstimateMinutes());
        item.put("totalMinutes", actual(task));
        item.put("completedAt", task.getCompletedAt());
        item.put("createdAt", task.getCreatedAt());
        item.put("updatedAt", task.getUpdatedAt());
        item.put("blocked", Boolean.TRUE.equals(task.getBlocked()));
        item.put("blockedReason", task.getBlockedReason());
        item.put("blockedByTaskId", task.getBlockedByTaskId());
        item.put("itemType", task.getItemType());
        item.put("epicId", task.getEpicId());
        item.put("isMilestone", task.getIsMilestone());
        item.put("note", task.getNote());
        return item;
    }

    private Map<String, String> requirementNames(List<Requirement> requirements) {
        Map<String, String> result = new LinkedHashMap<String, String>();
        for (Requirement requirement : requirements) {
            result.put(requirement.getId(), requirement.getName());
        }
        return result;
    }

    private Map<String, WorkspaceMember> membersById(List<WorkspaceMember> members) {
        Map<String, WorkspaceMember> result = new HashMap<String, WorkspaceMember>();
        for (WorkspaceMember member : members) {
            if (member != null && member.getUserId() != null) {
                result.put(member.getUserId(), member);
            }
        }
        return result;
    }

    private Map<String, String> userIdsByName(List<WorkspaceMember> members) {
        Map<String, String> result = new HashMap<String, String>();
        Set<String> ambiguous = new HashSet<String>();
        for (WorkspaceMember member : members) {
            if (member != null && hasText(member.getDisplayName()) && hasText(member.getUserId())) {
                String name = member.getDisplayName().trim();
                String previous = result.putIfAbsent(name, member.getUserId());
                if (previous != null && !previous.equals(member.getUserId())) ambiguous.add(name);
            }
        }
        // 历史纯文本负责人只有姓名唯一时才解析账号，不能把同名工作量归给首人。
        for (String name : ambiguous) result.remove(name);
        return result;
    }

    private String memberDisplayName(List<WorkspaceMember> members, String userId) {
        if (!hasText(userId)) {
            return null;
        }
        for (WorkspaceMember member : members) {
            if (member != null && userId.equals(member.getUserId())) {
                return hasText(member.getDisplayName()) ? member.getDisplayName() : userId;
            }
        }
        return userId;
    }

    private String ownerName(Task task, Map<String, WorkspaceMember> membersById) {
        if (hasText(task.getOwnerUserId())) {
            WorkspaceMember member = membersById.get(task.getOwnerUserId().trim());
            if (member != null && hasText(member.getDisplayName())) {
                return member.getDisplayName();
            }
        }
        return task.getOwner();
    }

    private String nudgeBody(Task task, LocalDate today) {
        List<String> reasons = new ArrayList<String>();
        if (isOverdue(task, today)) {
            reasons.add("任务已逾期，截止日期：" + task.getDueDate());
        }
        if (Boolean.TRUE.equals(task.getBlocked())) {
            reasons.add(hasText(task.getBlockedReason())
                    ? "阻塞原因：" + task.getBlockedReason().trim() : "任务当前处于阻塞状态");
        }
        if (reasons.isEmpty()) {
            reasons.add("请及时处理并更新任务进展");
        }
        return String.join("；", reasons) + "。";
    }

    private Comparator<Task> severityDateComparator() {
        return new Comparator<Task>() {
            @Override
            public int compare(Task left, Task right) {
                int severity = Integer.compare(priorityRank(left.getPriority()), priorityRank(right.getPriority()));
                if (severity != 0) {
                    return severity;
                }
                int due = compareNullable(left.getDueDate(), right.getDueDate());
                if (due != 0) {
                    return due;
                }
                int updated = compareNullable(updatedDate(left), updatedDate(right));
                return updated != 0 ? updated : compareNullable(left.getId(), right.getId());
            }
        };
    }

    private int priorityRank(String priority) {
        if ("P0".equals(priority)) {
            return 0;
        }
        if ("P1".equals(priority)) {
            return 1;
        }
        if ("P2".equals(priority)) {
            return 2;
        }
        if ("P3".equals(priority)) {
            return 3;
        }
        return 4;
    }

    private LocalDate updatedDate(Task task) {
        return date(task.getUpdatedAt());
    }

    private boolean isOverdue(Task task, LocalDate today) {
        /* 「执行结束」列不计逾期，与看板 / 列表 / 统计 SQL 同一口径 */
        return !isDone(task) && !"ended".equals(task.getProcessingRule())
                && task.getDueDate() != null && task.getDueDate().isBefore(today);
    }

    private boolean isStagnant(Task task, LocalDate today) {
        LocalDate updated = updatedDate(task);
        return updated != null && ChronoUnit.DAYS.between(updated, today) >= STAGNANT_DAYS;
    }

    private boolean isDone(Task task) {
        return Consts.COL_DONE.equals(task.getBoardColumn());
    }

    private int percent(int value, int total) {
        return total == 0 ? 0 : (int) Math.round(value * (double) PERCENT / total);
    }

    private double round1(double value) {
        return Math.round(value * 10.0) / 10.0;
    }

    private LocalDate mondayOf(LocalDate date) {
        return date.minusDays(date.getDayOfWeek().getValue() - DayOfWeek.MONDAY.getValue());
    }

    private LocalDate today() {
        return LocalDate.now(clock);
    }

    private LocalDate date(LocalDateTime value) {
        return value == null ? null : value.toLocalDate();
    }

    private int minutes(Integer value) {
        return value == null ? 0 : Math.max(0, value);
    }

    private String safe(String value) {
        return value == null ? "" : value;
    }

    private boolean hasText(String value) {
        return value != null && !value.trim().isEmpty();
    }

    private <T> int compareNullable(Comparable<T> left, T right) {
        if (left == null && right == null) {
            return 0;
        }
        if (left == null) {
            return 1;
        }
        if (right == null) {
            return -1;
        }
        return left.compareTo(right);
    }

    private <T> List<T> emptyIfNull(List<T> values) {
        return values == null ? Collections.<T>emptyList() : values;
    }

    private static class DisplayFilter {
        private String reqId;
        private String roleTitle;
        private String companyName;
        private boolean roleUnset;
        private boolean companyUnset;

        private boolean hasMemberFilter() {
            return roleTitle != null || companyName != null;
        }
    }

    private static class RoleContext {
        private Map<String, WorkspaceMember> members;
        private Map<String, String> userIdsByName;
        private final Map<String, Map<String, ProjectMemberRole>> projects =
                new HashMap<String, Map<String, ProjectMemberRole>>();
    }

    private static class MemberLabels {
        private String userId;
        private String companyName;
        private String jobTitle;
        private String effectiveRoleTitle;
        private final List<String> secondaryRoleTitles = new ArrayList<String>();
    }

    private static class Snapshot {
        private List<Task> tasks;
        private List<Requirement> requirements;
        private List<WorkspaceMember> members;
        private List<TimeLog> logs;
    }

    private static class Counts {
        private int total;
        private int backlog;
        private int doing;
        private int ended;
        private int done;
        private int overdue;
        private int blocked;
    }

    private static class MemberAccumulator {
        private String key;
        private String name;
        private String userId;
        private LocalDate latestDue;
        private final List<Task> tasks = new ArrayList<Task>();
    }

    private static class MemberProject {
        private String reqId;
        private String name;
        private int remainingMinutes;
        private int taskCount;
    }
}
