package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.common.LoginUser;
import com.hourglass.dto.CaseDefectRequest;
import com.hourglass.dto.CaseRunRequest;
import com.hourglass.dto.CaseStatsView;
import com.hourglass.dto.TestCaseSaveRequest;
import com.hourglass.dto.TestCaseView;
import com.hourglass.entity.Requirement;
import com.hourglass.entity.Task;
import com.hourglass.entity.TestCase;
import com.hourglass.entity.TestCaseRun;
import com.hourglass.mapper.RequirementMapper;
import com.hourglass.mapper.TestCaseMapper;
import com.hourglass.mapper.TestCaseRunMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class TestCaseServiceTest {

    private static final String WS = "W1";
    private static final String USER = "U1";
    private static final String REQ = "R1";

    private final TestCaseMapper cases = mock(TestCaseMapper.class);
    private final TestCaseRunMapper runs = mock(TestCaseRunMapper.class);
    private final TaskCommandService taskCommand = mock(TaskCommandService.class);
    private final ProjectAccessService access = mock(ProjectAccessService.class);
    private final RequirementMapper reqs = mock(RequirementMapper.class);
    private final AttachmentService attachments = mock(AttachmentService.class);
    private final com.hourglass.mapper.TestPlanCaseMapper planCases = mock(com.hourglass.mapper.TestPlanCaseMapper.class);
    private final AuditService auditService = mock(AuditService.class);
    private final com.hourglass.mapper.TestCaseTaskMapper caseTasks = mock(com.hourglass.mapper.TestCaseTaskMapper.class);
    private final com.hourglass.mapper.TaskMapper tasks = mock(com.hourglass.mapper.TaskMapper.class);
    private final com.hourglass.mapper.DemandMapper demands = mock(com.hourglass.mapper.DemandMapper.class);
    private final com.hourglass.mapper.WorkspaceMemberMapper members = mock(com.hourglass.mapper.WorkspaceMemberMapper.class);
    private final com.hourglass.mapper.TestModuleMapper modules = mock(com.hourglass.mapper.TestModuleMapper.class);
    private final TestCaseService service =
            new TestCaseService(cases, runs, taskCommand, access, reqs,
                    demands, modules,
                    mock(com.hourglass.mapper.AttachmentMapper.class), attachments,
                    mock(com.hourglass.mapper.TestPlanMapper.class),
                    planCases, auditService, mock(NumberSeqService.class),
                    caseTasks, tasks, members,
                    new TestModuleService(new CategoryService(
                            mock(com.hourglass.mapper.CategoryMapper.class),
                            mock(com.hourglass.mapper.RequirementMapper.class),
                            mock(ActivityService.class), mock(DeletionTraceService.class),
                            mock(ProjectAccessService.class), mock(ReleasePermissionService.class),
                            mock(WorkspaceMetaCache.class),
                            mock(com.hourglass.mapper.TestCaseMapper.class),
                            mock(com.hourglass.mapper.CaseSetMapper.class)), auditService),
                    mock(com.hourglass.mapper.CaseSetMapper.class), mock(DemandCompletionService.class));

    @BeforeEach
    void setUp() {
        when(reqs.selectById(REQ)).thenReturn(requirement(WS));
        LoginUser user = new LoginUser(USER, "u1", "x", "我", "user");
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(user, null, user.getAuthorities()));
    }

    @AfterEach
    void tearDown() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void movingCaseToAnotherProjectIsBlockedWhileInOpenPlan() {
        TestCase c = new TestCase();
        c.setId("C1");
        c.setWorkspaceId(WS);
        c.setReqId(REQ);
        c.setTitle("登录");
        when(cases.selectById("C1")).thenReturn(c);
        when(reqs.selectById("R2")).thenReturn(requirement(WS));
        when(planCases.selectOpenPlanNamesByCase(WS, "C1")).thenReturn(java.util.Collections.singletonList("v1.2 回归"));
        com.hourglass.dto.TestCaseSaveRequest req = new com.hourglass.dto.TestCaseSaveRequest();
        req.setReqId("R2");
        req.setTitle("登录");
        AppException ex = assertThrows(AppException.class, () -> service.update(USER, WS, "C1", req));
        org.junit.jupiter.api.Assertions.assertTrue(ex.getMessage().contains("v1.2 回归"));
        verify(cases, never()).update(any(TestCase.class));
    }

    private static Requirement requirement(String wsId) {
        Requirement r = new Requirement();
        r.setId(REQ);
        r.setWorkspaceId(wsId);
        return r;
    }

    private static TestCaseSaveRequest saveRequest(String title) {
        TestCaseSaveRequest req = new TestCaseSaveRequest();
        req.setReqId(REQ);
        req.setTitle(title);
        return req;
    }

    private static TestCaseSaveRequest.StepItem step(String action, String expected) {
        TestCaseSaveRequest.StepItem item = new TestCaseSaveRequest.StepItem();
        item.setAction(action);
        item.setExpected(expected);
        return item;
    }

    private static TestCase existing(String id, String latestStatus) {
        TestCase c = new TestCase();
        c.setId(id);
        c.setWorkspaceId(WS);
        c.setReqId(REQ);
        c.setTitle("登录用例");
        c.setLatestStatus(latestStatus);
        return c;
    }

    /* ---------- 项目校验 ---------- */

    @Test
    void createRejectsMissingProject() {
        TestCaseSaveRequest req = saveRequest("标题");
        req.setReqId("  ");
        AppException error = assertThrows(AppException.class, () -> service.create(USER, WS, req));
        assertEquals(400, error.getCode());
        verify(cases, never()).insert(any(TestCase.class));
    }

    @Test
    void createRejectsUnknownOrCrossWorkspaceProject() {
        TestCaseSaveRequest req = saveRequest("标题");
        when(reqs.selectById("R9")).thenReturn(null);
        AppException missing = assertThrows(AppException.class,
                () -> service.create(USER, WS, saveRequestWithReq("R9")));
        assertEquals(400, missing.getCode());

        Requirement foreign = new Requirement();
        foreign.setId("R2");
        foreign.setWorkspaceId("W2");
        when(reqs.selectById("R2")).thenReturn(foreign);
        AppException cross = assertThrows(AppException.class,
                () -> service.create(USER, WS, saveRequestWithReq("R2")));
        assertEquals(400, cross.getCode());
        verify(cases, never()).insert(any(TestCase.class));
    }

    private static TestCaseSaveRequest saveRequestWithReq(String reqId) {
        TestCaseSaveRequest req = saveRequest("标题");
        req.setReqId(reqId);
        return req;
    }

    /* ---------- 用例—工作项关联 ---------- */

    @Test
    void taskLinksMustBelongToCasePrimaryDemand() {
        TestCase c = existing("C1", null);
        c.setDemandId("D1");
        when(cases.selectById("C1")).thenReturn(c);
        com.hourglass.entity.Demand demand = new com.hourglass.entity.Demand();
        demand.setId("D1");
        demand.setWorkspaceId(WS);
        demand.setReqId(REQ);
        when(demands.selectById("D1")).thenReturn(demand);
        Task foreign = new Task();
        foreign.setId("T9");
        foreign.setWorkspaceId(WS);
        foreign.setReqId(REQ);
        foreign.setDemandId("D2");
        foreign.setTitle("另一个需求的工作项");
        when(tasks.selectById("T9")).thenReturn(foreign);
        TestCaseSaveRequest req = saveRequest("登录");
        req.setDemandId("D1");
        req.setTaskIds(Collections.singletonList("T9"));
        AppException ex = assertThrows(AppException.class, () -> service.update(USER, WS, "C1", req));
        assertTrue(ex.getMessage().contains("不属于用例主需求"));
        verify(caseTasks, never()).insert(any(com.hourglass.entity.TestCaseTask.class));
    }

    @Test
    void taskLinksRequirePrimaryDemand() {
        TestCase c = existing("C1", null);
        when(cases.selectById("C1")).thenReturn(c);
        TestCaseSaveRequest req = saveRequest("登录");
        req.setTaskIds(Collections.singletonList("T9"));
        AppException ex = assertThrows(AppException.class, () -> service.update(USER, WS, "C1", req));
        assertTrue(ex.getMessage().contains("请先关联主需求"));
    }

    /* ---------- 创建与步骤清洗 ---------- */

    @Test
    void createSerializesStepsSkippingEmptyRows() {
        TestCaseSaveRequest req = saveRequest("登录用例");
        req.setPrecondition("已有账号");
        req.setSteps(Arrays.asList(
                step("打开登录页", "页面正常显示"),
                step("  ", "  "),
                step("输入账号密码", "  "),
                step("点击登录", "进入首页")));
        when(cases.selectById(anyString())).thenReturn(existing("C1", null));

        service.create(USER, WS, req);

        ArgumentCaptor<TestCase> captor = ArgumentCaptor.forClass(TestCase.class);
        verify(cases).insert(captor.capture());
        TestCase saved = captor.getValue();
        assertEquals("登录用例", saved.getTitle());
        assertEquals("已有账号", saved.getPrecondition());
        assertEquals(REQ, saved.getReqId());
        assertTrue(saved.getId().startsWith("C"));
        String json = saved.getSteps();
        assertTrue(json.contains("\"action\":\"打开登录页\""));
        assertTrue(json.contains("\"expected\":\"进入首页\""));
        assertTrue(json.indexOf("打开登录页") < json.indexOf("点击登录"));
        /* 全空行被去掉：预期为空的步骤保留 expected:null */
        assertTrue(json.contains("\"expected\":null"));
    }

    @Test
    void createRejectsStepWithExpectedButNoAction() {
        TestCaseSaveRequest req = saveRequest("登录用例");
        req.setSteps(Collections.singletonList(step("  ", "应有结果")));
        AppException error = assertThrows(AppException.class, () -> service.create(USER, WS, req));
        assertEquals(400, error.getCode());
        assertTrue(error.getMessage().contains("操作内容"));
    }

    /* ---------- 查询 ---------- */

    @Test
    void listParsesStepsJsonAndClearsRawField() {
        TestCaseView row = new TestCaseView();
        row.setId("C1");
        row.setTitle("登录用例");
        row.setStepsJson("[{\"action\":\"打开登录页\",\"expected\":\"显示\"}]");
        when(cases.selectViewByReq(WS, REQ)).thenReturn(Collections.singletonList(row));

        List<TestCaseView> result = service.list(WS, USER, REQ);

        assertEquals(1, result.size());
        assertEquals(1, result.get(0).getSteps().size());
        assertEquals("打开登录页", result.get(0).getSteps().get(0).get("action"));
        assertNull(result.get(0).getStepsJson());
        verify(access).assertView(WS, USER, REQ);
    }

    @Test
    void statsCountsStatusesAndDerivesUntested() {
        when(cases.countByReq(WS, REQ)).thenReturn(6);
        List<Map<String, Object>> groups = new ArrayList<Map<String, Object>>();
        groups.add(statusRow("passed", 3));
        groups.add(statusRow("failed", 1));
        groups.add(statusRow("blocked", 1));
        groups.add(statusRow("legacy", 1));
        when(cases.countGroupByStatus(WS, REQ)).thenReturn(groups);

        CaseStatsView stats = service.stats(WS, USER, REQ);

        assertEquals(6, stats.getTotal());
        assertEquals(3, stats.getPassed());
        assertEquals(1, stats.getFailed());
        assertEquals(1, stats.getBlocked());
        assertEquals(1, stats.getUntested());
    }

    private static Map<String, Object> statusRow(String status, int count) {
        Map<String, Object> row = new HashMap<String, Object>();
        row.put("status", status);
        row.put("cnt", count);
        return row;
    }

    @Test
    void getRejectsForeignWorkspace() {
        TestCase foreign = existing("C9", null);
        foreign.setWorkspaceId("W2");
        when(cases.selectById("C9")).thenReturn(foreign);
        AppException error = assertThrows(AppException.class, () -> service.get(WS, "C9"));
        assertEquals(404, error.getCode());
    }

    /* ---------- 执行标记 ---------- */

    @Test
    void runAppendsRunRowAndRefreshesLatest() {
        when(cases.selectById("C1")).thenReturn(existing("C1", null), existing("C1", "failed"));
        CaseRunRequest req = new CaseRunRequest();
        req.setStatus("failed");
        req.setNote("  密码框报错  ");

        service.run(USER, WS, "C1", req);

        ArgumentCaptor<TestCaseRun> captor = ArgumentCaptor.forClass(TestCaseRun.class);
        verify(runs).insert(captor.capture());
        TestCaseRun run = captor.getValue();
        assertTrue(run.getId().startsWith("R"));
        assertEquals("C1", run.getCaseId());
        assertEquals(WS, run.getWorkspaceId());
        assertEquals("failed", run.getStatus());
        assertEquals("密码框报错", run.getNote());
        assertEquals("我", run.getExecutedBy());
        assertEquals(USER, run.getExecutedByUserId());
        verify(cases).updateLatest(WS, "C1", "failed", "密码框报错", "我", USER);
    }

    @Test
    void createRecordsCreatorDistinctFromExecutor() {
        when(cases.selectById(anyString())).thenReturn(existing("C1", null));
        service.create(USER, WS, saveRequest("登录用例"));
        ArgumentCaptor<TestCase> captor = ArgumentCaptor.forClass(TestCase.class);
        verify(cases).insert(captor.capture());
        assertEquals("我", captor.getValue().getCreatedBy());
        assertEquals(USER, captor.getValue().getCreatedByUserId());
    }

    @Test
    void runRecordsEnvironmentAndProxyExecutor() {
        when(cases.selectById("C1")).thenReturn(existing("C1", null));
        com.hourglass.entity.WorkspaceMember m = new com.hourglass.entity.WorkspaceMember();
        m.setUserId("U2");
        m.setDisplayName("张三");
        when(members.selectByWorkspace(WS)).thenReturn(Collections.singletonList(m));
        CaseRunRequest req = new CaseRunRequest();
        req.setStatus("failed");
        req.setEnvironment("  Chrome 120 / Win11  ");
        req.setExecutedByUserId("U2");

        service.run(USER, WS, "C1", req);

        ArgumentCaptor<TestCaseRun> captor = ArgumentCaptor.forClass(TestCaseRun.class);
        verify(runs).insert(captor.capture());
        TestCaseRun run = captor.getValue();
        assertEquals("Chrome 120 / Win11", run.getEnvironment());
        assertEquals("张三", run.getExecutedBy());
        assertEquals("U2", run.getExecutedByUserId());
        verify(cases).updateLatest(WS, "C1", "failed", null, "张三", "U2");
    }

    @Test
    void runRejectsExecutorOutsideWorkspace() {
        when(cases.selectById("C1")).thenReturn(existing("C1", null));
        when(members.selectByWorkspace(WS)).thenReturn(Collections.<com.hourglass.entity.WorkspaceMember>emptyList());
        CaseRunRequest req = new CaseRunRequest();
        req.setStatus("passed");
        req.setExecutedByUserId("U9");
        AppException error = assertThrows(AppException.class, () -> service.run(USER, WS, "C1", req));
        assertEquals(400, error.getCode());
        assertTrue(error.getMessage().contains("空间成员"));
        verify(runs, never()).insert(any(TestCaseRun.class));
    }

    /* ---------- 失败转缺陷 ---------- */

    @Test
    void fileDefectRejectsWhenLatestIsNotFailed() {
        when(cases.selectById("C1")).thenReturn(existing("C1", "passed"));
        CaseDefectRequest req = new CaseDefectRequest();
        req.setSeverity("major");
        AppException error = assertThrows(AppException.class, () -> service.fileDefect(USER, WS, "C1", req));
        assertEquals(400, error.getCode());
        verify(taskCommand, never()).create(anyString(), anyString(), any());
    }

    @Test
    void fileDefectCreatesBugTaskAndLinksBackToCaseAndRun() {
        TestCase c = existing("C1", "failed");
        c.setPrecondition("已有账号");
        c.setSteps("[{\"action\":\"点击登录\",\"expected\":\"进入首页\"}]");
        c.setLatestNote("点击后无响应");
        when(cases.selectById("C1")).thenReturn(c);

        Task task = new Task();
        task.setId("T1");
        when(taskCommand.create(eq(USER), eq(WS), any())).thenReturn(task);

        TestCaseRun latest = new TestCaseRun();
        latest.setId("R1");
        latest.setStatus("failed");
        when(runs.selectLatestByCase("C1")).thenReturn(latest);

        CaseDefectRequest req = new CaseDefectRequest();
        req.setSeverity("major");
        req.setEnvironment("Chrome");

        Task result = service.fileDefect(USER, WS, "C1", req);

        assertEquals("T1", result.getId());
        ArgumentCaptor<com.hourglass.dto.TaskSaveRequest> captor =
                ArgumentCaptor.forClass(com.hourglass.dto.TaskSaveRequest.class);
        verify(taskCommand).create(eq(USER), eq(WS), captor.capture());
        com.hourglass.dto.TaskSaveRequest tReq = captor.getValue();
        assertEquals("bug", tReq.getItemType());
        assertEquals("major", tReq.getSeverity());
        assertEquals("Chrome", tReq.getEnvironment());
        assertEquals(REQ, tReq.getReqId());
        assertEquals("登录用例", tReq.getTitle());
        String desc = tReq.getDescription();
        assertTrue(desc.contains("前置条件：\n已有账号"));
        assertTrue(desc.contains("1. 点击登录（预期：进入首页）"));
        assertTrue(desc.contains("失败备注：点击后无响应"));
        verify(cases).updateLatestBug(WS, "C1", "T1");
        verify(runs).updateBugTask("R1", "T1");
    }

    @Test
    void fileDefectSkipsRunLinkWhenLatestRunIsNotFailed() {
        when(cases.selectById("C1")).thenReturn(existing("C1", "failed"));
        Task task = new Task();
        task.setId("T1");
        when(taskCommand.create(eq(USER), eq(WS), any())).thenReturn(task);
        TestCaseRun stale = new TestCaseRun();
        stale.setId("R2");
        stale.setStatus("passed");
        when(runs.selectLatestByCase("C1")).thenReturn(stale);

        CaseDefectRequest req = new CaseDefectRequest();
        req.setSeverity("minor");
        service.fileDefect(USER, WS, "C1", req);

        verify(cases).updateLatestBug(WS, "C1", "T1");
        verify(runs, never()).updateBugTask(anyString(), anyString());
    }

    @Test
    void fileDefectTruncatesTitleAndDescriptionToTaskLimits() {
        TestCase c = existing("C1", "failed");
        c.setTitle(repeat("长标题", 20)); // 60 字：用例口径允许，任务上限 60
        c.setSteps("[{\"action\":\"" + repeat("操作", 50) + "\",\"expected\":\"预期\"}]");
        c.setLatestNote(repeat("备注", 60));
        when(cases.selectById("C1")).thenReturn(c);
        Task task = new Task();
        task.setId("T1");
        when(taskCommand.create(eq(USER), eq(WS), any())).thenReturn(task);
        when(runs.selectLatestByCase("C1")).thenReturn(null);

        CaseDefectRequest req = new CaseDefectRequest();
        req.setSeverity("major");
        service.fileDefect(USER, WS, "C1", req);

        ArgumentCaptor<com.hourglass.dto.TaskSaveRequest> captor =
                ArgumentCaptor.forClass(com.hourglass.dto.TaskSaveRequest.class);
        verify(taskCommand).create(eq(USER), eq(WS), captor.capture());
        com.hourglass.dto.TaskSaveRequest tReq = captor.getValue();
        /* 截断后必须落在任务保存校验上限内，否则转缺陷被 400 拒绝 */
        assertEquals(60, tReq.getTitle().length());
        assertTrue(tReq.getDescription().length() <= 2000);
    }

    @Test
    void fileDefectCarriesEvidenceAndAppendsNoteByDefault() {
        TestCase c = existing("C1", "failed");
        when(cases.selectById("C1")).thenReturn(c);
        Task task = new Task();
        task.setId("T1");
        task.setTitle("登录用例");
        when(taskCommand.create(eq(USER), eq(WS), any())).thenReturn(task);
        TestCaseRun latest = new TestCaseRun();
        latest.setId("R1");
        latest.setStatus("failed");
        latest.setExecutedBy("张三");
        latest.setEnvironment("Chrome 120");
        latest.setCreatedAt(java.time.LocalDateTime.of(2026, 11, 14, 10, 30));
        when(runs.selectLatestByCase("C1")).thenReturn(latest);
        when(attachments.copyRunEvidenceToTask(USER, WS, "R1", "T1")).thenReturn(2);

        CaseDefectRequest req = new CaseDefectRequest();
        req.setSeverity("critical");
        req.setNote("  刷新后可复现  ");
        service.fileDefect(USER, WS, "C1", req);

        ArgumentCaptor<com.hourglass.dto.TaskSaveRequest> captor =
                ArgumentCaptor.forClass(com.hourglass.dto.TaskSaveRequest.class);
        verify(taskCommand).create(eq(USER), eq(WS), captor.capture());
        String desc = captor.getValue().getDescription();
        assertTrue(desc.contains("执行人：张三"));
        assertTrue(desc.contains("执行时间：2026-11-14 10:30"));
        assertTrue(desc.contains("执行环境：Chrome 120"));
        assertTrue(desc.contains("转缺陷补充：刷新后可复现"));
        verify(attachments).copyRunEvidenceToTask(USER, WS, "R1", "T1");
        ArgumentCaptor<String> detail = ArgumentCaptor.forClass(String.class);
        verify(auditService).recordCurrent(eq(WS), eq("test_case_defect"), eq("test_case"), eq("C1"),
                any(), eq(true), detail.capture(), isNull());
        assertTrue(detail.getValue().contains("携带 2 份失败证据"));
    }

    @Test
    void fileDefectSkipsEvidenceWhenCarryDisabled() {
        when(cases.selectById("C1")).thenReturn(existing("C1", "failed"));
        Task task = new Task();
        task.setId("T1");
        when(taskCommand.create(eq(USER), eq(WS), any())).thenReturn(task);
        TestCaseRun latest = new TestCaseRun();
        latest.setId("R1");
        latest.setStatus("failed");
        when(runs.selectLatestByCase("C1")).thenReturn(latest);

        CaseDefectRequest req = new CaseDefectRequest();
        req.setSeverity("minor");
        req.setCarryEvidence(false);
        service.fileDefect(USER, WS, "C1", req);

        verify(attachments, never()).copyRunEvidenceToTask(anyString(), anyString(), anyString(), anyString());
    }

    @Test
    void byBugTaskFiltersProjectsInvisibleToViewer() {
        com.hourglass.dto.CaseBugLink visible = new com.hourglass.dto.CaseBugLink();
        visible.setCaseId("C1");
        visible.setReqId(REQ);
        com.hourglass.dto.CaseBugLink hidden = new com.hourglass.dto.CaseBugLink();
        hidden.setCaseId("C2");
        hidden.setReqId("R2");
        when(runs.selectByBugTask(WS, "T1")).thenReturn(Arrays.asList(visible, hidden));
        when(access.canView(WS, USER, REQ)).thenReturn(true);
        when(access.canView(WS, USER, "R2")).thenReturn(false);

        List<com.hourglass.dto.CaseBugLink> out = service.byBugTask(WS, USER, "T1");

        assertEquals(1, out.size());
        assertEquals("C1", out.get(0).getCaseId());
    }

    private static String repeat(String unit, int times) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < times; i++) {
            sb.append(unit);
        }
        return sb.toString();
    }

    /* ---------- 删除与级联 ---------- */

    @Test
    void deleteCascadesRunsFirst() {
        when(cases.selectById("C1")).thenReturn(existing("C1", "passed"));
        service.delete(USER, WS, "C1");
        verify(runs).deleteByCase(WS, "C1");
        verify(cases).delete(WS, "C1");
        verify(auditService).recordCurrent(eq(WS), eq("test_case_delete"), eq("test_case"), eq("C1"),
                any(), eq(true), anyString(), isNull());
    }

    @Test
    void deleteByReqCleansUpAndReturnsCount() {
        when(cases.countByReq(WS, REQ)).thenReturn(3);
        assertEquals(3, service.deleteByReq(WS, REQ));
        verify(runs).deleteByReq(WS, REQ);
        verify(cases).deleteByReq(WS, REQ);
    }

    @Test
    void deleteByReqSkipsCleanupWhenEmpty() {
        when(cases.countByReq(WS, REQ)).thenReturn(0);
        assertEquals(0, service.deleteByReq(WS, REQ));
        verify(runs, never()).deleteByReq(anyString(), anyString());
        verify(cases, never()).deleteByReq(anyString(), anyString());
    }

    /* ---------- 变更记录 ---------- */

    @Test
    void updateAuditDetailNamesChangedFields() {
        TestCase c = existing("C1", null);
        c.setModule("登录");
        c.setPriority("P2");
        c.setPrecondition("旧条件");
        c.setTestData("旧数据");
        c.setSteps("[]");
        when(cases.selectById("C1")).thenReturn(c);

        TestCaseSaveRequest req = saveRequest("登录用例");
        req.setModule("认证");
        req.setPriority("P1");
        req.setPrecondition("新条件");
        req.setTestData("旧数据");
        req.setSteps(Collections.singletonList(step("打开登录页", "页面正常显示")));
        service.update(USER, WS, "C1", req);

        ArgumentCaptor<String> detail = ArgumentCaptor.forClass(String.class);
        verify(auditService).recordCurrent(eq(WS), eq("test_case_update"), eq("test_case"), eq("C1"),
                any(), eq(true), detail.capture(), isNull());
        String text = detail.getValue();
        assertTrue(text.contains("模块由「登录」改为「认证」"));
        assertTrue(text.contains("优先级 P2 → P1"));
        assertTrue(text.contains("修改前置条件"));
        assertTrue(text.contains("修改执行步骤"));
        assertTrue(!text.contains("修改测试数据"), "测试数据未变不应写入差异：" + text);
    }

    @Test
    void timelineChecksProjectVisibilityBeforeReadingAudit() {
        when(cases.selectById("C1")).thenReturn(existing("C1", "passed"));
        List<com.hourglass.dto.EntityTimelineItem> rows = new ArrayList<>();
        when(auditService.timeline(WS, "test_case", "C1", 100)).thenReturn(rows);

        assertTrue(service.timeline(WS, USER, "C1").isEmpty());
        verify(access).assertView(WS, USER, REQ);
        verify(auditService).timeline(WS, "test_case", "C1", 100);
    }

    @Test
    void timelineRejectsCaseOutsideWorkspace() {
        TestCase other = existing("C1", "passed");
        other.setWorkspaceId("W2");
        when(cases.selectById("C1")).thenReturn(other);

        AppException ex = assertThrows(AppException.class, () -> service.timeline(WS, USER, "C1"));
        assertTrue(ex.getMessage().contains("用例不存在"));
        verify(access, never()).assertView(anyString(), anyString(), anyString());
        verify(auditService, never()).timeline(anyString(), anyString(), anyString(), org.mockito.ArgumentMatchers.anyInt());
    }
}
