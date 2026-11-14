package com.hourglass.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.hourglass.common.AppException;
import com.hourglass.common.Consts;
import com.hourglass.common.DefectMeta;
import com.hourglass.dto.DeliveryNoteResponse;
import com.hourglass.dto.DeliveryNoteSaveRequest;
import com.hourglass.dto.DeliveryShareResponse;
import com.hourglass.dto.PublicDeliveryNote;
import com.hourglass.dto.TestPlanView;
import com.hourglass.entity.AppUser;
import com.hourglass.entity.DeliveryNote;
import com.hourglass.entity.DeliveryNoteShare;
import com.hourglass.entity.DeliveryNoteSnapshot;
import com.hourglass.entity.Demand;
import com.hourglass.entity.ProjectVersion;
import com.hourglass.entity.Requirement;
import com.hourglass.entity.Task;
import com.hourglass.entity.VersionCommitmentTask;
import com.hourglass.entity.VersionRelease;
import com.hourglass.entity.VersionReleaseItem;
import com.hourglass.entity.VersionReleasePlan;
import com.hourglass.entity.Workspace;
import com.hourglass.mapper.CategoryMapper;
import com.hourglass.mapper.DeliveryNoteMapper;
import com.hourglass.mapper.DemandMapper;
import com.hourglass.mapper.ProjectVersionMapper;
import com.hourglass.mapper.ReleaseMapper;
import com.hourglass.mapper.RequirementMapper;
import com.hourglass.mapper.TaskMapper;
import com.hourglass.mapper.TestPlanMapper;
import com.hourglass.mapper.TimeLogMapper;
import com.hourglass.mapper.UserMapper;
import com.hourglass.mapper.VersionCommitmentMapper;
import com.hourglass.mapper.VersionTaskMapper;
import com.hourglass.mapper.WorkspaceMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * 交付说明的口径与闸门：只认成功生产发布、缺记录标缺失不推断、快照冻结后不再随系统变化、
 * 客户版与内部版的物理剥离。这些是对外文档的底线，前端渲染再怎么改都不能绕过。
 */
class DeliveryNoteServiceTest {

    private static final String WS = "W1";
    private static final String USER = "U1";
    private static final String REQ = "R1";
    private static final String VER = "V1";

    private final ProjectVersionMapper versions = mock(ProjectVersionMapper.class);
    private final RequirementMapper reqs = mock(RequirementMapper.class);
    private final TaskMapper tasks = mock(TaskMapper.class);
    private final VersionTaskMapper versionTasks = mock(VersionTaskMapper.class);
    private final DemandMapper demands = mock(DemandMapper.class);
    private final ReleaseMapper releases = mock(ReleaseMapper.class);
    private final VersionCommitmentMapper commitments = mock(VersionCommitmentMapper.class);
    private final TestPlanMapper testPlans = mock(TestPlanMapper.class);
    private final TimeLogMapper timeLogs = mock(TimeLogMapper.class);
    private final CategoryMapper categories = mock(CategoryMapper.class);
    private final UserMapper users = mock(UserMapper.class);
    private final WorkspaceMapper workspaces = mock(WorkspaceMapper.class);
    private final DeliveryNoteMapper notes = mock(DeliveryNoteMapper.class);
    private final ProjectAccessService access = mock(ProjectAccessService.class);
    private final ObjectMapper json = new ObjectMapper().findAndRegisterModules();
    private final DeliveryNoteService service = new DeliveryNoteService(versions, reqs, tasks, versionTasks,
            demands, releases, commitments, testPlans, timeLogs, categories, users, workspaces, notes, access, json);

    private ProjectVersion version;

    @BeforeEach
    void setup() {
        version = new ProjectVersion();
        version.setId(VER);
        version.setWorkspaceId(WS);
        version.setReqId(REQ);
        version.setName("商家结算 v1.2");
        version.setStatus("dev");
        version.setTargetDate(LocalDate.of(2026, 11, 11));
        version.setCreatedAt(LocalDateTime.of(2026, 10, 20, 9, 0));
        when(versions.selectById(VER)).thenReturn(version);

        Requirement project = new Requirement();
        project.setId(REQ);
        project.setWorkspaceId(WS);
        project.setName("商家结算中心");
        project.setOwnerUserId(USER);
        when(reqs.selectById(REQ)).thenReturn(project);

        AppUser user = new AppUser();
        user.setId(USER);
        user.setDisplayName("孙琪");
        when(users.selectById(USER)).thenReturn(user);

        Workspace ws = new Workspace();
        ws.setId(WS);
        ws.setName("结算研发空间");
        when(workspaces.selectById(WS)).thenReturn(ws);

        when(access.canWrite(WS, USER, REQ)).thenReturn(true);
        when(notes.insertSnapshot(any(DeliveryNoteSnapshot.class))).thenReturn(1);
    }

    /* ==================== 夹具 ==================== */

    private VersionRelease release(String id, String env, String result, String operation, LocalDateTime at) {
        VersionRelease r = new VersionRelease();
        r.setId(id);
        r.setWorkspaceId(WS);
        r.setVersionId(VER);
        r.setReqId(REQ);
        r.setEnvironment(env);
        r.setResult(result);
        r.setOperation(operation);
        r.setOccurredAt(at);
        r.setRecordedAt(at);
        r.setPublishedOn(at == null ? null : at.toLocalDate());
        r.setPublishedCount(2);
        r.setExcludedCount(0);
        r.setExecutorName("赵磊");
        return r;
    }

