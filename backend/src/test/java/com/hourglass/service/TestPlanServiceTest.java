package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.common.LoginUser;
import com.hourglass.dto.PlanBatchRequest;
import com.hourglass.dto.TestPlanSaveRequest;
import com.hourglass.dto.TestPlanView;
import com.hourglass.entity.TestCase;
import com.hourglass.entity.TestPlan;
import com.hourglass.mapper.TestCaseMapper;
import com.hourglass.mapper.TestPlanCaseMapper;
import com.hourglass.mapper.TestPlanMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** A2：测试计划圈选/批量执行/快照口径 */
class TestPlanServiceTest {

    private static final String WS = "W1";
    private static final String USER = "U1";
    private static final String REQ = "R1";
    private static final String PLAN = "TP1";

    private final TestPlanMapper plans = mock(TestPlanMapper.class);
    private final TestPlanCaseMapper planCases = mock(TestPlanCaseMapper.class);
    private final TestCaseMapper cases = mock(TestCaseMapper.class);
    private final TestCaseService caseService = mock(TestCaseService.class);
    private final ProjectAccessService access = mock(ProjectAccessService.class);
    private final com.hourglass.mapper.ProjectVersionMapper versions = mock(com.hourglass.mapper.ProjectVersionMapper.class);
    private final AuditService auditService = mock(AuditService.class);
    private final TestPlanService service =
            new TestPlanService(plans, planCases, cases, caseService, access, versions, auditService);

