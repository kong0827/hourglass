package com.hourglass.service;

import com.hourglass.dto.DemandGanttPage;
import com.hourglass.dto.DemandQuery;
import com.hourglass.dto.DemandStage;
import com.hourglass.dto.DemandTimeline;
import com.hourglass.entity.Demand;
import com.hourglass.mapper.DemandMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 需求甘特阶段口径：只回放真实记录，计划字段与已取消状态不得把条形画长 */
class DemandServiceGanttTest {

    private final DemandMapper demands = mock(DemandMapper.class);
    private final DemandService service = new DemandService(demands, mock(com.hourglass.mapper.RequirementMapper.class),
            mock(com.hourglass.mapper.ProjectVersionMapper.class), mock(com.hourglass.mapper.TaskMapper.class),
            mock(NotificationEventService.class), mock(com.hourglass.mapper.RequirementDocMapper.class),
            mock(ProjectAccessService.class), mock(AttachmentService.class),
            mock(com.hourglass.mapper.MailDeliveryMapper.class), mock(com.hourglass.mapper.TestCaseMapper.class),
            mock(com.hourglass.mapper.CategoryMapper.class), mock(DeliveryScopeLock.class),
            mock(ReleasePermissionService.class), mock(DeletionTraceService.class));

    @Test
    void devStageStartsFromRealWorkNotPlannedDate() {
        Demand d = demand("plan");
        stubPage(d);
        when(demands.selectLogTimeline(eq("W1"), anyList())).thenReturn(Collections.singletonList(
                row("demandId", "D1", "passAt", date("2026-01-10"), "planAt", date("2026-01-12"))));
        /* 工作项聚合里混进一个计划开始日期，甘特不能读它 */
        when(demands.selectTaskTimeline(eq("W1"), anyList())).thenReturn(Collections.singletonList(
                row("demandId", "D1", "taskCount", 2, "taskDone", 0, "taskOpen", 2,
                        "devStart", date("2026-01-01"), "devEnd", null)));
        when(demands.selectTaskStartTimeline(eq("W1"), anyList())).thenReturn(Collections.singletonList(
                row("demandId", "D1", "devStart", date("2026-02-01"))));

        DemandStage dev = stage(gantt(d), "dev");

        assertEquals(date("2026-02-01"), dev.getStart());
        assertEquals(LocalDate.now(), dev.getEnd());
        assertTrue(dev.isOpen());
    }

    @Test
    void demandsWithoutRealStartHaveNoDevStage() {
        Demand d = demand("plan");
        stubPage(d);
        when(demands.selectTaskTimeline(eq("W1"), anyList())).thenReturn(Collections.singletonList(
                row("demandId", "D1", "taskCount", 3, "taskDone", 0, "taskOpen", 3,
                        "devStart", date("2026-01-01"), "devEnd", null)));

        assertNull(stage(gantt(d), "dev"));
    }

    @Test
    void canceledDemandWithoutReleaseEvidenceStopsAtCancelDate() {
        Demand d = demand("canceled");
        d.setVersionId("V1");
        stubPage(d);
        when(demands.selectLogTimeline(eq("W1"), anyList())).thenReturn(Collections.singletonList(
                row("demandId", "D1", "passAt", date("2026-01-10"), "planAt", date("2026-01-12"),
                        "cancelAt", date("2026-03-05"))));
        when(demands.selectTaskTimeline(eq("W1"), anyList())).thenReturn(Collections.singletonList(
                row("demandId", "D1", "taskCount", 1, "taskDone", 0, "taskOpen", 1, "devEnd", null)));
        when(demands.selectTaskStartTimeline(eq("W1"), anyList())).thenReturn(Collections.singletonList(
                row("demandId", "D1", "devStart", date("2026-02-01"))));
        /* 目标版本发布不代表该需求有成功发布条目。 */
        when(demands.selectDemandReleaseTimeline("W1", Collections.singletonList("D1")))
                .thenReturn(Collections.emptyList());

        DemandTimeline timeline = gantt(d);

        /* 评审停在通过日，开发停在取消日，取消后版本发布与这条需求无关 */
        assertEquals(date("2026-01-10"), stage(timeline, "review").getEnd());
        assertFalse(stage(timeline, "review").isOpen());
        DemandStage dev = stage(timeline, "dev");
        assertEquals(date("2026-03-05"), dev.getEnd());
        assertFalse(dev.isOpen());
        assertNull(stage(timeline, "release"));
        assertEquals(date("2026-03-05"), timeline.getEnd());
    }