    private VersionRelease production() {
        return release("REL1", "production", "success", "publish", LocalDateTime.of(2026, 11, 13, 17, 0));
    }

    private void records(VersionRelease... rows) {
        when(releases.selectRecords(WS, VER)).thenReturn(new ArrayList<VersionRelease>(Arrays.asList(rows)));
    }

    private Task task(String id, String title, String column) {
        Task t = new Task();
        t.setId(id);
        t.setWorkspaceId(WS);
        t.setReqId(REQ);
        t.setTitle(title);
        t.setBoardColumn(column);
        t.setItemType("task");
        t.setOwner("李娜");
        t.setVersionIds(new ArrayList<String>(Collections.singletonList(VER)));
        return t;
    }

    private void projectTasks(Task... rows) {
        when(tasks.selectByReq(WS, REQ)).thenReturn(new ArrayList<Task>(Arrays.asList(rows)));
    }

    private VersionReleaseItem item(String taskId, String disposition) {
        VersionReleaseItem i = new VersionReleaseItem();
        i.setReleaseId("REL1");
        i.setTaskId(taskId);
        i.setDisposition(disposition);
        i.setTitle("工作项 " + taskId);
        return i;
    }

    private void publishedItems(VersionReleaseItem... rows) {
        when(releases.selectItems(WS, "REL1")).thenReturn(new ArrayList<VersionReleaseItem>(Arrays.asList(rows)));
    }

    private DeliveryNote note(String tone, Long revision) {
        DeliveryNote n = new DeliveryNote();
        n.setWorkspaceId(WS);
        n.setVersionId(VER);
        n.setReqId(REQ);
        n.setRevision(revision);
        Map<String, Object> options = DeliveryNoteService.defaultOptions();
        options.put("tone", tone);
        n.setOptions(write(options));
        n.setNarratives("{}");
        n.setConfirmed("[]");
        when(notes.selectByVersion(WS, VER)).thenReturn(n);
        when(notes.selectByVersionForUpdate(WS, VER)).thenReturn(n);
        return n;
    }

    private String write(Object value) {
        try {
            return json.writeValueAsString(value);
        } catch (Exception ex) {
            throw new IllegalStateException(ex);
        }
    }

    private Map<String, Object> log(String action, String createdAt, Map<String, Object> after) {
        Map<String, Object> row = new LinkedHashMap<String, Object>();
        row.put("action", action);
        row.put("createdAt", createdAt);
        row.put("actorName", "孙琪");
        Map<String, Object> change = new LinkedHashMap<String, Object>();
        change.put("after", after);
        row.put("changeData", write(change));
        return row;
    }

    private DeliveryNoteSnapshot captureSnapshot() {
        ArgumentCaptor<DeliveryNoteSnapshot> cap = ArgumentCaptor.forClass(DeliveryNoteSnapshot.class);
        verify(notes).insertSnapshot(cap.capture());
        DeliveryNoteSnapshot saved = cap.getValue();
        when(notes.selectSnapshotById(saved.getId())).thenReturn(saved);
        return saved;
    }

    private DeliveryNoteShare share(String snapshotId, LocalDateTime expiresAt) {
        DeliveryNoteShare s = new DeliveryNoteShare();
        s.setWorkspaceId(WS);
        s.setSnapshotId(snapshotId);
        s.setToken("tok-" + snapshotId);
        s.setAllowDownload(true);
        s.setViewCount(0);
        s.setExpiresAt(expiresAt);
        when(notes.selectShareBySnapshot(WS, snapshotId)).thenReturn(s);
        when(notes.selectShareByToken(s.getToken())).thenReturn(s);
        return s;
    }

    /* ==================== 交付依据 ==================== */

    @Test
    void picksLatestSuccessfulProductionReleaseAsEvidence() {
        records(release("REL0", "production", "success", "publish", LocalDateTime.of(2026, 11, 10, 10, 0)),
                release("REL2", "staging", "success", "publish", LocalDateTime.of(2026, 11, 14, 10, 0)),
                production());
        projectTasks(task("T1", "结算周期自定义", Consts.COL_DONE));
        publishedItems(item("T1", "published"));

        DeliveryNoteResponse r = service.aggregate(WS, USER, VER, null);

        assertEquals("release_snapshot", r.getEvidenceKind());
        assertEquals("REL1", r.getReleaseRecordId());
        assertEquals(Boolean.TRUE, r.getCanShare());
        assertEquals(1, r.getCounts().getReleased());
        assertFalse(r.getMissing().contains("未确认成功的生产发布：本文档为内部草稿，客户版不可导出与分享"));
    }

    @Test
    void scopeAndReleaseShowHumanReadableNumbersInsteadOfRawIds() {
        VersionRelease record = production();
        record.setReleaseNo(12);
        records(record);
        Task t = task("T1", "结算周期自定义", Consts.COL_DONE);
        t.setItemNo(3);
        projectTasks(t);
        publishedItems(item("T1", "published"));

        DeliveryNoteResponse r = service.aggregate(WS, USER, VER, null);

        DeliveryNoteResponse.ScopeRow row = r.getScope().get(0);
        assertEquals(Integer.valueOf(3), row.getItemNo());
        assertEquals("WI-003", row.getRef());
        assertEquals("T1", row.getId(), "编号只改展示，导航仍用原 ID");
        assertEquals(Integer.valueOf(12), r.getRelease().getReleaseNo());
        assertEquals("REL-012", r.getReleaseOptions().get(0).getLabel().split(" · ")[0]);
    }

