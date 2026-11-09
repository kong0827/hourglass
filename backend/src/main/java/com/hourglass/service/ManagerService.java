package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.common.Consts;
import com.hourglass.common.TaskCalc;
import com.hourglass.common.WorkTime;
import com.hourglass.entity.Requirement;
import com.hourglass.entity.Task;
import com.hourglass.entity.TimeAgg;
import com.hourglass.entity.TimeLog;
import com.hourglass.entity.WorkspaceMember;
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
    private static final int MAX_WORKDAYS = 20;
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
    private static final String UNASSIGNED_KEY = "unassigned";
    private static final String UNASSIGNED_NAME = "未指派";
    private static final String UNCATEGORIZED_NAME = "未归类";

    private final TaskMapper taskMapper;
    private final RequirementMapper requirementMapper;
    private final TimeLogMapper timeLogMapper;
    private final WorkspaceMemberMapper memberMapper;
    private final AppNotificationService notificationService;
    private final ProjectAccessService projectAccess;
    private final Clock clock;

    @Autowired
    public ManagerService(TaskMapper taskMapper, RequirementMapper requirementMapper,
                          TimeLogMapper timeLogMapper, WorkspaceMemberMapper memberMapper,
                          AppNotificationService notificationService, ProjectAccessService projectAccess) {
        this(taskMapper, requirementMapper, timeLogMapper, memberMapper, notificationService,
                projectAccess, Clock.systemDefaultZone());
    }

    ManagerService(TaskMapper taskMapper, RequirementMapper requirementMapper,
                   TimeLogMapper timeLogMapper, WorkspaceMemberMapper memberMapper,
                   AppNotificationService notificationService, ProjectAccessService projectAccess, Clock clock) {
        this.taskMapper = taskMapper;
        this.requirementMapper = requirementMapper;
        this.timeLogMapper = timeLogMapper;
        this.memberMapper = memberMapper;
        this.notificationService = notificationService;
        this.projectAccess = projectAccess;
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

        int estimateMinutes = sumEstimate(tasks);
        int actualMinutes = sumActual(tasks);
        int completedEstimateMinutes = 0;
        int completedActualMinutes = 0;
        for (Task task : tasks) {
            if (isDone(task)) {
                completedEstimateMinutes += Math.max(0, minutes(task.getEstimateMinutes()));
                completedActualMinutes += actual(task);
            }
        }
        Map<String, Object> metrics = new LinkedHashMap<String, Object>();
        metrics.put("startDate", minStartDate(tasks));
        metrics.put("dueDate", maxDueDate(tasks));
        metrics.put("estimateMinutes", estimateMinutes);
        metrics.put("actualMinutes", actualMinutes);
        metrics.put("remainingMinutes", sumRemaining(tasks));
        metrics.put("progressPct", averageProgress(tasks));
        metrics.put("deviationPct", completedEstimateMinutes == 0 ? null
                : round1((completedActualMinutes - completedEstimateMinutes) * (double) PERCENT / completedEstimateMinutes));

        Map<String, Object> result = new LinkedHashMap<String, Object>();
        result.put("today", today);
        result.put("project", project);
        result.put("metrics", metrics);
        result.put("counts", countsMap(counts));
        result.put("weekly", weekly(tasks, today));
        result.put("epics", epics(tasks));
        result.put("members", projectMembers(tasks, snapshot.members, snapshot.logs, today));
        result.put("tasks", taskMaps(tasks, requirementNames(snapshot.requirements)));
        return result;
    }

    public Map<String, Object> reports(String workspaceId, String reqId, String userId) {
        LocalDate today = today();
        Snapshot snapshot = load(workspaceId, null, null, userId);
        List<Task> tasks = snapshot.tasks;
        if (hasText(reqId)) {
            Requirement requirement = requireProject(snapshot.requirements, reqId.trim());
            tasks = tasksForReq(tasks, requirement.getId());
        }

        Map<String, Object> result = new LinkedHashMap<String, Object>();
        result.put("burndown", burndown(tasks, today));
        result.put("velocity", velocity(tasks, today));
        result.put("flow", flow(tasks, today));
        result.put("delivery", delivery(tasks));
        result.put("defects", defects(tasks, today));
        return result;
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
        Map<String, String> reqNames = requirementNames(snapshot.requirements);
        List<Task> openTasks = openTasks(snapshot.tasks);
        LinkedHashMap<String, MemberAccumulator> accumulators = memberAccumulators(openTasks, snapshot.members);
        includeLoggedMembers(accumulators, snapshot.logs, snapshot.members);

        List<Map<String, Object>> projects = new ArrayList<Map<String, Object>>();
        for (Requirement requirement : snapshot.requirements) {
            Map<String, Object> item = new LinkedHashMap<String, Object>();
            item.put("id", requirement.getId());
            item.put("name", requirement.getName());
            projects.add(item);
        }

        Map<String, Task> tasksById = new HashMap<String, Task>();
        for (Task task : snapshot.tasks) {
            tasksById.put(task.getId(), task);
        }

        List<Map<String, Object>> members = new ArrayList<Map<String, Object>>();
        for (MemberAccumulator member : accumulators.values()) {
            Map<String, Object> item = workloadMember(member, snapshot.logs, weekStart, today, reqNames, tasksById);
            if (range != null) {
                item.put("rangeMinutes", minutesInRange(member.userId, snapshot.logs, range[0], range[1]));
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
            notificationService.push(ownerUserId, workspaceId, "manager_nudge",
                    "管理催办：" + safe(task.getTitle()), nudgeBody(task, today), task.getId());
            sent++;
        }

        Map<String, Object> result = new LinkedHashMap<String, Object>();
        result.put("sent", sent);
        result.put("skipped", skipped);
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
                key = task.getOwner().trim();
                name = key;
                userId = userIdsByName.get(key);
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
            for (Task task : tasks) {
                LocalDate created = date(task.getCreatedAt());
                if (created != null && created.isAfter(weekEnd)) {
                    continue;
                }
                if (isDone(task) && (task.getCompletedAt() == null || !task.getCompletedAt().isAfter(weekEnd))) {
                    done++;
                } else if (Consts.COL_DOING.equals(task.getBoardColumn())) {
                    doing++;
                } else {
                    backlog++;
                }
            }
            Map<String, Object> week = new LinkedHashMap<String, Object>();
            week.put("start", start);
            week.put("backlog", backlog);
            week.put("doing", doing);
            week.put("done", done);
            weeks.add(week);
        }
        Map<String, Object> result = new LinkedHashMap<String, Object>();
        result.put("weeks", weeks);
        return result;
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
            if (!isDone(task) || task.getCompletedAt() == null) {
                continue;
            }
            LocalDate start = task.getStartDate() != null ? task.getStartDate() : date(task.getCreatedAt());
            if (start == null) {
                continue;
            }
            long days = ChronoUnit.DAYS.between(start, task.getCompletedAt());
            if (days < 0) {
                continue;
            }
            durations.add(days);
            totalDays += days;
            if (days < 1) {
                lessThanOne++;
            } else if (days < 3) {
                oneToThree++;
            } else if (days <= 7) {
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
                if (Consts.COL_DOING.equals(task.getBoardColumn())) {
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
        for (WorkspaceMember member : members) {
            if (member != null && hasText(member.getDisplayName()) && hasText(member.getUserId())) {
                result.putIfAbsent(member.getDisplayName().trim(), member.getUserId());
            }
        }
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