    @BeforeEach
    void setUp() {
        LoginUser user = new LoginUser(USER, "u1", "x", "测试同学", "user");
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(user, null, user.getAuthorities()));
    }

    @AfterEach
    void tearDown() {
        SecurityContextHolder.clearContext();
    }

    private static TestPlan plan(String status) {
        TestPlan p = new TestPlan();
        p.setId(PLAN);
        p.setWorkspaceId(WS);
        p.setReqId(REQ);
        p.setName("v1.2 回归");
        p.setStatus(status);
        return p;
    }

    private static TestCase testCase(String id, String reqId) {
        TestCase c = new TestCase();
        c.setId(id);
        c.setWorkspaceId(WS);
        c.setReqId(reqId);
        c.setTitle("用例 " + id);
        return c;
    }

    @Test
    void addCasesSkipsExistingAndRejectsForeignCase() {
        when(plans.selectById(PLAN)).thenReturn(plan("draft"));
        when(planCases.selectCaseIds(PLAN)).thenReturn(new ArrayList<String>(Arrays.asList("C1")));
        when(cases.selectById("C2")).thenReturn(testCase("C2", REQ));
        when(cases.selectById("C3")).thenReturn(testCase("C3", "R2"));

        PlanBatchRequest req = new PlanBatchRequest();
        req.setCaseIds(Arrays.asList("C1", "C2"));
        assertEquals(1, service.addCases(USER, WS, PLAN, req), "已在计划内的 C1 静默跳过，只新增 C2");
        verify(planCases).insert(any(com.hourglass.entity.TestPlanCase.class));

        req.setCaseIds(Arrays.asList("C3"));
        assertThrows(AppException.class, () -> service.addCases(USER, WS, PLAN, req));
    }

    @Test
    void addCasesRejectsDonePlan() {
        when(plans.selectById(PLAN)).thenReturn(plan("done"));
        PlanBatchRequest req = new PlanBatchRequest();
        req.setCaseIds(Arrays.asList("C2"));
        assertThrows(AppException.class, () -> service.addCases(USER, WS, PLAN, req));
        verify(planCases, never()).insert(any(com.hourglass.entity.TestPlanCase.class));
    }

    @Test
    void batchRunReusesSingleRunPipelineAndMarksPlanCase() {
        when(plans.selectById(PLAN)).thenReturn(plan("running"));
        when(planCases.selectCaseIds(PLAN)).thenReturn(new ArrayList<String>(Arrays.asList("C1", "C2")));

        PlanBatchRequest req = new PlanBatchRequest();
        req.setCaseIds(Arrays.asList("C1", "C9", null));
        req.setStatus("failed");
        req.setNote("接口 500");

        assertEquals(1, service.batchRun(USER, WS, PLAN, req), "计划外与空 id 都不计入");
        verify(caseService).run(eq(USER), eq(WS), eq("C1"), any(com.hourglass.dto.CaseRunRequest.class), eq(PLAN));
        verify(planCases).updateResult(PLAN, "C1", "failed", "接口 500", "测试同学", USER);
    }

    @Test
    void batchRunRejectsInvalidStatusAndNothingSelected() {
        when(plans.selectById(PLAN)).thenReturn(plan("running"));
        when(planCases.selectCaseIds(PLAN)).thenReturn(new ArrayList<String>(Arrays.asList("C1")));

        PlanBatchRequest bad = new PlanBatchRequest();
        bad.setCaseIds(Arrays.asList("C1"));
        bad.setStatus("skip");
        assertThrows(AppException.class, () -> service.batchRun(USER, WS, PLAN, bad));

        PlanBatchRequest miss = new PlanBatchRequest();
        miss.setCaseIds(Arrays.asList("C9"));
        miss.setStatus("passed");
        AppException ex = assertThrows(AppException.class, () -> service.batchRun(USER, WS, PLAN, miss));
        assertTrueContains(ex.getMessage(), "不在本计划");
        verify(caseService, never()).run(any(String.class), any(String.class), any(String.class),
                any(com.hourglass.dto.CaseRunRequest.class), any(String.class));
    }

    @Test
    void batchRunFlipsDraftToRunning() {
        when(plans.selectById(PLAN)).thenReturn(plan("draft"));
        when(planCases.selectCaseIds(PLAN)).thenReturn(new ArrayList<String>(Arrays.asList("C1")));
        List<String> ids = new ArrayList<String>();
        ids.add("C1");

        PlanBatchRequest req = new PlanBatchRequest();
        req.setCaseIds(ids);
        req.setStatus("passed");
        assertEquals(1, service.batchRun(USER, WS, PLAN, req));
        verify(plans).updateStatus(PLAN, "running");
    }

    @Test
    void setStatusDoneRequiresCasesAndUpdateLocksSnapshot() {
        when(plans.selectById(PLAN)).thenReturn(plan("running"));
        TestPlanView empty = new TestPlanView();
        empty.setCaseCount(0);
        when(plans.selectViewById(PLAN)).thenReturn(empty);
        assertThrows(AppException.class, () -> service.setStatus(USER, WS, PLAN, "done"));

        TestPlanView full = new TestPlanView();
        full.setCaseCount(3);
        when(plans.selectViewById(PLAN)).thenReturn(full);
        service.setStatus(USER, WS, PLAN, "done");
        verify(plans).updateStatus(PLAN, "done");
        verify(auditService).recordCurrent(eq(WS), eq("test_plan_status"), eq("test_plan"), eq(PLAN),
                any(), eq(true), contains("running → done"), isNull());

        assertThrows(AppException.class, () -> service.setStatus(USER, WS, PLAN, "archived"));

        /* done 之后计划是快照：update 也必须拒绝 */
        when(plans.selectById(PLAN)).thenReturn(plan("done"));
        TestPlanSaveRequest save = new TestPlanSaveRequest();
        save.setReqId(REQ);
        save.setName("改名");
        assertThrows(AppException.class, () -> service.update(USER, WS, PLAN, save));
    }

    @Test
    void createForcesDraftAndValidatesVersionOwnership() {
        com.hourglass.entity.ProjectVersion own = new com.hourglass.entity.ProjectVersion();
        own.setId("V1"); own.setWorkspaceId(WS); own.setReqId(REQ);
        com.hourglass.entity.ProjectVersion foreign = new com.hourglass.entity.ProjectVersion();
        foreign.setId("V9"); foreign.setWorkspaceId("W2"); foreign.setReqId(REQ);
        com.hourglass.entity.ProjectVersion otherProject = new com.hourglass.entity.ProjectVersion();
        otherProject.setId("V8"); otherProject.setWorkspaceId(WS); otherProject.setReqId("R2");
        when(versions.selectById("V1")).thenReturn(own);
        when(versions.selectById("V9")).thenReturn(foreign);
        when(versions.selectById("V8")).thenReturn(otherProject);

        TestPlanSaveRequest req = new TestPlanSaveRequest();
        req.setReqId(REQ);
        req.setName("回归");
        req.setStatus("done");
        req.setVersionId("V1");
        service.create(USER, WS, req);
        org.mockito.ArgumentCaptor<TestPlan> saved = org.mockito.ArgumentCaptor.forClass(TestPlan.class);
        verify(plans).insert(saved.capture());
        assertEquals("draft", saved.getValue().getStatus(), "完成态只能经 setStatus，且需先圈选用例");
        assertEquals("V1", saved.getValue().getVersionId());

        req.setVersionId("V9");
        assertThrows(AppException.class, () -> service.create(USER, WS, req), "跨空间版本拒绝");
        req.setVersionId("V8");
        assertThrows(AppException.class, () -> service.create(USER, WS, req), "其他项目的版本拒绝");
    }

    @Test
    void updateCannotMovePlanToAnotherProject() {
        when(plans.selectById(PLAN)).thenReturn(plan("draft"));
        TestPlanSaveRequest save = new TestPlanSaveRequest();
        save.setReqId("R2");
        save.setName("改项目");
        assertThrows(AppException.class, () -> service.update(USER, WS, PLAN, save));
        verify(plans, never()).update(any(TestPlan.class));
    }

    @Test
    void deleteRemovesPlanCasesFirst() {
        when(plans.selectById(PLAN)).thenReturn(plan("done"));
        service.delete(USER, WS, PLAN);
        verify(planCases).deleteByPlan(PLAN);
        verify(plans).deleteById(WS, PLAN);
    }

    private static void assertTrueContains(String actual, String part) {
        org.junit.jupiter.api.Assertions.assertTrue(actual != null && actual.contains(part),
                "报错信息应包含「" + part + "」，实际：" + actual);
    }
}