    @Test
    void unnumberedRowsFallBackToTheRawId() {
        records(production());
        projectTasks(task("T1", "结算周期自定义", Consts.COL_DONE));
        publishedItems(item("T1", "published"));

        DeliveryNoteResponse r = service.aggregate(WS, USER, VER, null);

        assertNull(r.getScope().get(0).getItemNo());
        assertEquals("T1", r.getScope().get(0).getRef());
        assertEquals("REL1", r.getReleaseOptions().get(0).getLabel().split(" · ")[0]);
    }

    @Test
    void stagingFailedAndRollbackAreNotDeliveryEvidence() {
        records(release("REL2", "staging", "success", "publish", LocalDateTime.of(2026, 11, 14, 10, 0)),
                release("REL3", "production", "failed", "publish", LocalDateTime.of(2026, 11, 13, 10, 0)),
                release("REL4", "production", "success", "rollback", LocalDateTime.of(2026, 11, 12, 10, 0)));
        projectTasks(task("T1", "结算周期自定义", Consts.COL_DONE));

        DeliveryNoteResponse r = service.aggregate(WS, USER, VER, null);

        assertEquals("planned_scope", r.getEvidenceKind());
        assertNull(r.getReleaseRecordId());
        assertEquals(Boolean.FALSE, r.getCanShare());
        assertEquals(0, r.getCounts().getReleased());
        assertTrue(r.getMissing().get(0).contains("未确认成功的生产发布"));
        assertEquals("unverified", r.getAcceptance().getConclusionKind());
    }

    @Test
    void completedColumnIsNotCountedAsDelivered() {
        records();
        projectTasks(task("T1", "已完成但没发布", Consts.COL_DONE), task("T2", "开发中", Consts.COL_DOING));

        DeliveryNoteResponse r = service.aggregate(WS, USER, VER, null);

        assertEquals(0, r.getCounts().getReleased());
        assertEquals(1, r.getCounts().getDone());
        assertEquals(2, r.getCounts().getPlanned());
    }

    @Test
    void explicitReleaseIdOverridesAutomaticPick() {
        VersionRelease staging = release("REL2", "staging", "success", "publish", LocalDateTime.of(2026, 11, 14, 10, 0));
        records(production(), staging);
        projectTasks(task("T1", "结算周期自定义", Consts.COL_DONE));

        DeliveryNoteResponse r = service.aggregate(WS, USER, VER, "REL2");

        assertEquals("REL2", r.getReleaseRecordId());
        assertEquals("planned_scope", r.getEvidenceKind());
        assertEquals(Boolean.FALSE, r.getCanShare());
    }

    @Test
    void unknownReleaseIdIsNotFound() {
        records(production());
        AppException ex = assertThrows(AppException.class, () -> service.aggregate(WS, USER, VER, "NOPE"));
        assertEquals(404, ex.getCode());
    }

    @Test
    void versionFromAnotherWorkspaceIsNotFound() {
        AppException ex = assertThrows(AppException.class, () -> service.aggregate("W2", USER, VER, null));
        assertEquals(404, ex.getCode());
        verify(access, never()).assertView(anyString(), anyString(), anyString());
    }

    /* ==================== 数字口径 ==================== */

    @Test
    void passRateExcludesSkippedFromDenominator() {
        records(production());
        projectTasks(task("T1", "结算周期自定义", Consts.COL_DONE));
        TestPlanView plan = new TestPlanView();
        plan.setId("TP1");
        plan.setVersionId(VER);
        plan.setName("v1.2 回归");
        plan.setCaseCount(12);
        plan.setExecutedCount(10);
        plan.setPassedCount(6);
        plan.setFailedCount(2);
        plan.setBlockedCount(2);
        plan.setSkippedCount(2);
        when(testPlans.selectViewByReq(eq(WS), eq(REQ), anyInt(), anyInt()))
                .thenReturn(new ArrayList<TestPlanView>(Collections.singletonList(plan)));

        DeliveryNoteResponse.Quality q = service.aggregate(WS, USER, VER, null).getQuality();

        assertEquals(75.0, q.getPassRatePct(), 0.001);
        assertEquals(83.3, q.getCoveragePct(), 0.001);
        assertEquals(2, q.getUnexecutedCount());
        assertEquals(Boolean.FALSE, q.getMissing());
    }

    @Test
    void allSkippedGivesNoPassRateAndNoVerifiedConclusion() {
        records(production());
        projectTasks(task("T1", "结算周期自定义", Consts.COL_DONE));
        publishedItems(item("T1", "published"));
        TestPlanView plan = new TestPlanView();
        plan.setId("TP1");
        plan.setVersionId(VER);
        plan.setName("v1.2 回归");
        plan.setCaseCount(4);
        plan.setExecutedCount(4);
        plan.setSkippedCount(4);
        when(testPlans.selectViewByReq(eq(WS), eq(REQ), anyInt(), anyInt()))
                .thenReturn(new ArrayList<TestPlanView>(Collections.singletonList(plan)));

        DeliveryNoteResponse r = service.aggregate(WS, USER, VER, null);

        assertNull(r.getQuality().getPassRatePct());
        assertEquals(Boolean.FALSE, r.getQuality().getMissing());
        assertEquals("partial", r.getAcceptance().getConclusionKind());
        assertTrue(r.getMissing().stream().anyMatch(m -> m.contains("回归用例全部跳过")));
        DeliveryNoteResponse.RiskRow risk = r.getRisks().stream()
                .filter(x -> "回归验证".equals(x.getTitle())).findFirst().orElse(null);
        assertNotNull(risk);
        assertEquals("用例全部跳过，没有有效执行结果", risk.getImpact());
        assertTrue(r.getAcceptance().getBasis().stream().anyMatch(b -> b.contains("有效执行 0 条")));
    }