    @Test
    void releaseEvidenceIsIndexedByDemandRegardlessOfCurrentTargetVersion() {
        Demand d = demand("plan");
        d.setVersionId("V-new");
        Demand other = demand("plan");
        other.setId("D2");
        other.setVersionId("V-new");
        Map<String, Object> count = countRow("plan");
        count.put("cnt", 2L);
        when(demands.countGroupByStatus(any(DemandQuery.class))).thenReturn(Collections.singletonList(count));
        when(demands.selectPage(any(DemandQuery.class))).thenReturn(Arrays.asList(d, other));
        when(demands.selectDemandReleaseTimeline("W1", Arrays.asList("D1", "D2")))
                .thenReturn(Collections.singletonList(row("demandId", "D1", "versionId", "V-old",
                        "releasedAt", date("2026-04-01"))));

        DemandGanttPage page = service.gantt("W1", "U1", query());

        assertEquals(2, page.getItems().size());
        DemandStage release = stage(page.getItems().get(0).getTimeline(), "release");
        assertNotNull(release);
        assertEquals(date("2026-04-01"), release.getEnd());
        assertNull(stage(page.getItems().get(1).getTimeline(), "release"));
        verify(demands).selectDemandReleaseTimeline("W1", Arrays.asList("D1", "D2"));
    }

