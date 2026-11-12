package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.common.Consts;
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
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

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
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
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
    private final CategoryService categoryService = mock(CategoryService.class);
    private final ReleasePermissionService releasePermission = mock(ReleasePermissionService.class);
    private final ProjectMemberRoleMapper roleMapper = mock(ProjectMemberRoleMapper.class);

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
        assertEquals(1, project(projects, "R3").get("doing"), "未配置规则的自定义列按正常处理计进行中");
        assertEquals(0, project(projects, "R3").get("backlog"));
        assertEquals(1, project(projects, "R2").get("doing"));
    }

    @Test
    void portfolioIgnoresRecycleBinTasks() {
        Requirement req = requirement("R1", "项目一");
        Task active = openTask("T1", "R1", "custom", 100);
        Task deleted = openTask("T2", "R1", "custom", 100);
        deleted.setDeletedAt(TODAY.atStartOfDay());

        ManagerService service = service(Arrays.asList(active, deleted),
                Collections.singletonList(req), Collections.<TimeAgg>emptyList(),
                Collections.<TimeLog>emptyList(), Collections.<WorkspaceMember>emptyList());
        List<Map<String, Object>> projects = castList(service.portfolio(WORKSPACE, VIEWER).get("projects"));

        assertEquals(1, project(projects, "R1").get("doing"));
        assertEquals(1, project(projects, "R1").get("total"), "回收站任务不计入");
    }

    @Test
    void statusBucketsFollowColumnProcessingRule() {
        Requirement req = requirement("R1", "项目一");
        Task backlog = openTask("T1", "R1", Consts.COL_BACKLOG, 60);
        backlog.setProcessingRule("normal");
        Task testing = openTask("T2", "R1", "testing", 60);
        testing.setProcessingRule("normal");
        Task waiting = openTask("T3", "R1", "waiting", 60);
        waiting.setProcessingRule("waiting");
        Task ended = openTask("T4", "R1", "accept", 60);
        ended.setProcessingRule("ended");
        Task done = openTask("T5", "R1", Consts.COL_DONE, 60);
        done.setCompletedAt(TODAY);

        ManagerService service = service(Arrays.asList(backlog, testing, waiting, ended, done),
                Collections.singletonList(req), Collections.<TimeAgg>emptyList(),
                Collections.<TimeLog>emptyList(), Collections.<WorkspaceMember>emptyList());
        Map<String, Object> p = project(castList(service.portfolio(WORKSPACE, VIEWER).get("projects")), "R1");
        assertEquals(2, p.get("backlog"), "待处理列（库内规则为 normal）与等待接续列计待处理");
        assertEquals(1, p.get("doing"), "正常处理的自定义列计进行中");
        assertEquals(1, p.get("ended"), "执行结束列单独计数，不计未完成");
        assertEquals(1, p.get("done"));

        Map<String, Object> counts = castMap(service.project(WORKSPACE, "R1", VIEWER).get("counts"));
        assertEquals(2, counts.get("backlog"));
        assertEquals(1, counts.get("doing"));
        assertEquals(1, counts.get("ended"));
        List<Map<String, Object>> weeks = castList(castMap(service.reports(WORKSPACE, "R1", VIEWER).get("flow")).get("weeks"));
        Map<String, Object> current = weeks.get(weeks.size() - 1);
        assertEquals(2, current.get("backlog"));
        assertEquals(1, current.get("doing"));
        assertEquals(1, current.get("ended"));
        assertEquals(1, current.get("done"));
    }

    @Test
    void endedColumnDoesNotCountAsOverdueButWaitingDoes() {
        Requirement req = requirement("R1", "项目一");
        Task ended = openTask("T1", "R1", "archive", 100);
        ended.setProcessingRule("ended");
        ended.setDueDate(TODAY.minusDays(3));
        Task waiting = openTask("T2", "R1", "waiting", 100);
        waiting.setProcessingRule("waiting");
        waiting.setDueDate(TODAY.minusDays(2));

        ManagerService service = service(Arrays.asList(ended, waiting),
                Collections.singletonList(req), Collections.<TimeAgg>emptyList(),
                Collections.<TimeLog>emptyList(), Collections.<WorkspaceMember>emptyList());
        List<Map<String, Object>> projects = castList(service.portfolio(WORKSPACE, VIEWER).get("projects"));
        assertEquals(1, project(projects, "R1").get("overdue"), "执行结束列不计逾期，等待列仍计");
        assertEquals("T2", castList(service.risks(WORKSPACE, VIEWER).get("overdue")).get(0).get("id"),
                "风险列表与项目逾期计数同一口径");
    }

    @Test
    void workloadUsesPerTaskRemainingAndLatestDueCapacity() {
        Requirement requirement = requirement("R1", "项目一");
        Task task = openTask("T1", "R1", Consts.COL_DOING, 700);
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
        TimeLog thisWeek = timeLog("U1", "T1", TODAY.atTime(9, 0), 60);
        TimeLog lastWeek = timeLog("U1", TODAY.minusWeeks(1).atTime(9, 0), 30);
        TimeLog loggedOnlyWeek = timeLog("U2", TODAY.atTime(10, 0), 45);

        ManagerService service = service(Arrays.asList(task, done, unassigned), Arrays.asList(requirement),
                Arrays.asList(actual("T1", 120)), Arrays.asList(thisWeek, lastWeek, loggedOnlyWeek),
                Arrays.asList(member, loggedOnly));
        Map<String, Object> workload = service.workload(WORKSPACE, VIEWER);
        List<Map<String, Object>> members = castList(workload.get("members"));
        Map<String, Object> alice = member(members, "U1");

        assertEquals(580, alice.get("remainingMinutes"), "剩余=max(预估-实际,0)");
        assertEquals(1, alice.get("workdays"));
        assertEquals(480, alice.get("capacityMinutes"));
        assertEquals(121, alice.get("loadPct"));
        assertEquals(true, alice.get("overloaded"));
        assertEquals(60, alice.get("weekMinutes"));
        assertEquals(30, alice.get("lastWeekMinutes"));
        assertEquals(Arrays.asList(0, 0, 60, 0, 0, 0, 0), alice.get("dayMinutes"));
        List<Map<String, Object>> tasks = castList(alice.get("tasks"));
        assertEquals(1, tasks.size(), "完成列任务不能进入工作量");
        assertEquals(120, tasks.get(0).get("totalMinutes"));
        assertEquals("项目一", tasks.get(0).get("reqName"));
        assertEquals("2026-11-09", workload.get("weekStart"), "周视图下钻需要周一日期");
        List<Map<String, Object>> aliceLogs = castList(alice.get("weekLogs"));
        assertEquals(1, aliceLogs.size(), "本周计时明细用于按周下钻，上周记录不进入");
        assertEquals(TODAY.toString(), aliceLogs.get(0).get("date"));
        assertEquals("T1", aliceLogs.get(0).get("taskId"));
        assertEquals("T1", aliceLogs.get(0).get("title"));
        assertEquals("项目一", aliceLogs.get(0).get("reqName"));
        assertEquals(60, aliceLogs.get(0).get("minutes"));
        List<Map<String, Object>> loggedOnlyLogs = castList(member(members, "U2").get("weekLogs"));
        assertEquals(1, loggedOnlyLogs.size());
        assertEquals("未关联工作项", loggedOnlyLogs.get(0).get("title"));
        assertEquals("未归类", loggedOnlyLogs.get(0).get("reqName"));
        assertEquals("2026-11-02", workload.get("lastWeekStart"), "上周对比下钻需要上周周一日期");
        List<Map<String, Object>> aliceLastLogs = castList(alice.get("lastWeekLogs"));
        assertEquals(1, aliceLastLogs.size(), "上周计时明细用于差异下钻，本周记录不进入");
        assertEquals(TODAY.minusWeeks(1).toString(), aliceLastLogs.get(0).get("date"));
        assertEquals(30, aliceLastLogs.get(0).get("minutes"));
        assertEquals(0, castList(member(members, "U2").get("lastWeekLogs")).size());
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

    @Test
    void workloadRangeSumsOnlyInsideRangeAndScalesCapacityByWorkdays() {
        Requirement requirement = requirement("R1", "项目一");
        Task task = openTask("T1", "R1", Consts.COL_DOING, 700);
        task.setOwnerUserId("U1");
        task.setDueDate(TODAY);
        WorkspaceMember member = new WorkspaceMember();
        member.setUserId("U1");
        member.setDisplayName("Alice");

        TimeLog inside = timeLog("U1", "T1", TODAY.atTime(9, 0), 60);
        TimeLog alsoInside = timeLog("U1", "T1", TODAY.minusDays(5).atTime(9, 0), 90);
        TimeLog outside = timeLog("U1", "T1", TODAY.minusDays(30).atTime(9, 0), 500);
        ManagerService service = service(Collections.singletonList(task), Collections.singletonList(requirement),
                Collections.<TimeAgg>emptyList(), Arrays.asList(inside, alsoInside, outside),
                Collections.singletonList(member));

        /* 连续 14 天必含 10 个工作日，与起算日是周几无关 */
        Map<String, Object> range = service.workload(WORKSPACE, VIEWER, TODAY.minusDays(13), TODAY);
        assertEquals("2026-10-29", range.get("rangeFrom"));
        assertEquals(TODAY.toString(), range.get("rangeTo"));
        assertEquals(10, range.get("rangeWorkdays"), "区间容量按区间内工作日折算，不能沿用 5 天周容量");
        Map<String, Object> alice = member(castList(range.get("members")), "U1");
        assertEquals(150, alice.get("rangeMinutes"), "区间外的计时不能混进区间合计");
        assertEquals(60, alice.get("weekMinutes"), "周口径与区间口径同时产出，桌面端不受影响");

        Map<String, Object> clamped = service.workload(WORKSPACE, VIEWER, TODAY.minusDays(200), TODAY);
        assertEquals(TODAY.minusDays(91).toString(), clamped.get("rangeFrom"), "超长区间从终点往前截到 92 天");

        Map<String, Object> swapped = service.workload(WORKSPACE, VIEWER, TODAY, TODAY.minusDays(3));
        assertEquals(TODAY.minusDays(3).toString(), swapped.get("rangeFrom"), "起终点写反要自动交换");
        assertEquals(TODAY.toString(), swapped.get("rangeTo"));

        Map<String, Object> plain = service.workload(WORKSPACE, VIEWER);
        assertNull(plain.get("rangeFrom"), "桌面端不传区间时不产出区间字段");
        assertNull(member(castList(plain.get("members")), "U1").get("rangeMinutes"));
    }

    @Test
    void legacyTextOwnerMergesIntoResolvedAccountWithoutDoublingHours() {
        Requirement requirement = requirement("R1", "项目一");
        Task byId = openTask("T1", "R1", Consts.COL_DOING, 120);
        byId.setOwnerUserId("U1");
        byId.setDueDate(TODAY);
        /* 历史数据：只有负责人文本，没有账号ID */
        Task byName = openTask("T2", "R1", Consts.COL_BACKLOG, 60);
        byName.setOwner("Alice");
        byName.setDueDate(TODAY);
        WorkspaceMember member = new WorkspaceMember();
        member.setUserId("U1");
        member.setDisplayName("Alice");
        TimeLog log = timeLog("U1", "T1", TODAY.atTime(9, 0), 90);
        ManagerService service = service(Arrays.asList(byId, byName), Collections.singletonList(requirement),
                Collections.<TimeAgg>emptyList(), Collections.singletonList(log),
                Collections.singletonList(member));

        Map<String, Object> range = service.workload(WORKSPACE, VIEWER, TODAY.minusDays(6), TODAY);
        List<Map<String, Object>> members = castList(range.get("members"));
        assertEquals(1, members.size(), "同一账号的按ID与按名字任务必须合成一行");
        assertNull(member(members, "Alice"), "能解析到成员的文本负责人不能单独成行");
        assertEquals(90, member(members, "U1").get("rangeMinutes"), "工时只统计一遍");
    }

    @Test
    void defectTrendCountsOpenedClosedAndOpenByWeek() {
        Task openBug = openTask("T1", "R1", Consts.COL_DOING, 100);
        openBug.setItemType("bug");
        openBug.setCreatedAt(TODAY.minusDays(1).atStartOfDay());
        openBug.setSeverity("major");

        Task closedBug = openTask("T2", "R1", Consts.COL_DONE, 100);
        closedBug.setItemType("bug");
        closedBug.setCreatedAt(LocalDate.of(2026, 10, 6).atStartOfDay());
        closedBug.setCompletedAt(TODAY.minusDays(1));

        Task oldClosedBug = openTask("T3", "R1", Consts.COL_DONE, 100);
        oldClosedBug.setItemType("bug");
        oldClosedBug.setCreatedAt(LocalDate.of(2026, 10, 21).atStartOfDay());
        oldClosedBug.setCompletedAt(LocalDate.of(2026, 10, 22));

        Task story = openTask("T4", "R1", Consts.COL_BACKLOG, 100);
        story.setItemType("story");
        story.setCreatedAt(TODAY.minusDays(1).atStartOfDay());

        ManagerService service = service(Arrays.asList(openBug, closedBug, oldClosedBug, story),
                Collections.singletonList(requirement("R1", "项目一")), Collections.<TimeAgg>emptyList(),
                Collections.<TimeLog>emptyList(), Collections.<WorkspaceMember>emptyList());
        Map<String, Object> defects = castMap(service.reports(WORKSPACE, null, VIEWER).get("defects"));

        List<Map<String, Object>> weeks = castList(defects.get("weeks"));
        assertEquals(8, weeks.size());
        assertEquals(1, defects.get("openCount"), "存量只统计最后一周周末仍未关闭的缺陷");

        Map<String, Object> current = week(weeks, LocalDate.of(2026, 11, 9));
        assertEquals(1, current.get("opened"), "本周新增只算 bug");
        assertEquals(1, current.get("closed"), "本周关闭只算 bug");
        assertEquals(1, current.get("open"));

        Map<String, Object> historical = week(weeks, LocalDate.of(2026, 10, 19));
        assertEquals(1, historical.get("opened"));
        assertEquals(1, historical.get("closed"));
        assertEquals(1, historical.get("open"), "当周即关闭的缺陷不计入周末存量（否则为 2）");
    }

    @Test
    void nudgesCountOnlyNotificationsActuallyWrittenAndReportDeduped() {
        Task fresh = openTask("T1", "R1", Consts.COL_BACKLOG, 60);
        fresh.setOwnerUserId("U1");
        Task recent = openTask("T2", "R1", Consts.COL_BACKLOG, 60);
        recent.setOwnerUserId("U1");
        WorkspaceMember member = new WorkspaceMember();
        member.setUserId("U1");
        member.setDisplayName("Alice");
        ProjectAccessService access = mock(ProjectAccessService.class);
        when(access.canManage(WORKSPACE, "M1")).thenReturn(true);
        when(access.hiddenProjectIds(WORKSPACE, "M1")).thenReturn(Collections.<String>emptySet());
        when(access.canViewTask(eq(WORKSPACE), eq("U1"), any(Task.class))).thenReturn(true);
        ManagerService service = service(Arrays.asList(fresh, recent), Collections.<Requirement>emptyList(),
                Collections.<TimeAgg>emptyList(), Collections.<TimeLog>emptyList(),
                Collections.singletonList(member), access);
        when(notificationService.push(eq("U1"), eq(WORKSPACE), eq("manager_nudge"), any(), any(), eq("T1"))).thenReturn(true);
        when(notificationService.push(eq("U1"), eq(WORKSPACE), eq("manager_nudge"), any(), any(), eq("T2"))).thenReturn(false);

        Map<String, Object> result = service.nudges(WORKSPACE, "M1", Arrays.asList("T1", "T2"));
        assertEquals(1, result.get("sent"), "6 小时去重命中的不计入已发送");
        assertEquals(1, result.get("deduped"));
        assertEquals(0, result.get("skipped"));
    }

    @Test
    void projectModulesReconcileWithProjectTotals() {
        Requirement req = requirement("R1", "项目一");
        Category sales = category("G1", "客户与会员");
        Category empty = category("G2", "空模块");

        Task done = openTask("T1", "R1", Consts.COL_DONE, 60);
        done.setCategoryId("G1");
        done.setTotalMinutes(120);
        done.setCompletedAt(TODAY);
        Task doing = openTask("T2", "R1", Consts.COL_DOING, 60);
        doing.setCategoryId("G1");
        doing.setTotalMinutes(30);
        doing.setProgress(50);
        Task unassigned = openTask("T3", "R1", Consts.COL_BACKLOG, 30);
        unassigned.setCategoryId("");
        unassigned.setTotalMinutes(0);

        ManagerService service = service(Arrays.asList(done, doing, unassigned),
                Collections.singletonList(req), Arrays.asList(actual("T1", 120), actual("T2", 30)),
                Collections.<TimeLog>emptyList(), Collections.<WorkspaceMember>emptyList());
        when(categoryService.list(WORKSPACE, "R1")).thenReturn(Arrays.asList(sales, empty));
        Map<String, Object> result = service.project(WORKSPACE, "R1", VIEWER);

        List<Map<String, Object>> modules = castList(result.get("modules"));
        assertEquals(2, modules.size(), "零工作项的模块也要列出");
        Map<String, Object> first = modules.get(0);
        assertEquals("客户与会员", first.get("name"));
        assertEquals(2, first.get("total"));
        assertEquals(1, first.get("done"));
        assertEquals(120, first.get("estimateMinutes"));
        assertEquals(150, first.get("actualMinutes"));
        assertEquals(30, first.get("remainingMinutes"), "只剩未完成工作项的预估差额");
        assertEquals(75, first.get("progressPct"), "模块进度按工作项完成度平均");
        assertEquals(100.0, ((Number) first.get("deviationPct")).doubleValue(), 0.001);
        Map<String, Object> emptyModule = modules.get(1);
        assertEquals(0, emptyModule.get("total"));
        assertEquals(0, emptyModule.get("progressPct"));
        assertNull(emptyModule.get("deviationPct"));

        Map<String, Object> unassignedRow = castMap(result.get("unassigned"));
        assertEquals(1, unassignedRow.get("total"));
        assertEquals(30, unassignedRow.get("estimateMinutes"));

        Map<String, Object> projectMetrics = castMap(result.get("metrics"));
        assertEquals(150, projectMetrics.get("estimateMinutes"));
        assertEquals(150, projectMetrics.get("actualMinutes"));
        assertEquals(60, projectMetrics.get("remainingMinutes"), "模块剩余 30 + 未指定 30");
        assertEquals(50, projectMetrics.get("progressPct"), "项目进度按全部工作项计算，不是模块百分比平均");
        assertEquals((Integer) 150, (Integer) first.get("estimateMinutes") + (Integer) unassignedRow.get("estimateMinutes"),
                "Σ模块 + 未指定 = 项目合计");
        assertFalse((Boolean) result.get("canManageModules"));

        when(releasePermission.canManageProject(VIEWER, WORKSPACE, "R1")).thenReturn(true);
        assertTrue((Boolean) service.project(WORKSPACE, "R1", VIEWER).get("canManageModules"));
    }

    @Test
    void projectLabelsInheritWorkspaceJobAndAllowProjectOverrideAndSecondaryRoles() {
        WorkspaceMember alice = workspaceMember("U1", "Alice", " 公司A ", " 开发 ");
        Task byId = ownedTask("T1", "R1", "U1", 100);
        Task byName = openTask("T2", "R1", Consts.COL_BACKLOG, 100);
        byName.setOwner("Alice");
        Task otherProject = ownedTask("T3", "R2", "U1", 200);
        when(roleMapper.selectByProject(WORKSPACE, "R1"))
                .thenReturn(Collections.singletonList(role("R1", "U1", "  ", " 测试 ", "测试", " ")));
        when(roleMapper.selectByProject(WORKSPACE, "R2"))
                .thenReturn(Collections.singletonList(role("R2", "U1", "架构")));
        ManagerService service = service(Arrays.asList(byId, byName, otherProject),
                Arrays.asList(requirement("R1", "一"), requirement("R2", "二")),
                Collections.<TimeAgg>emptyList(), Collections.<TimeLog>emptyList(), Collections.singletonList(alice));

        Map<String, Object> inherited = member(castList(service.project(WORKSPACE, "R1", VIEWER).get("members")), "U1");
        assertEquals("U1", inherited.get("userId"));
        assertEquals("公司A", inherited.get("companyName"));
        assertEquals("开发", inherited.get("jobTitle"));
        assertEquals("开发", inherited.get("effectiveRoleTitle"));
        assertEquals(Collections.singletonList("测试"), inherited.get("secondaryRoleTitles"));
        assertEquals(2, inherited.get("taskCount"), "历史文本负责人也继承同一成员的标签");
        Map<String, Object> overridden = member(castList(service.project(WORKSPACE, "R2", VIEWER).get("members")), "U1");
        assertEquals("架构", overridden.get("effectiveRoleTitle"));
        assertEquals("开发", overridden.get("jobTitle"));
        verify(roleMapper, times(1)).selectByProject(WORKSPACE, "R1");
        verify(roleMapper, times(1)).selectByProject(WORKSPACE, "R2");
    }

    @Test
    void filtersMatchInheritedPrimaryAndSecondaryButNotOverriddenWorkspaceJob() {
        WorkspaceMember alice = workspaceMember("U1", "Alice", "A", "开发");
        WorkspaceMember bob = workspaceMember("U2", "Bob", "B", "运维");
        Task first = ownedTask("T1", "R1", "U1", 100);
        Task second = ownedTask("T2", "R1", "U2", 200);
        when(roleMapper.selectByProject(WORKSPACE, "R1")).thenReturn(Arrays.asList(
                role("R1", "U1", " ", "评审"), role("R1", "U2", "测试")));
        ManagerService service = service(Arrays.asList(first, second), Collections.singletonList(requirement("R1", "一")),
                Collections.<TimeAgg>emptyList(), Collections.<TimeLog>emptyList(), Arrays.asList(alice, bob));

        Map<String, Object> inherited = service.reports(WORKSPACE, " R1 ", VIEWER, " 开发 ", " A ");
        assertEquals(100, castMap(inherited.get("burndown")).get("totalEstimateMinutes"));
        assertEquals(100, castMap(service.reports(WORKSPACE, "R1", VIEWER, "评审", null).get("burndown"))
                .get("totalEstimateMinutes"));
        assertEquals(0, castMap(service.reports(WORKSPACE, "R1", VIEWER, "运维", null).get("burndown"))
                .get("totalEstimateMinutes"), "项目主角色覆盖空间职能后，不能再按空间职能命中");
        Map<String, Object> options = castMap(inherited.get("filterOptions"));
        assertEquals(Arrays.asList("开发", "测试", "评审"), options.get("roleTitles"));
        assertEquals(Arrays.asList("A", "B"), options.get("companyNames"), "选中公司后其他候选不丢失");
        assertEquals("R1", castMap(inherited.get("scope")).get("reqId"));
        assertEquals("开发", castMap(inherited.get("scope")).get("roleTitle"));
        assertEquals("A", castMap(inherited.get("scope")).get("companyName"));
        Map<String, Object> workload = service.workload(WORKSPACE, VIEWER, "R1", "评审", "A");
        assertEquals(1, castList(workload.get("members")).size());
        assertEquals("开发", member(castList(workload.get("members")), "U1").get("effectiveRoleTitle"));
        assertEquals(options, workload.get("filterOptions"));
    }

    @Test
    void sameMemberRolesStayProjectSpecificWhenRecalculatingWorkload() {
        WorkspaceMember alice = workspaceMember("U1", "Alice", "A", "运维");
        Task dev = ownedTask("T1", "R1", "U1", 120);
        Task qa = ownedTask("T2", "R2", "U1", 400);
        Task inherited = ownedTask("T3", "R3", "U1", 80);
        when(roleMapper.selectByProject(WORKSPACE, "R1"))
                .thenReturn(Collections.singletonList(role("R1", "U1", "开发", "评审")));
        when(roleMapper.selectByProject(WORKSPACE, "R2"))
                .thenReturn(Collections.singletonList(role("R2", "U1", "测试")));
        ManagerService service = service(Arrays.asList(dev, qa, inherited), Arrays.asList(
                requirement("R1", "开发项目"), requirement("R2", "测试项目"), requirement("R3", "继承项目")),
                Arrays.asList(actual("T1", 30), actual("T2", 40)), Arrays.asList(
                        timeLog("U1", "T1", TODAY.atTime(9, 0), 30),
                        timeLog("U1", "T2", TODAY.atTime(10, 0), 40)), Collections.singletonList(alice));

        Map<String, Object> all = service.workload(WORKSPACE, VIEWER);
        Map<String, Object> row = member(castList(all.get("members")), "U1");
        assertEquals("运维", row.get("effectiveRoleTitle"), "跨项目不能把第一个项目角色当全局主角色");
        assertEquals(Arrays.asList("开发", "测试", "评审", "运维"), row.get("roleTitles"));
        Map<String, Object> filtered = service.workload(WORKSPACE, VIEWER, null, "开发", null);
        Map<String, Object> devRow = member(castList(filtered.get("members")), "U1");
        assertEquals(90, devRow.get("remainingMinutes"));
        assertEquals(30, devRow.get("weekMinutes"));
        assertEquals(1, castList(devRow.get("tasks")).size());
        assertEquals("T1", castList(devRow.get("tasks")).get(0).get("id"));
        List<Map<String, Object>> distribution = castList(devRow.get("projects"));
        assertEquals(1, distribution.size());
        assertEquals("R1", distribution.get(0).get("reqId"));
        assertEquals(Arrays.asList("开发", "评审"), distribution.get(0).get("roleTitles"));
        assertEquals(Arrays.asList("开发", "评审"), devRow.get("roleTitles"));
        assertEquals(all.get("filterOptions"), filtered.get("filterOptions"));
        assertEquals(400, castMap(service.reports(WORKSPACE, null, VIEWER, "测试", null).get("burndown"))
                .get("totalEstimateMinutes"));
        Map<String, Object> projectOnly = service.workload(WORKSPACE, VIEWER, " R2 ", null, null);
        assertEquals("测试", member(castList(projectOnly.get("members")), "U1").get("effectiveRoleTitle"));
        assertEquals(40, member(castList(projectOnly.get("members")), "U1").get("weekMinutes"));
        assertEquals(1, castList(projectOnly.get("projects")).size());
    }

    @Test
    void workloadFiltersTasksAndAllTimeWindowsByTaskOwnerNotLogActor() {
        WorkspaceMember alice = workspaceMember("U1", "Alice", "A", "开发");
        WorkspaceMember bob = workspaceMember("U2", "Bob", "B", "测试");
        Task first = ownedTask("T1", "R1", "U1", 300);
        first.setDueDate(TODAY);
        Task excluded = ownedTask("T2", "R1", "U2", 900);
        Task done = ownedTask("T3", "R1", "U1", 5000);
        done.setBoardColumn(Consts.COL_DONE);
        Task otherProject = ownedTask("T4", "R2", "U1", 600);
        ManagerService service = service(Arrays.asList(first, excluded, done, otherProject),
                Arrays.asList(requirement("R1", "一"), requirement("R2", "二")),
                Collections.singletonList(actual("T1", 60)), Arrays.asList(
                        timeLog("U1", "T1", TODAY.atTime(9, 0), 20),
                        timeLog("U2", "T1", TODAY.atTime(10, 0), 45),
                        timeLog("U2", "T3", TODAY.atTime(11, 0), 15),
                        timeLog("U1", "T2", TODAY.atTime(12, 0), 200),
                        timeLog("U1", "T4", TODAY.atTime(13, 0), 300),
                        timeLog("U1", null, TODAY.atTime(14, 0), 400),
                        timeLog("U1", "T1", TODAY.minusWeeks(1).atTime(9, 0), 10),
                        timeLog("U1", "T2", TODAY.minusWeeks(1).atTime(9, 0), 100),
                        timeLog("U1", "T1", TODAY.minusDays(10).atTime(9, 0), 70)), Arrays.asList(alice, bob));

        Map<String, Object> filtered = service.workload(WORKSPACE, VIEWER, TODAY.minusDays(13), TODAY,
                "R1", "开发", "A");
        Map<String, Object> aliceRow = member(castList(filtered.get("members")), "U1");
        assertEquals(240, aliceRow.get("remainingMinutes"));
        assertEquals(50, aliceRow.get("loadPct"));
        assertEquals(20, aliceRow.get("weekMinutes"));
        assertEquals(10, aliceRow.get("lastWeekMinutes"));
        assertEquals(100, aliceRow.get("rangeMinutes"));
        assertEquals(Arrays.asList(0, 0, 20, 0, 0, 0, 0), aliceRow.get("dayMinutes"));
        assertEquals(1, castList(aliceRow.get("tasks")).size(), "完成列仍按原算法不计开放工作量");
        assertEquals(1, castList(aliceRow.get("projects")).size());
        assertEquals(1, castList(aliceRow.get("weekLogs")).size(), "下钻/导出明细与统计必须同源");
        assertEquals("T1", castList(aliceRow.get("weekLogs")).get(0).get("taskId"));
        Map<String, Object> bobRow = member(castList(filtered.get("members")), "U2");
        assertEquals(0, bobRow.get("remainingMinutes"));
        assertEquals(60, bobRow.get("weekMinutes"), "计时人职能不匹配也保留其在匹配负责人任务上的计时");
        assertEquals(2, castList(bobRow.get("weekLogs")).size(), "匹配的完成任务计时仍保留");
        assertEquals("B", bobRow.get("companyName"));
        assertEquals(Arrays.asList("A", "B"), castMap(filtered.get("filterOptions")).get("companyNames"));
    }

    @Test
    void reportsRecalculateAllFiveChartsFromMatchingOwners() {
        WorkspaceMember alice = workspaceMember("U1", "Alice", "A", "开发");
        WorkspaceMember bob = workspaceMember("U2", "Bob", "B", "测试");
        Task open = ownedTask("T1", "R1", "U1", 100);
        open.setItemType("bug");
        Task done = ownedTask("T2", "R1", "U1", 200);
        done.setItemType("bug");
        done.setBoardColumn(Consts.COL_DONE);
        done.setStartDate(TODAY.minusDays(3));
        done.setCompletedAt(TODAY.minusDays(1));
        Task excluded = ownedTask("T3", "R1", "U2", 900);
        excluded.setItemType("bug");
        ManagerService service = service(Arrays.asList(open, done, excluded), Collections.singletonList(requirement("R1", "一")),
                Collections.singletonList(actual("T2", 80)), Collections.<TimeLog>emptyList(), Arrays.asList(alice, bob));

        Map<String, Object> reports = service.reports(WORKSPACE, "R1", VIEWER, "开发", "A");
        assertEquals(300, castMap(reports.get("burndown")).get("totalEstimateMinutes"));
        assertEquals(220, castMap(reports.get("burndown")).get("remainingMinutes"));
        assertEquals(20, castMap(reports.get("velocity")).get("averageMinutes"));
        Map<String, Object> velocityWeek = week(castList(castMap(reports.get("velocity")).get("weeks")), TODAY.minusDays(2));
        assertEquals(1, velocityWeek.get("completedCount"));
        Map<String, Object> flowWeek = week(castList(castMap(reports.get("flow")).get("weeks")), TODAY.minusDays(2));
        assertEquals(1, flowWeek.get("doing"));
        assertEquals(1, flowWeek.get("done"));
        assertEquals(2L, castMap(reports.get("delivery")).get("p50Days"));
        assertEquals(1, castList(castMap(reports.get("delivery")).get("buckets")).get(1).get("count"));
        assertEquals(1, castMap(reports.get("defects")).get("openCount"));
        Map<String, Object> defectWeek = week(castList(castMap(reports.get("defects")).get("weeks")), TODAY.minusDays(2));
        assertEquals(2, defectWeek.get("opened"));
        assertEquals(1, defectWeek.get("closed"));
    }

    @Test
    void unsetMatchesOnlyEntirelyBlankRolesAndBlankCompanyIncludingUnassigned() {
        WorkspaceMember blank = workspaceMember("U1", "Blank", "  ", " ");
        WorkspaceMember secondary = workspaceMember("U2", "Secondary", null, null);
        Task first = ownedTask("T1", "R1", "U1", 100);
        Task second = ownedTask("T2", "R1", "U2", 200);
        Task unassigned = openTask("T3", "R1", Consts.COL_BACKLOG, 300);
        when(roleMapper.selectByProject(WORKSPACE, "R1")).thenReturn(Arrays.asList(
                role("R1", "U1", " ", " "), role("R1", "U2", null, "测试")));
        ManagerService service = service(Arrays.asList(first, second, unassigned), Collections.singletonList(requirement("R1", "一")),
                Collections.<TimeAgg>emptyList(), Collections.<TimeLog>emptyList(), Arrays.asList(blank, secondary));

        Map<String, Object> unset = service.reports(WORKSPACE, "R1", VIEWER, "__unset__", "__unset__");
        assertEquals(400, castMap(unset.get("burndown")).get("totalEstimateMinutes"), "有兼岗就不属于未标角色");
        assertEquals(Arrays.asList("__unset__", "测试"), castMap(unset.get("filterOptions")).get("roleTitles"));
        assertEquals(Collections.singletonList("__unset__"), castMap(unset.get("filterOptions")).get("companyNames"));
        assertEquals(600, castMap(service.reports(WORKSPACE, "R1", VIEWER, null, "__unset__").get("burndown"))
                .get("totalEstimateMinutes"));
        Map<String, Object> workload = service.workload(WORKSPACE, VIEWER, "R1", "__unset__", "__unset__");
        assertNull(member(castList(workload.get("members")), "U2"));
        Map<String, Object> row = member(castList(workload.get("members")), "U1");
        assertNull(row.get("effectiveRoleTitle"));
        assertNull(row.get("companyName"));
        assertEquals(Collections.emptyList(), row.get("roleTitles"));
        assertNull(member(castList(workload.get("members")), "unassigned").get("userId"));
    }

    @Test
    void hiddenProjectsNeverSupplyFilterOptionsOrTriggerRoleLookup() {
        WorkspaceMember alice = workspaceMember("U1", "Alice", "A", "开发");
        WorkspaceMember secret = workspaceMember("U2", "Secret", "秘密公司", "秘密职能");
        Task visible = ownedTask("T1", "R1", "U1", 100);
        Task hidden = ownedTask("T2", "R2", "U2", 200);
        ProjectAccessService access = mock(ProjectAccessService.class);
        when(access.hiddenProjectIds(WORKSPACE, VIEWER)).thenReturn(Collections.singleton("R2"));
        ManagerService service = service(Arrays.asList(visible, hidden),
                Arrays.asList(requirement("R1", "一"), requirement("R2", "隐藏")), Collections.<TimeAgg>emptyList(),
                Arrays.asList(timeLog("U1", "T1", TODAY.atTime(9, 0), 20),
                        timeLog("U2", "T2", TODAY.atTime(10, 0), 999)), Arrays.asList(alice, secret), access);

        Map<String, Object> workload = service.workload(WORKSPACE, VIEWER, null, "开发", "A");
        assertEquals(Collections.singletonList("开发"), castMap(workload.get("filterOptions")).get("roleTitles"));
        assertEquals(Collections.singletonList("A"), castMap(workload.get("filterOptions")).get("companyNames"));
        assertEquals(1, castList(workload.get("members")).size());
        assertEquals(20, member(castList(workload.get("members")), "U1").get("weekMinutes"));
        assertEquals(workload.get("filterOptions"), service.reports(WORKSPACE, null, VIEWER).get("filterOptions"));
        assertEquals(404, assertThrows(AppException.class,
                () -> service.workload(WORKSPACE, VIEWER, " R2 ", null, null)).getCode());
        assertEquals(404, assertThrows(AppException.class,
                () -> service.reports(WORKSPACE, "R2", VIEWER, null, null)).getCode());
        assertEquals(404, assertThrows(AppException.class,
                () -> service.project(WORKSPACE, "R2", VIEWER)).getCode());
        verify(roleMapper, never()).selectByProject(WORKSPACE, "R2");
        verify(roleMapper, times(2)).selectByProject(WORKSPACE, "R1");
        verify(roleMapper, never()).selectOne(any(), any(), any());
    }

    @Test
    void displayFilterValidationTrimsAndKeepsOriginalConstructorsOptional() {
        Task task = ownedTask("T1", "R1", "U1", 100);
        String maxRole = String.join("", Collections.nCopies(32, "职"));
        String maxCompany = String.join("", Collections.nCopies(64, "司"));
        WorkspaceMember alice = workspaceMember("U1", "Alice", maxCompany, maxRole);
        ManagerService service = service(Collections.singletonList(task), Collections.singletonList(requirement("R1", "一")),
                Collections.<TimeAgg>emptyList(), Collections.<TimeLog>emptyList(), Collections.singletonList(alice));
        ReflectionTestUtils.setField(service, "roleMapper", null);

        Map<String, Object> boundary = service.reports(WORKSPACE, null, VIEWER, " " + maxRole + " ", " " + maxCompany + " ");
        assertEquals(100, castMap(boundary.get("burndown")).get("totalEstimateMinutes"));
        assertEquals(400, assertThrows(AppException.class,
                () -> service.reports(WORKSPACE, null, VIEWER, maxRole + "职", null)).getCode());
        assertEquals(400, assertThrows(AppException.class,
                () -> service.workload(WORKSPACE, VIEWER, null, null, maxCompany + "司")).getCode());
        Map<String, Object> blanks = service.workload(WORKSPACE, VIEWER, " ", " ", " ");
        assertNull(castMap(blanks.get("scope")).get("reqId"));
        assertNull(castMap(blanks.get("scope")).get("roleTitle"));
        assertNull(castMap(blanks.get("scope")).get("companyName"));
        assertEquals(100, member(castList(blanks.get("members")), "U1").get("remainingMinutes"));
    }

    @Test
    void ambiguousLegacyNamesRemainUnresolvedAndSupplementaryLabelsAreValid() {
        Task task = openTask("T1", "R1", Consts.COL_DOING, 100);
        task.setOwner("同名");
        String supplementary = String.join("", Collections.nCopies(32, "𠀀"));
        WorkspaceMember first = workspaceMember("U1", "同名", "甲", supplementary);
        WorkspaceMember second = workspaceMember("U2", "同名", "乙", "测试");
        ManagerService service = service(Collections.singletonList(task), Collections.singletonList(requirement("R1", "一")),
                Collections.<TimeAgg>emptyList(), Collections.<TimeLog>emptyList(), Arrays.asList(first, second));
        assertEquals(0, castMap(service.reports(WORKSPACE, null, VIEWER, supplementary, null).get("burndown")).get("totalEstimateMinutes"));
        assertEquals(100, castMap(service.reports(WORKSPACE, null, VIEWER, "__unset__", "__unset__").get("burndown")).get("totalEstimateMinutes"));
        task.setOwnerUserId("U1");
        assertEquals(100, castMap(service.reports(WORKSPACE, null, VIEWER, supplementary, "甲").get("burndown")).get("totalEstimateMinutes"));
    }

    @Test
    void literalUnsetAndEscapedPrefixLabelsDoNotCollideWithUnsetFilters() {
        Task task = ownedTask("T1", "R1", "U1", 100);
        WorkspaceMember member = workspaceMember("U1", "一", "__label__:公司", "__unset__");
        ManagerService service = service(Collections.singletonList(task), Collections.singletonList(requirement("R1", "一")),
                Collections.<TimeAgg>emptyList(), Collections.<TimeLog>emptyList(), Collections.singletonList(member));
        Map<String, Object> result = service.reports(WORKSPACE, null, VIEWER, "__label__:__unset__", "__label__:__label__:公司");
        assertEquals(100, castMap(result.get("burndown")).get("totalEstimateMinutes"));
        assertEquals(Collections.singletonList("__label__:__unset__"), castMap(result.get("filterOptions")).get("roleTitles"));
        assertEquals("__label__:__unset__", castMap(result.get("scope")).get("roleTitle"));
        assertEquals(0, castMap(service.reports(WORKSPACE, null, VIEWER, "__unset__", null).get("burndown")).get("totalEstimateMinutes"));
    }

    private WorkspaceMember workspaceMember(String id, String name, String company, String job) {
        WorkspaceMember member = new WorkspaceMember();
        member.setUserId(id);
        member.setDisplayName(name);
        member.setCompanyName(company);
        member.setJobTitle(job);
        return member;
    }

    private ProjectMemberRole role(String projectId, String userId, String title, String... secondary) {
        ProjectMemberRole role = new ProjectMemberRole();
        role.setWorkspaceId(WORKSPACE);
        role.setProjectId(projectId);
        role.setUserId(userId);
        role.setRoleTitle(title);
        role.setSecondaryRoleTitles(Arrays.asList(secondary));
        return role;
    }

    private Task ownedTask(String id, String reqId, String ownerId, int estimate) {
        Task task = openTask(id, reqId, Consts.COL_DOING, estimate);
        task.setOwnerUserId(ownerId);
        return task;
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
        when(categoryService.list(eq(WORKSPACE), any())).thenReturn(Collections.<Category>emptyList());
        when(releasePermission.canManageProject(any(), eq(WORKSPACE), any())).thenReturn(false);
        ManagerService service = new ManagerService(taskMapper, requirementMapper, timeLogMapper, memberMapper,
                notificationService, access, categoryService, releasePermission, CLOCK);
        ReflectionTestUtils.setField(service, "roleMapper", roleMapper);
        return service;
    }

    private Requirement requirement(String id, String name) {
        Requirement requirement = new Requirement();
        requirement.setId(id);
        requirement.setWorkspaceId(WORKSPACE);
        requirement.setName(name);
        requirement.setStatus("active");
        return requirement;
    }

    private Category category(String id, String name) {
        Category category = new Category();
        category.setId(id);
        category.setWorkspaceId(WORKSPACE);
        category.setProjectId("R1");
        category.setName(name);
        category.setColor("#2563eb");
        category.setSortOrder(0);
        return category;
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

    private Map<String, Object> week(List<Map<String, Object>> weeks, LocalDate start) {
        for (Map<String, Object> week : weeks) {
            if (start.equals(week.get("start"))) {
                return week;
            }
        }
        throw new AssertionError("周不存在：" + start);
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