    @Test
    void noTestPlanIsMarkedMissingNotInferred() {
        records(production());
        projectTasks(task("T1", "结算周期自定义", Consts.COL_DONE));

        DeliveryNoteResponse r = service.aggregate(WS, USER, VER, null);

        assertEquals(Boolean.TRUE, r.getQuality().getMissing());
        assertNull(r.getQuality().getPassRatePct());
        assertNull(r.getQuality().getCoveragePct());
        assertTrue(r.getMissing().stream().anyMatch(m -> m.contains("未创建测试计划")));
        assertTrue(r.getMissing().stream().anyMatch(m -> m.contains("没有与本版本关联的缺陷记录")));
        assertTrue(r.getMissing().stream().anyMatch(m -> m.contains("没有计时与补记")));
    }

    @Test
    void demandFulfilmentNeedsEveryBoundTaskPublished() {
        records(production());
        Task t1 = task("T1", "结算周期自定义", Consts.COL_DONE);
        t1.setDemandId("D1");
        Task t2 = task("T2", "结算异常预警", Consts.COL_DONE);
        t2.setDemandId("D1");
        Task t3 = task("T3", "发票开具接口", Consts.COL_DONE);
        t3.setDemandId("D2");
        projectTasks(t1, t2, t3);
        publishedItems(item("T1", "published"), item("T3", "published"));
        Demand d1 = demand("D1", "结算周期可配置", VER);
        Demand d2 = demand("D2", "电子发票对接", VER);
        when(demands.selectByVersion(WS, VER)).thenReturn(new ArrayList<Demand>(Arrays.asList(d1, d2)));

        DeliveryNoteResponse r = service.aggregate(WS, USER, VER, null);

        assertEquals(50, r.getDemandSummary().getRatePct());
        assertEquals(1, r.getDemandSummary().getFulfilled());
        assertEquals(1, r.getDemandSummary().getPartial());
        assertEquals("partial", r.getDemands().get(0).getState());
        assertEquals("fulfilled", r.getDemands().get(1).getState());
        assertEquals("partial", r.getAcceptance().getConclusionKind());
    }

    private Demand demand(String id, String title, String versionId) {
        Demand d = new Demand();
        d.setId(id);
        d.setWorkspaceId(WS);
        d.setReqId(REQ);
        d.setTitle(title);
        d.setVersionId(versionId);
        return d;
    }

    @Test
    void calibersAlwaysShipWithDefinitionsAndSources() {
        records(production());
        projectTasks(task("T1", "结算周期自定义", Consts.COL_DONE));

        List<DeliveryNoteResponse.CaliberRow> calibers = service.aggregate(WS, USER, VER, null).getCalibers();

        assertEquals(10, calibers.size());
        for (DeliveryNoteResponse.CaliberRow row : calibers) {
            assertNotNull(row.getName());
            assertTrue(row.getDefinition().length() > 8);
            assertNotNull(row.getSource());
        }
        assertTrue(calibers.stream().anyMatch(c -> "回归通过率".equals(c.getName())
                && c.getDefinition().contains("已执行 − 跳过")));
    }

    /* ==================== 承诺基线与变更台账 ==================== */

    @Test
    void baselineDiffProducesAddedAndRemovedChangeRows() {
        version.setCommitmentAt(LocalDateTime.of(2026, 10, 26, 10, 0));
        records(production());
        Task kept = task("T1", "结算周期自定义", Consts.COL_DONE);
        Task added = task("T2", "结算监控告警", Consts.COL_DONE);
        added.setEstimateMinutes(120);
        projectTasks(kept, added);
        when(commitments.selectByReq(WS, REQ)).thenReturn(new ArrayList<VersionCommitmentTask>(
                Arrays.asList(commitment("T1", "结算周期自定义", 60), commitment("T9", "已移出的对账导出", 240))));

        DeliveryNoteResponse r = service.aggregate(WS, USER, VER, null);

        assertEquals(2, r.getBaseline().getTaskCount());
        assertEquals(1, r.getBaseline().getAddedCount());
        assertEquals(1, r.getBaseline().getRemovedCount());
        assertEquals(120, r.getBaseline().getAddedEstimateMinutes());
        assertEquals(240, r.getBaseline().getRemovedEstimateMinutes());
        assertTrue(r.getChanges().stream().anyMatch(c -> "add".equals(c.getKind()) && c.getTitle().contains("结算监控告警")));
        assertTrue(r.getChanges().stream().anyMatch(c -> "move".equals(c.getKind()) && c.getTitle().contains("已移出的对账导出")));
    }