    @Test
    void releasedTargetWithoutSuccessfulPublishedItemHasNoReleaseStage() {
        Demand d = demand("plan");
        d.setVersionId("V-released");
        stubPage(d);
        when(demands.selectDemandReleaseTimeline("W1", Collections.singletonList("D1")))
                .thenReturn(Collections.emptyList());

        assertNull(stage(gantt(d), "release"));
        verify(demands).selectDemandReleaseTimeline("W1", Collections.singletonList("D1"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"canceled", "pass"})
    void successfulReleaseEvidenceSurvivesCancelAndUnplan(String status) {
        Demand d = demand(status);
        if ("canceled".equals(status)) d.setVersionId("V-current");
        stubPage(d);
        when(demands.selectLogTimeline(eq("W1"), anyList())).thenReturn(Collections.singletonList(
                row("demandId", "D1", "passAt", date("2026-01-10"), "planAt", date("2026-01-12"),
                        "cancelAt", date("2026-03-05"))));
        when(demands.selectDemandReleaseTimeline("W1", Collections.singletonList("D1")))
                .thenReturn(Collections.singletonList(row("demandId", "D1", "releasedAt", date("2026-03-01"))));

        DemandStage release = stage(gantt(d), "release");

        assertNotNull(release);
        assertEquals(date("2026-03-01"), release.getStart());
        assertEquals(date("2026-03-01"), release.getEnd());
        assertTrue(release.isPoint());
        assertFalse(release.isOpen());
        verify(demands).selectDemandReleaseTimeline("W1", Collections.singletonList("D1"));
    }

    @Test
    void canceledFromReviewEndsAtCancelDate() {
        Demand d = demand("canceled");
        stubPage(d);
        when(demands.selectLogTimeline(eq("W1"), anyList())).thenReturn(Collections.singletonList(
                row("demandId", "D1", "cancelAt", date("2026-03-05"))));

        DemandStage review = stage(gantt(d), "review");

        assertEquals(date("2026-03-05"), review.getEnd());
        assertFalse(review.isOpen());
    }

    @Test
    void planStageSurvivesUnplanAndFollowsReplan() {
        Demand d = demand("pass");
        stubPage(d);
        when(demands.selectLogTimeline(eq("W1"), anyList())).thenReturn(Collections.singletonList(
                row("demandId", "D1", "passAt", date("2026-01-10"), "planAt", date("2026-01-12"),
                        "replanAt", date("2026-02-20"))));

        DemandStage plan = stage(gantt(d), "plan");

        assertEquals(date("2026-01-10"), plan.getStart());
        assertEquals(date("2026-02-20"), plan.getEnd());
    }

    @Test
    void reportsUntestedAndFailedCasesSeparatelyAndBlocksComplete() {
        Demand d = demand("plan");
        stubPage(d);
        when(demands.selectTaskTimeline(eq("W1"), anyList())).thenReturn(Collections.singletonList(
                row("demandId", "D1", "taskCount", 2, "taskDone", 2, "taskOpen", 0,
                        "devEnd", date("2026-03-01"))));
        when(demands.selectTaskStartTimeline(eq("W1"), anyList())).thenReturn(Collections.singletonList(
                row("demandId", "D1", "devStart", date("2026-02-01"))));
        when(demands.selectTestTimeline(eq("W1"), anyList())).thenReturn(Collections.singletonList(
                row("demandId", "D1", "caseCount", 3, "caseUntested", 1, "caseFailed", 1,
                        "testStart", date("2026-03-02"), "testEnd", date("2026-03-04"))));

        DemandTimeline timeline = gantt(d);

        assertEquals(1, timeline.getCaseUntested());
        assertEquals(1, timeline.getCaseFailed());
        assertEquals(2, timeline.getCasePending());
        assertTrue(stage(timeline, "test").isOpen());
        assertEquals(LocalDate.now(), stage(timeline, "test").getEnd());
        assertNull(stage(timeline, "complete"));
    }

    @Test
    void completePointNeedsAllCasesPassed() {
        Demand d = demand("plan");
        stubPage(d);
        when(demands.selectTaskTimeline(eq("W1"), anyList())).thenReturn(Collections.singletonList(
                row("demandId", "D1", "taskCount", 2, "taskDone", 2, "taskOpen", 0,
                        "devEnd", date("2026-03-01"))));
        when(demands.selectTaskStartTimeline(eq("W1"), anyList())).thenReturn(Collections.singletonList(
                row("demandId", "D1", "devStart", date("2026-02-01"))));
        when(demands.selectTestTimeline(eq("W1"), anyList())).thenReturn(Collections.singletonList(
                row("demandId", "D1", "caseCount", 3, "caseUntested", 0, "caseFailed", 0,
                        "testStart", date("2026-03-02"), "testEnd", date("2026-03-04"))));

        DemandTimeline timeline = gantt(d);

        DemandStage complete = stage(timeline, "complete");
        assertTrue(complete.isPoint());
        assertEquals(date("2026-03-04"), complete.getStart());
        assertEquals(0, timeline.getCasePending());
    }

    @Test
    void canceledAfterRejectStopsReviewAtRejectDate() {
        Demand d = demand("canceled");
        stubPage(d);
        when(demands.selectLogTimeline(eq("W1"), anyList())).thenReturn(Collections.singletonList(
                row("demandId", "D1", "rejAt", LocalDateTime.of(2026, 1, 20, 10, 0),
                        "cancelAt", LocalDateTime.of(2026, 3, 5, 9, 0))));

        DemandStage review = stage(gantt(d), "review");

        assertEquals(date("2026-01-20"), review.getEnd());
        assertFalse(review.isOpen());
    }

    @Test
    void canceledAfterSameDayReopenKeepsReviewUntilCancel() {
        Demand d = demand("canceled");
        stubPage(d);
        /* 同一天先拒绝后重新打开：只比日期会误判成「停在拒绝日」 */
        when(demands.selectLogTimeline(eq("W1"), anyList())).thenReturn(Collections.singletonList(
                row("demandId", "D1", "rejAt", LocalDateTime.of(2026, 1, 20, 10, 0),
                        "reviewReopenAt", LocalDateTime.of(2026, 1, 20, 11, 0),
                        "cancelAt", LocalDateTime.of(2026, 3, 5, 9, 0))));

        DemandStage review = stage(gantt(d), "review");

        assertEquals(date("2026-03-05"), review.getEnd());
        assertFalse(review.isOpen());
    }

    @Test
    void canceledWithPartlyDoneTasksStopsDevAtCancelDate() {
        Demand d = demand("canceled");
        stubPage(d);
        when(demands.selectLogTimeline(eq("W1"), anyList())).thenReturn(Collections.singletonList(
                row("demandId", "D1", "passAt", date("2026-01-10"), "cancelAt", date("2026-03-05"))));
        when(demands.selectTaskTimeline(eq("W1"), anyList())).thenReturn(Collections.singletonList(
                row("demandId", "D1", "taskCount", 2, "taskDone", 1, "taskOpen", 1,
                        "devEnd", date("2026-02-10"))));
        when(demands.selectTaskStartTimeline(eq("W1"), anyList())).thenReturn(Collections.singletonList(
                row("demandId", "D1", "devStart", date("2026-02-01"))));

        DemandStage dev = stage(gantt(d), "dev");

        assertEquals(date("2026-03-05"), dev.getEnd());
        assertFalse(dev.isOpen());
    }

    @Test
    void stalePlanBeforeLatestPassBecomesPointOnPlanDate() {
        Demand d = demand("pass");
        stubPage(d);
        /* 排期 → 撤排 → 撤回评审 → 再次通过：最后一次通过晚于旧排期 */
        when(demands.selectLogTimeline(eq("W1"), anyList())).thenReturn(Collections.singletonList(
                row("demandId", "D1", "passAt", date("2026-03-01"), "planAt", date("2026-01-12"))));

        DemandStage plan = stage(gantt(d), "plan");

        assertEquals(date("2026-01-12"), plan.getStart());
        assertEquals(date("2026-01-12"), plan.getEnd());
        assertTrue(plan.isPoint());
    }

    @Test
    void ganttQueriesReplayRecordsInsteadOfPlannedDates() throws Exception {
        org.apache.ibatis.session.Configuration configuration = new org.apache.ibatis.session.Configuration();
        configuration.getTypeAliasRegistry().registerAlias("Demand", Demand.class);
        configuration.getTypeAliasRegistry().registerAlias("Task", com.hourglass.entity.Task.class);
        String resource = "mapper/DemandMapper.xml";
        try (java.io.InputStream stream = getClass().getClassLoader().getResourceAsStream(resource)) {
            assertNotNull(stream);
            new org.apache.ibatis.builder.xml.XMLMapperBuilder(stream, configuration, resource,
                    configuration.getSqlFragments()).parse();
        }
        Map<String, Object> params = new HashMap<String, Object>();
        params.put("workspaceId", "W1");
        params.put("ids", Collections.singletonList("D1"));

        String log = sql(configuration, "selectLogTimeline", params);
        assertTrue(log.contains("AS replanAt"), log);
        assertTrue(log.contains("AS cancelAt"), log);
        assertTrue(log.contains("IN ('unpass', 'reopen')"), log);

        String start = sql(configuration, "selectTaskStartTimeline", params);
        assertFalse(start.contains("start_date"), start);
        assertTrue(start.contains("task_log"), start);
        assertTrue(start.contains("time_log"), start);
        assertTrue(start.contains("<> 'backlog'"), start);
        /* 列内调整顺序也记 move（来源列＝目标列），不能算开工，也不能挡住「建在执行列」的创建日 */
        assertTrue(start.contains("l.from_column <> l.to_column"), start);
        assertTrue(start.contains("l2.from_column <> l2.to_column"), start);

        String test = sql(configuration, "selectTestTimeline", params);
        assertTrue(test.contains("AS caseUntested"), test);
        assertTrue(test.contains("AS caseFailed"), test);
        assertFalse(test.contains("AS testPending"), test);

        String release = sql(configuration, "selectDemandReleaseTimeline", params);
        assertTrue(release.contains("FROM version_release_item i"), release);
        assertTrue(release.contains("INNER JOIN version_release vr"), release);
        assertTrue(release.contains("vr.workspace_id = i.workspace_id AND vr.id = i.release_id"), release);
        assertTrue(release.contains("i.workspace_id = ?"), release);
        /* excluded / 失败 / 非产品环境一律不能充当实际产品发布证据。 */
        assertTrue(release.contains("vr.result = 'success'"), release);
        assertTrue(release.contains("vr.environment = 'production'"), release);
        assertTrue(release.contains("i.disposition = 'published'"), release);
        assertTrue(release.contains("i.demand_id IN ( ? )"), release);
        assertTrue(release.contains("GROUP BY i.demand_id"), release);
        assertTrue(release.contains("MAX(COALESCE(vr.published_on, DATE(vr.occurred_at))) AS releasedAt"), release);
        /* manual 标记及当前任务 / 需求 / 版本关联都不能代替不可变发布条目。 */
        assertFalse(release.contains("FROM task "), release);
        assertFalse(release.contains("JOIN task "), release);
        assertFalse(release.contains("JOIN demand "), release);
        assertFalse(release.contains("version_task"), release);
        assertFalse(release.contains("project_version"), release);
        assertFalse(release.contains("published_at"), release);
        assertFalse(release.contains("version_id"), release);
    }

    private String sql(org.apache.ibatis.session.Configuration configuration, String id,
                       Map<String, Object> params) {
        // 只校验本次查询，其他查询的跨 mapper 引用不属于这组 SQL 断言。
        return configuration.getMappedStatement("com.hourglass.mapper.DemandMapper." + id, false)
                .getBoundSql(params).getSql().replaceAll("\\s+", " ");
    }

    private DemandTimeline gantt(Demand d) {
        DemandGanttPage page = service.gantt("W1", "U1", query());
        assertEquals(1, page.getItems().size());
        assertNotNull(page.getItems().get(0).getTimeline());
        return page.getItems().get(0).getTimeline();
    }

    private DemandStage stage(DemandTimeline timeline, String name) {
        List<DemandStage> stages = timeline.getStages();
        for (DemandStage s : stages) {
            if (name.equals(s.getStage())) {
                return s;
            }
        }
        return null;
    }

    private void stubPage(Demand d) {
        when(demands.countGroupByStatus(any(DemandQuery.class)))
                .thenReturn(Collections.singletonList(countRow(d.getStatus())));
        when(demands.selectPage(any(DemandQuery.class))).thenReturn(Collections.singletonList(d));
    }

    private DemandQuery query() {
        DemandQuery query = new DemandQuery();
        query.setLimit(100);
        return query;
    }

    private Demand demand(String status) {
        Demand d = new Demand();
        d.setId("D1");
        d.setWorkspaceId("W1");
        d.setReqId("R1");
        d.setTitle("需求一");
        d.setStatus(status);
        d.setCreatedAt(LocalDateTime.of(2026, 1, 5, 9, 0));
        return d;
    }

    private Map<String, Object> countRow(String status) {
        Map<String, Object> row = new HashMap<String, Object>();
        row.put("status", status);
        row.put("cnt", 1L);
        return row;
    }

    private Map<String, Object> row(Object... kv) {
        Map<String, Object> row = new HashMap<String, Object>();
        for (int i = 0; i + 1 < kv.length; i += 2) {
            row.put(String.valueOf(kv[i]), kv[i + 1]);
        }
        return row;
    }

    private LocalDate date(String iso) {
        return LocalDate.parse(iso);
    }
}
