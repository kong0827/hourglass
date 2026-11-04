package com.devstudio.kanban.service;

import com.devstudio.kanban.common.Consts;
import com.devstudio.kanban.entity.Requirement;
import com.devstudio.kanban.entity.Task;
import com.devstudio.kanban.entity.TimeAgg;
import com.devstudio.kanban.entity.TimeLog;
import com.devstudio.kanban.entity.WorkspaceMember;
import com.devstudio.kanban.mapper.RequirementMapper;
import com.devstudio.kanban.mapper.TaskMapper;
import com.devstudio.kanban.mapper.TimeLogMapper;
import com.devstudio.kanban.mapper.WorkspaceMemberMapper;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class ManagerServiceTest {

    private static final String WORKSPACE = "W1";
    private static final String VIEWER = "U1";
    private static final LocalDate TODAY = LocalDate.of(2026, 11, 11);
    private static final Clock CLOCK = Clock.fixed(Instant.parse("2026-11-11T08:00:00Z"), ZoneId.of("UTC"));

    private final TaskMapper taskMapper = mock(TaskMapper.class);
    private final RequirementMapper requirementMapper = mock(RequirementMapper.class);
    private final TimeLogMapper timeLogMapper = mock(TimeLogMapper.class);
    private final WorkspaceMemberMapper memberMapper = mock(WorkspaceMemberMapper.class);
    private final AppNotificationService notificationService = mock(AppNotificationService.class);

    @Test
    void portfolioHealthUsesOverdueStagnationAndOverload() {
        Requirement red = requirement("R1", "红色项目");
        Requirement orange = requirement("R2", "橙色项目");
        Requirement green = requirement("R3", "绿色项目");

        Task overdue = openTask("T1", "R1", "custom", 100);
        overdue.setDueDate(TODAY.minusDays(1));
        overdue.setCreatedAt(TODAY.minusDays(20).atStartOfDay());
        Task overloaded = openTask("T2", "R2", Consts.COL_DOING, 720);
        overloaded.setDueDate(TODAY);
        Task normal = openTask("T3", "R3", "custom", 100);

        ManagerService service = service(Arrays.asList(overdue, overloaded, normal),
                Arrays.asList(red, orange, green), Collections.<TimeAgg>emptyList(),
                Collections.<TimeLog>emptyList(), Collections.<WorkspaceMember>emptyList());
        Map<String, Object> portfolio = service.portfolio(WORKSPACE, VIEWER);
        List<Map<String, Object>> projects = castList(portfolio.get("projects"));

        assertEquals("red", project(projects, "R1").get("health"));
        assertEquals("orange", project(projects, "R2").get("health"));
        assertEquals("green", project(projects, "R3").get("health"));
        assertEquals(1, project(projects, "R3").get("backlog"), "自定义非 done 列必须计待处理");
        assertEquals(1, project(projects, "R2").get("doing"));
    }

    @Test
    void workloadUsesPerTaskRemainingAndLatestDueCapacity() {
        Requirement requirement = requirement("R1", "项目一");
        Task task = openTask("T1", "R1", Consts.COL_DOING, 600);
        task.setOwnerUserId("U1");
        task.setDueDate(TODAY);
        Task done = openTask("T2", "R1", Consts.COL_DONE, 10000);
        done.setOwnerUserId("U1");
        Task unassigned = openTask("T3", "R1", "custom", null);

        WorkspaceMember member = new WorkspaceMember();
        member.setUserId("U1");
        member.setDisplayName("Alice");
        WorkspaceMember loggedOnly = new WorkspaceMember();
        loggedOnly.setUserId("U2");
        loggedOnly.setDisplayName("Bob");
        TimeLog thisWeek = timeLog("U1", TODAY.atTime(9, 0), 60);
        TimeLog lastWeek = timeLog("U1", TODAY.minusWeeks(1).atTime(9, 0), 30);
        TimeLog loggedOnlyWeek = timeLog("U2", TODAY.atTime(10, 0), 45);

        ManagerService service = service(Arrays.asList(task, done, unassigned), Arrays.asList(requirement),
                Arrays.asList(actual("T1", 120)), Arrays.asList(thisWeek, lastWeek, loggedOnlyWeek),
                Arrays.asList(member, loggedOnly));
        Map<String, Object> workload = service.workload(WORKSPACE, VIEWER);
        List<Map<String, Object>> members = castList(workload.get("members"));
        Map<String, Object> alice = member(members, "U1");

        assertEquals(480, alice.get("remainingMinutes"), "剩余=max(预估-实际,0)");
        assertEquals(1, alice.get("workdays"));
        assertEquals(360, alice.get("capacityMinutes"));
        assertEquals(133, alice.get("loadPct"));
        assertEquals(true, alice.get("overloaded"));
        assertEquals(60, alice.get("weekMinutes"));
        assertEquals(30, alice.get("lastWeekMinutes"));
        assertEquals(Arrays.asList(0, 0, 60, 0, 0, 0, 0), alice.get("dayMinutes"));
        List<Map<String, Object>> tasks = castList(alice.get("tasks"));
        assertEquals(1, tasks.size(), "完成列任务不能进入工作量");
        assertEquals(120, tasks.get(0).get("totalMinutes"));
        assertEquals("项目一", tasks.get(0).get("reqName"));
        assertTrue(member(members, "unassigned") != null, "未指派任务也必须保留");
        assertEquals(45, member(members, "U2").get("weekMinutes"), "只有计时、无未完成任务成员也要进入周视图");
    }

    @Test
    void projectUsesAverageTaskProgressAndCompletedTaskDeviation() {
        Task doing = openTask("T1", "R1", Consts.COL_DOING, 100);
        doing.setProgress(40);
        Task done = openTask("T2", "R1", Consts.COL_DONE, 200);
        ManagerService service = service(Arrays.asList(doing, done), Arrays.asList(requirement("R1", "项目一")),
                Arrays.asList(actual("T1", 500), actual("T2", 240)),
                Collections.<TimeLog>emptyList(), Collections.<WorkspaceMember>emptyList());

        Map<String, Object> metrics = castMap(service.project(WORKSPACE, "R1", VIEWER).get("metrics"));
        assertEquals(70, metrics.get("progressPct"));
        assertEquals(20.0, metrics.get("deviationPct"), "偏差只计算已完成任务，不能混入进行中实际工时");
        List<Map<String, Object>> projects = castList(service.portfolio(WORKSPACE, VIEWER).get("projects"));
        assertEquals(70, project(projects, "R1").get("progressPct"));
    }

    @Test
    void deliveryUsesNearestRankPercentilesAndExclusiveBucketBoundaries() {
        List<Task> tasks = new ArrayList<Task>();
        LocalDate start = LocalDate.of(2026, 1, 1);
        for (int days = 1; days <= 20; days++) {
            Task task = openTask("T" + days, "R1", Consts.COL_DONE, 0);
            task.setStartDate(start);
            task.setCompletedAt(start.plusDays(days));
            tasks.add(task);
        }
        ManagerService service = service(tasks, Arrays.asList(requirement("R1", "项目一")),
                Collections.<TimeAgg>emptyList(), Collections.<TimeLog>emptyList(),
                Collections.<WorkspaceMember>emptyList());

        Map<String, Object> reports = service.reports(WORKSPACE, "R1", VIEWER);
        Map<String, Object> delivery = castMap(reports.get("delivery"));
        assertEquals(10L, delivery.get("p50Days"));
        assertEquals(17L, delivery.get("p85Days"));
        assertEquals(10.5, delivery.get("averageDays"));
        List<Map<String, Object>> buckets = castList(delivery.get("buckets"));
        assertEquals(0, buckets.get(0).get("count"));
        assertEquals(2, buckets.get(1).get("count"));
        assertEquals(5, buckets.get(2).get("count"));
        assertEquals(13, buckets.get(3).get("count"));
    }

    @Test
    void burndownSubtractsOnlyActualWorkCompletedByEachDate() {
        Task first = openTask("T1", "R1", Consts.COL_DONE, 300);
        first.setCompletedAt(TODAY.minusDays(1));
        Task second = openTask("T2", "R1", Consts.COL_DONE, 200);
        second.setCompletedAt(TODAY);
        ManagerService service = service(Arrays.asList(first, second),
                Arrays.asList(requirement("R1", "项目一")),
                Arrays.asList(actual("T1", 120), actual("T2", 80)),
                Collections.<TimeLog>emptyList(), Collections.<WorkspaceMember>emptyList());

        Map<String, Object> burndown = castMap(service.reports(WORKSPACE, null, VIEWER).get("burndown"));
        List<Map<String, Object>> points = castList(burndown.get("points"));
        assertEquals(14, points.size());
        assertEquals(380, points.get(12).get("remainingMinutes"));
        assertEquals(300, points.get(13).get("remainingMinutes"));
        assertEquals(500, points.get(0).get("idealMinutes"));
        assertEquals(0, points.get(13).get("idealMinutes"));
    }

    @Test
    void hiddenProjectTimeIsExcludedFromPortfolioAndWorkload() {
        Requirement visible = requirement("R1", "可见项目");
        Requirement hidden = requirement("R2", "隐藏项目");
        Task visibleTask = openTask("T1", "R1", Consts.COL_DOING, 600);
        visibleTask.setOwnerUserId("U1");
        visibleTask.setDueDate(TODAY);
        Task hiddenTask = openTask("T2", "R2", Consts.COL_DOING, 600);
        hiddenTask.setOwnerUserId("U2");
        hiddenTask.setDueDate(TODAY);

        WorkspaceMember alice = new WorkspaceMember();
        alice.setUserId("U1");
        alice.setDisplayName("Alice");
        WorkspaceMember bob = new WorkspaceMember();
        bob.setUserId("U2");
        bob.setDisplayName("Bob");

        TimeLog visibleLog = timeLog("U1", "T1", TODAY.atTime(9, 0), 60);
        TimeLog hiddenLog = timeLog("U2", "T2", TODAY.atTime(9, 0), 45);
        TimeLog untaskedLog = timeLog("U1", null, TODAY.atTime(10, 0), 30);

        ProjectAccessService access = mock(ProjectAccessService.class);
        when(access.hiddenProjectIds(WORKSPACE, VIEWER)).thenReturn(Collections.singleton("R2"));
        ManagerService service = service(Arrays.asList(visibleTask, hiddenTask),
                Arrays.asList(visible, hidden), Collections.<TimeAgg>emptyList(),
                Arrays.asList(visibleLog, hiddenLog, untaskedLog), Arrays.asList(alice, bob), access);

        Map<String, Object> portfolio = service.portfolio(WORKSPACE, VIEWER);
        Map<String, Object> kpis = castMap(portfolio.get("kpis"));
        assertEquals(90, kpis.get("weekWorkMinutes"), "隐藏项目工时不能进入周工时，未关联任务的计时保留");
        Map<String, Object> byTask = castMap(portfolio.get("weekWorkByTask"));
        assertEquals(60, byTask.get("T1"));
        assertFalse(byTask.containsKey("T2"));

        Map<String, Object> workload = service.workload(WORKSPACE, VIEWER);
        List<Map<String, Object>> members = castList(workload.get("members"));
        assertEquals(90, member(members, "U1").get("weekMinutes"));
        assertNull(member(members, "U2"), "仅有隐藏项目计时的成员不应进入工作量视图");
    }

    private ManagerService service(List<Task> tasks, List<Requirement> requirements, List<TimeAgg> actual,
                                   List<TimeLog> logs, List<WorkspaceMember> members) {
        return service(tasks, requirements, actual, logs, members, mock(ProjectAccessService.class));
    }

    private ManagerService service(List<Task> tasks, List<Requirement> requirements, List<TimeAgg> actual,
                                   List<TimeLog> logs, List<WorkspaceMember> members, ProjectAccessService access) {
        when(taskMapper.selectAll(WORKSPACE)).thenReturn(tasks);
        when(requirementMapper.selectAll(WORKSPACE)).thenReturn(requirements);
        when(timeLogMapper.sumByTaskByWorkspace(WORKSPACE)).thenReturn(actual);
        when(timeLogMapper.selectByWorkspaceBetween(eq(WORKSPACE), any(LocalDateTime.class), any(LocalDateTime.class)))
                .thenReturn(logs);
        when(memberMapper.selectByWorkspace(WORKSPACE)).thenReturn(members);
        return new ManagerService(taskMapper, requirementMapper, timeLogMapper, memberMapper,
                notificationService, access, CLOCK);
    }

    private Requirement requirement(String id, String name) {
        Requirement requirement = new Requirement();
        requirement.setId(id);
        requirement.setWorkspaceId(WORKSPACE);
        requirement.setName(name);
        requirement.setStatus("active");
        return requirement;
    }

    private Task openTask(String id, String reqId, String column, Integer estimateMinutes) {
        Task task = new Task();
        task.setId(id);
        task.setWorkspaceId(WORKSPACE);
        task.setTitle(id);
        task.setReqId(reqId);
        task.setBoardColumn(column);
        task.setEstimateMinutes(estimateMinutes);
        task.setCreatedAt(TODAY.minusDays(1).atStartOfDay());
        task.setUpdatedAt(TODAY.atStartOfDay());
        return task;
    }

    private TimeAgg actual(String taskId, int minutes) {
        TimeAgg actual = new TimeAgg();
        actual.setTaskId(taskId);
        actual.setTotalMinutes(minutes);
        return actual;
    }

    private TimeLog timeLog(String userId, LocalDateTime startedAt, int minutes) {
        return timeLog(userId, null, startedAt, minutes);
    }

    private TimeLog timeLog(String userId, String taskId, LocalDateTime startedAt, int minutes) {
        TimeLog log = new TimeLog();
        log.setUserId(userId);
        log.setTaskId(taskId);
        log.setStartedAt(startedAt);
        log.setMinutes(minutes);
        return log;
    }

    private Map<String, Object> project(List<Map<String, Object>> projects, String reqId) {
        for (Map<String, Object> project : projects) {
            if (reqId.equals(project.get("reqId"))) {
                return project;
            }
        }
        throw new AssertionError("项目不存在：" + reqId);
    }

    private Map<String, Object> member(List<Map<String, Object>> members, String key) {
        for (Map<String, Object> member : members) {
            if (key.equals(member.get("key"))) {
                return member;
            }
        }
        return null;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> castMap(Object value) {
        return (Map<String, Object>) value;
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> castList(Object value) {
        return (List<Map<String, Object>>) value;
    }
}