    private VersionCommitmentTask commitment(String taskId, String title, int estimate) {
        VersionCommitmentTask c = new VersionCommitmentTask();
        c.setWorkspaceId(WS);
        c.setVersionId(VER);
        c.setTaskId(taskId);
        c.setTaskTitle(title);
        c.setEstimateMinutes(estimate);
        return c;
    }

    @Test
    void baselineCapturedAfterReleaseIsFlaggedLateWithoutGuessing() {
        version.setCommitmentAt(LocalDateTime.of(2026, 11, 14, 10, 0));
        records(production());
        projectTasks(task("T1", "结算周期自定义", Consts.COL_DONE));
        when(commitments.selectByReq(WS, REQ)).thenReturn(new ArrayList<VersionCommitmentTask>(
                Collections.singletonList(commitment("T1", "结算周期自定义", 60))));

        DeliveryNoteResponse r = service.aggregate(WS, USER, VER, null);

        assertEquals(Boolean.TRUE, r.getBaseline().getLate());
        assertTrue(r.getMissing().stream().anyMatch(m -> m.contains("承诺基线建立晚于发布日")));
    }

    @Test
    void changeLedgerSkipsCreationAndSuccessButKeepsFailedAttempts() {
        records(production(),
                release("REL3", "production", "failed", "publish", LocalDateTime.of(2026, 11, 12, 10, 0)),
                release("REL4", "production", "success", "rollback", LocalDateTime.of(2026, 11, 11, 10, 0)));
        projectTasks(task("T1", "结算周期自定义", Consts.COL_DONE));
        Map<String, Object> dateAfter = new LinkedHashMap<String, Object>();
        dateAfter.put("targetDate", "2026-11-13");
        Map<String, Object> planAfter = new LinkedHashMap<String, Object>();
        planAfter.put("plannedAt", "2026-11-13T17:00:00");
        planAfter.put("environment", "production");
        planAfter.put("plannedTaskIds", Arrays.asList("T1", "T2"));
        when(releases.selectLogs(WS, VER)).thenReturn(new ArrayList<Map<String, Object>>(Arrays.asList(
                log("version_create", "2026-10-20 09:00:00", new LinkedHashMap<String, Object>()),
                log("release_success", "2026-11-13 17:00:00", new LinkedHashMap<String, Object>()),
                log("version_update", "2026-11-05 10:00:00", dateAfter),
                log("release_plan", "2026-11-08 10:00:00", planAfter))));

        List<DeliveryNoteResponse.ChangeRow> changes = service.aggregate(WS, USER, VER, null).getChanges();

        assertEquals(4, changes.size());
        assertEquals(LocalDate.of(2026, 11, 5), changes.get(0).getDate());
        assertEquals("date", changes.get(0).getKind());
        assertTrue(changes.get(0).getTitle().contains("2026-11-13"));
        assertEquals("plan", changes.get(1).getKind());
        assertTrue(changes.get(1).getTitle().contains("2026-11-13 17:00"));
        assertFalse(changes.get(1).getTitle().contains("T17:00"));
        assertTrue(changes.get(1).getTags().contains("计划范围 2 项"));
        assertEquals("执行回滚", changes.get(2).getTitle());
        assertEquals("发布尝试未成功", changes.get(3).getTitle());
        for (DeliveryNoteResponse.ChangeRow row : changes) {
            assertNotNull(row.getSource());
        }
    }

    /* ==================== 风险与验收 ==================== */

    @Test
    void blockingDefectsComeFirstInRiskOrder() {
        records(production());
        Task blocker = task("B1", "对账金额错位", Consts.COL_TEST);
        blocker.setItemType("bug");
        blocker.setSeverity(DefectMeta.SEVERITY_BLOCKER);
        blocker.setFoundVersionId(VER);
        Task minor = task("B2", "导出列宽不记忆", Consts.COL_TEST);
        minor.setItemType("bug");
        minor.setSeverity(DefectMeta.SEVERITY_MINOR);
        minor.setFoundVersionId(VER);
        projectTasks(task("T1", "结算周期自定义", Consts.COL_DONE), blocker, minor);
        publishedItems(item("T1", "published"));

        DeliveryNoteResponse r = service.aggregate(WS, USER, VER, null);

        assertEquals(2, r.getDefects().getOpenCount());
        assertEquals(1, r.getDefects().getBlockerOpenCount());
        assertEquals("B1", r.getRisks().get(0).getRefId());
        assertEquals("bad", r.getRisks().get(0).getTone());
        assertEquals("回归验证", r.getRisks().get(1).getTitle());
        assertEquals("B2", r.getRisks().get(2).getRefId());
        assertEquals("partial", r.getAcceptance().getConclusionKind());
    }

