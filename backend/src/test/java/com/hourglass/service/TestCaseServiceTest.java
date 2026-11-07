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
    private final TestCaseService service =
            new TestCaseService(cases, runs, taskCommand, access, reqs);

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
        assertEquals(200, tReq.getDescription().length());
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
}