    @Test
    void moreThanSixDeferredItemsCollapseIntoOneRiskRow() {
        version.setCommitmentAt(LocalDateTime.of(2026, 10, 26, 10, 0));
        records(production());
        List<Task> list = new ArrayList<Task>();
        List<VersionCommitmentTask> committed = new ArrayList<VersionCommitmentTask>();
        for (int i = 0; i < 8; i++) {
            Task t = task("T" + i, "延后项 " + i, Consts.COL_DOING);
            /* 已改到 v1.3：不再绑定本版本，但承诺基线里还留着 */
            t.setVersionIds(new ArrayList<String>(Collections.singletonList("V2")));
            t.setVersionNames(new ArrayList<String>(Collections.singletonList("v1.3")));
            list.add(t);
            committed.add(commitment("T" + i, "延后项 " + i, 60));
        }
        projectTasks(list.toArray(new Task[0]));
        when(commitments.selectByReq(WS, REQ)).thenReturn(committed);

        DeliveryNoteResponse r = service.aggregate(WS, USER, VER, null);

        assertEquals(8, r.getCounts().getDeferred());
        assertEquals(0, r.getCounts().getCurrentBound());
        DeliveryNoteResponse.RiskRow collapsed = r.getRisks().stream()
                .filter(x -> x.getTitle().contains("8 项承诺")).findFirst().orElse(null);
        assertNotNull(collapsed);
        assertEquals("逐项清单见「交付范围」", collapsed.getImpact());
        assertNull(collapsed.getRefId());
        assertEquals(8, r.getScope().size());
        assertTrue(r.getScope().stream().allMatch(x -> "deferred".equals(x.getState())));
    }

    @Test
    void acceptanceConditionsFlattenMultilineAcceptText() {
        records(production());
        Task t = task("T1", "结算周期自定义", Consts.COL_DONE);
        t.setDemandId("D1");
        projectTasks(t);
        publishedItems(item("T1", "published"));
        Demand d = demand("D1", "结算周期可配置", VER);
        d.setAcceptText("按商户维度配置结算周期；\n\n  T+1 与 T+7 均可选，\n改动即时生效。");
        when(demands.selectByVersion(WS, VER)).thenReturn(new ArrayList<Demand>(Collections.singletonList(d)));
        TestPlanView plan = new TestPlanView();
        plan.setId("TP1");
        plan.setVersionId(VER);
        plan.setName("v1.2 回归");
        plan.setCaseCount(4);
        plan.setExecutedCount(4);
        plan.setPassedCount(4);
        when(testPlans.selectViewByReq(eq(WS), eq(REQ), anyInt(), anyInt()))
                .thenReturn(new ArrayList<TestPlanView>(Collections.singletonList(plan)));

        DeliveryNoteResponse.Acceptance a = service.aggregate(WS, USER, VER, null).getAcceptance();

        assertEquals(1, a.getConditions().size());
        assertFalse(a.getConditions().get(0).contains("\n"));
        assertTrue(a.getConditions().get(0).contains("T+1 与 T+7 均可选， 改动即时生效。"));
        assertEquals("verified", a.getConclusionKind());
        assertEquals(Boolean.TRUE, a.getSignOffPending());
    }

    /* ==================== 人工层与并发 ==================== */

    @Test
    void saveRejectsStaleRevision() {
        note("customer", 7L);
        DeliveryNoteSaveRequest req = new DeliveryNoteSaveRequest();
        req.setRevision(6L);

        AppException ex = assertThrows(AppException.class, () -> service.save(WS, USER, VER, req));

        assertEquals(409, ex.getCode());
        verify(notes, never()).upsert(any(DeliveryNote.class));
    }

    @Test
    void saveDropsUnknownOptionsNarrativesAndConfirmKeys() {
        note("customer", 3L);
        DeliveryNoteSaveRequest req = new DeliveryNoteSaveRequest();
        req.setRevision(3L);
        Map<String, Object> options = new LinkedHashMap<String, Object>();
        options.put("tone", "manager");
        options.put("evil", "x");
        req.setOptions(options);
        Map<String, String> narratives = new LinkedHashMap<String, String>();
        narratives.put("summary", "本次交付已上线");
        narratives.put("evil", "x");
        req.setNarratives(narratives);
        req.setConfirmed(Arrays.asList("summary", "evil", "summary", "issue"));

        service.save(WS, USER, VER, req);

        ArgumentCaptor<DeliveryNote> cap = ArgumentCaptor.forClass(DeliveryNote.class);
        verify(notes).upsert(cap.capture());
        DeliveryNote saved = cap.getValue();
        assertFalse(saved.getOptions().contains("evil"));
        assertTrue(saved.getOptions().contains("manager"));
        assertFalse(saved.getNarratives().contains("evil"));
        assertEquals("[\"summary\",\"issue\"]", saved.getConfirmed());
    }

    /* ==================== 快照冻结 ==================== */

    @Test
    void snapshotFreezesPayloadAgainstLaterSystemChanges() {
        records(production());
        Task t = task("T1", "结算周期自定义", Consts.COL_DONE);
        projectTasks(t);
        publishedItems(item("T1", "published"));
        note("manager", 0L);

        DeliveryNoteResponse frozen = service.createSnapshot(WS, USER, VER, null);
        DeliveryNoteSnapshot saved = captureSnapshot();

        assertEquals(Boolean.TRUE, frozen.getLocked());
        assertEquals(Boolean.FALSE, frozen.getCanEdit());
        assertEquals("DS-" + LocalDate.now().format(java.time.format.DateTimeFormatter.ofPattern("yyyyMMdd")) + "-01",
                frozen.getDocNo());
        assertEquals(saved.getContentHash(), frozen.getContentHash());

        /* 冻结之后系统记录再变化：改标题、改发布结果、加缺陷，快照都不跟着动 */
        t.setTitle("标题被改掉了");
        records(release("REL9", "production", "failed", "publish", LocalDateTime.of(2026, 11, 15, 10, 0)));
        DeliveryNoteResponse replay = service.snapshotDetail(WS, USER, saved.getId());

        assertEquals(frozen.getContentHash(), replay.getContentHash());
        assertEquals(frozen.getDocNo(), replay.getDocNo());
        assertEquals("REL1", replay.getReleaseRecordId());
        assertEquals("结算周期自定义", replay.getScope().get(0).getTitle());
        assertEquals(Boolean.TRUE, replay.getLocked());
        assertEquals(Boolean.FALSE, replay.getCanSnapshot());
    }

    @Test
    void snapshotSequenceIncrementsPerVersion() {
        records(production());
        projectTasks(task("T1", "结算周期自定义", Consts.COL_DONE));
        publishedItems(item("T1", "published"));
        note("manager", 0L);
        when(notes.selectMaxSeq(WS, VER)).thenReturn(4);

        DeliveryNoteResponse frozen = service.createSnapshot(WS, USER, VER, null);

        assertEquals(5, frozen.getSnapshotSeq());
        assertTrue(frozen.getDocNo().endsWith("-05"));
    }

    @Test
    void customerSnapshotPhysicallyDropsInternalFields() {
        VersionRelease rel = production();
        rel.setArtifactRef("registry/settle:1.2");
        rel.setArtifactDigest("sha256:abc123");
        rel.setTargetKeys(new ArrayList<String>(Collections.singletonList("prod-shanghai-a")));
        records(rel);
        VersionReleasePlan plan = new VersionReleasePlan();
        plan.setId("PLAN1");
        plan.setStatus("done");
        plan.setEnvironment("production");
        plan.setTargetKeys(new ArrayList<String>(Arrays.asList("prod-shanghai-a", "prod-shanghai-b")));
        when(releases.selectPlans(WS, VER)).thenReturn(new ArrayList<VersionReleasePlan>(Collections.singletonList(plan)));
        Task t = task("T1", "结算周期自定义", Consts.COL_DONE);
        Task bug = task("B1", "对账金额错位", Consts.COL_TEST);
        bug.setItemType("bug");
        bug.setSeverity(DefectMeta.SEVERITY_MAJOR);
        bug.setFoundVersionId(VER);
        bug.setOwner("李娜");
        projectTasks(t, bug);
        VersionReleaseItem it = item("T1", "published");
        it.setWorkMinutes(480);
        publishedItems(it);
        DeliveryNote n = note("customer", 0L);
        Map<String, String> narratives = new LinkedHashMap<String, String>();
        narratives.put("internal", "赶工发布，先补记录");
        narratives.put("summary", "本次交付已上线");
        n.setNarratives(write(narratives));

        DeliveryNoteResponse frozen = service.createSnapshot(WS, USER, VER, null);

        assertNull(frozen.getNarratives().get("internal"));
        assertEquals("本次交付已上线", frozen.getNarratives().get("summary"));
        assertTrue(frozen.getEffort().getByMember().isEmpty());
        assertNull(frozen.getRelease().getArtifactDigest());
        assertNull(frozen.getRelease().getArtifactRef());
        assertTrue(frozen.getRelease().getTargets().isEmpty());
        /* 计划里的部署目标与发布记录同源，不能只剥一处 */
        assertNotNull(frozen.getPlan());
        assertTrue(frozen.getPlan().getTargets().isEmpty());
        assertNull(frozen.getPlan().getOwnerName());
        assertNull(frozen.getDefects().getOpen().get(0).getOwner());
        assertTrue(frozen.getRisks().stream().allMatch(x -> x.getOwner() == null));
        assertTrue(frozen.getEvidence().stream().noneMatch(e -> Boolean.TRUE.equals(e.getInternal())));
        /* 剥离发生在落库前：快照 JSON 里也不许残留 */
        DeliveryNoteSnapshot saved = captureSnapshot();
        assertFalse(saved.getPayload().contains("赶工发布"));
        assertFalse(saved.getPayload().contains("sha256:abc123"));
        assertFalse(saved.getPayload().contains("registry/settle:1.2"));
        assertFalse(saved.getPayload().contains("prod-shanghai-a"));
        assertFalse(saved.getPayload().contains("prod-shanghai-b"));
    }

    @Test
    void customerSnapshotWithoutProductionReleaseIsRefused() {
        records(release("REL2", "staging", "success", "publish", LocalDateTime.of(2026, 11, 14, 10, 0)));
        projectTasks(task("T1", "结算周期自定义", Consts.COL_DONE));
        note("customer", 0L);

        AppException ex = assertThrows(AppException.class, () -> service.createSnapshot(WS, USER, VER, null));

        assertEquals(422, ex.getCode());
        assertTrue(ex.getMessage().contains("客户版不可导出"));
        verify(notes, never()).insertSnapshot(any(DeliveryNoteSnapshot.class));
    }

    @Test
    void managerSnapshotIsAllowedWithoutProductionRelease() {
        records();
        projectTasks(task("T1", "结算周期自定义", Consts.COL_DONE));
        note("manager", 0L);

        DeliveryNoteResponse frozen = service.createSnapshot(WS, USER, VER, null);

        assertEquals("planned_scope", frozen.getEvidenceKind());
        assertEquals(Boolean.TRUE, frozen.getLocked());
    }

    @Test
    void snapshotFromAnotherWorkspaceIsNotFound() {
        DeliveryNoteSnapshot saved = new DeliveryNoteSnapshot();
        saved.setId("DN1");
        saved.setWorkspaceId("W2");
        when(notes.selectSnapshotById("DN1")).thenReturn(saved);

        AppException ex = assertThrows(AppException.class, () -> service.snapshotDetail(WS, USER, "DN1"));

        assertEquals(404, ex.getCode());
    }

    /* ==================== 只读分享 ==================== */

    @Test
    void internalSnapshotCannotBeShared() {
        records(production());
        projectTasks(task("T1", "结算周期自定义", Consts.COL_DONE));
        publishedItems(item("T1", "published"));
        note("internal", 0L);
        DeliveryNoteSnapshot saved = captureSnapshotAfterCreate();

        AppException ex = assertThrows(AppException.class, () -> service.createShare(WS, USER, saved.getId(), true, 30));

        assertEquals(422, ex.getCode());
        assertTrue(ex.getMessage().contains("内部版"));
        verify(notes, never()).upsertShare(any(DeliveryNoteShare.class));
    }

    private DeliveryNoteSnapshot captureSnapshotAfterCreate() {
        service.createSnapshot(WS, USER, VER, null);
        return captureSnapshot();
    }

    @Test
    void publicShareReturnsFrozenNoteAndCountsTheView() {
        records(production());
        projectTasks(task("T1", "结算周期自定义", Consts.COL_DONE));
        publishedItems(item("T1", "published"));
        note("customer", 0L);
        DeliveryNoteSnapshot saved = captureSnapshotAfterCreate();
        DeliveryNoteShare share = share(saved.getId(), LocalDateTime.now().plusDays(7));

        PublicDeliveryNote out = service.publicShare(share.getToken());

        assertEquals(saved.getDocNo(), out.getDocNo());
        assertEquals(saved.getContentHash(), out.getContentHash());
        assertEquals("customer", out.getTone());
        assertEquals("结算研发空间", out.getWorkspaceName());
        assertEquals(Boolean.TRUE, out.getAllowDownload());
        assertEquals(Boolean.TRUE, out.getNote().getLocked());
        assertEquals(Boolean.FALSE, out.getNote().getCanShare());
        assertNull(out.getNote().getRevision());
        assertTrue(out.getNote().getRevisions().isEmpty());
        verify(notes).increaseViewCount(WS, saved.getId());
    }

    @Test
    void expiredUnknownAndInternalSharesAllLookTheSame() {
        records(production());
        projectTasks(task("T1", "结算周期自定义", Consts.COL_DONE));
        publishedItems(item("T1", "published"));
        note("customer", 0L);
        DeliveryNoteSnapshot saved = captureSnapshotAfterCreate();
        DeliveryNoteShare expired = share(saved.getId(), LocalDateTime.now().minusMinutes(1));

        assertEquals("分享链接无效或已过期",
                assertThrows(AppException.class, () -> service.publicShare(expired.getToken())).getMessage());
        assertEquals("分享链接无效或已过期",
                assertThrows(AppException.class, () -> service.publicShare("nope")).getMessage());
        assertEquals("分享链接无效或已过期",
                assertThrows(AppException.class, () -> service.publicShare("  ")).getMessage());
        verify(notes, never()).increaseViewCount(anyString(), anyString());

        /* 历史快照若被改成内部版，公开出口仍然拒绝 */
        saved.setTone("internal");
        share(saved.getId(), LocalDateTime.now().plusDays(7));
        assertEquals(404, assertThrows(AppException.class,
                () -> service.publicShare("tok-" + saved.getId())).getCode());
    }

    @Test
    void shareDaysAreClampedAndDownloadDefaultsToAllowed() {
        records(production());
        projectTasks(task("T1", "结算周期自定义", Consts.COL_DONE));
        publishedItems(item("T1", "published"));
        note("manager", 0L);
        DeliveryNoteSnapshot saved = captureSnapshotAfterCreate();
        when(notes.selectShareBySnapshot(eq(WS), eq(saved.getId()))).thenAnswer(inv -> {
            DeliveryNoteShare s = new DeliveryNoteShare();
            s.setWorkspaceId(WS);
            s.setSnapshotId(saved.getId());
            s.setToken("tok");
            s.setAllowDownload(true);
            s.setExpiresAt(LocalDateTime.now().plusDays(365));
            return s;
        });

        DeliveryShareResponse out = service.createShare(WS, USER, saved.getId(), null, 9999);

        ArgumentCaptor<DeliveryNoteShare> cap = ArgumentCaptor.forClass(DeliveryNoteShare.class);
        verify(notes).upsertShare(cap.capture());
        assertEquals(Boolean.TRUE, cap.getValue().getAllowDownload());
        assertTrue(cap.getValue().getExpiresAt().isAfter(LocalDateTime.now().plusDays(364)));
        assertTrue(cap.getValue().getExpiresAt().isBefore(LocalDateTime.now().plusDays(366)));
        assertNotNull(out.getToken());
    }

    @Test
    void revokeDeletesTheShareRow() {
        records(production());
        projectTasks(task("T1", "结算周期自定义", Consts.COL_DONE));
        publishedItems(item("T1", "published"));
        note("manager", 0L);
        DeliveryNoteSnapshot saved = captureSnapshotAfterCreate();

        service.revokeShare(WS, USER, saved.getId());

        verify(notes).deleteShare(WS, saved.getId());
    }
}