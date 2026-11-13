package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.common.CaseMeta;
import com.hourglass.common.CurrentUser;
import com.hourglass.common.Ids;
import com.hourglass.common.Texts;
import com.hourglass.dto.CaseRunRequest;
import com.hourglass.dto.PlanBatchRequest;
import com.hourglass.dto.TestPlanCaseView;
import com.hourglass.dto.TestPlanSaveRequest;
import com.hourglass.dto.TestPlanView;
import com.hourglass.entity.TestCase;
import com.hourglass.entity.TestPlan;
import com.hourglass.entity.TestPlanCase;
import com.hourglass.mapper.TestCaseMapper;
import com.hourglass.mapper.TestPlanCaseMapper;
import com.hourglass.mapper.TestPlanMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 测试计划（A2 测试最小闭环）：项目下的回归/迭代容器。
 * 圈选用例 → 计划内批量执行（结果写 test_plan_case + 追加 test_case_run 流水并同步用例最近结果）
 * → 汇总（执行进度/通过率/缺陷数）由 SQL 聚合一次带回。
 * 状态：draft（未开跑）→ running（首次批量执行自动流转，也可手动）→ done（归档快照）。
 */
@Service
public class TestPlanService {

    private final TestPlanMapper planMapper;
    private final TestPlanCaseMapper planCaseMapper;
    private final TestCaseMapper caseMapper;
    private final TestCaseService caseService;
    private final ProjectAccessService projectAccess;
    private final com.hourglass.mapper.ProjectVersionMapper versionMapper;
    /** 计划删除与状态流转影响交付判断，需独立审计 */
    private final AuditService auditService;

    public TestPlanService(TestPlanMapper planMapper, TestPlanCaseMapper planCaseMapper,
                           TestCaseMapper caseMapper, TestCaseService caseService,
                           ProjectAccessService projectAccess,
                           com.hourglass.mapper.ProjectVersionMapper versionMapper,
                           AuditService auditService) {
        this.planMapper = planMapper;
        this.planCaseMapper = planCaseMapper;
        this.caseMapper = caseMapper;
        this.caseService = caseService;
        this.projectAccess = projectAccess;
        this.versionMapper = versionMapper;
        this.auditService = auditService;
    }

    /* ---------- 查询 ---------- */

    public com.hourglass.dto.PageResult<TestPlanView> page(String workspaceId, String userId, String reqId,
                                                            int offset, int limit) {
        projectAccess.assertView(workspaceId, userId, reqId);
        int safeOffset = Math.max(0, offset);
        int safeLimit = Math.max(1, Math.min(100, limit));
        int total = planMapper.countByReq(workspaceId, reqId);
        List<TestPlanView> items = total <= safeOffset ? new ArrayList<TestPlanView>()
                : planMapper.selectViewByReq(workspaceId, reqId, safeOffset, safeLimit);
        return com.hourglass.dto.PageResult.of(items, total, safeOffset, safeLimit);
    }

    /** 计划详情：本体与执行汇总；用例行通过独立分页接口读取 */
    public Map<String, Object> detail(String workspaceId, String userId, String id) {
        TestPlan plan = requirePlan(workspaceId, id);
        projectAccess.assertView(workspaceId, userId, plan.getReqId());
        TestPlanView view = planMapper.selectViewById(id);
        Map<String, Object> out = new LinkedHashMap<String, Object>();
        out.put("plan", view);
        /* 通过率分母排除跳过的用例：跳过表示本次不适用，不该拉低通过率 */
        int rateBase = view == null ? 0 : view.getExecutedCount() - view.getSkippedCount();
        out.put("passRate", rateBase <= 0
                ? null : Math.round(view.getPassedCount() * 1000.0 / rateBase) / 10.0);
        return out;
    }

    public com.hourglass.dto.PageResult<TestPlanCaseView> cases(
            String workspaceId, String userId, String id, int offset, int limit) {
        TestPlan plan = requirePlan(workspaceId, id);
        projectAccess.assertView(workspaceId, userId, plan.getReqId());
        int safeOffset = Math.max(0, offset);
        int safeLimit = Math.max(1, Math.min(100, limit));
        int total = planCaseMapper.countByPlan(id);
        List<TestPlanCaseView> items = total <= safeOffset ? new ArrayList<TestPlanCaseView>()
                : planCaseMapper.selectViewByPlan(id, safeOffset, safeLimit);
        return com.hourglass.dto.PageResult.of(items, total, safeOffset, safeLimit);
    }

    /* ---------- 写入 ---------- */

    @Transactional
    public TestPlanView create(String userId, String workspaceId, TestPlanSaveRequest req) {
        projectAccess.assertWrite(workspaceId, userId, req.getReqId());
        checkDates(req);
        TestPlan p = new TestPlan();
        p.setId(Ids.gen("TP"));
        p.setWorkspaceId(workspaceId);
        p.setReqId(req.getReqId());
        p.setName(Texts.cut(req.getName().trim(), 100));
        p.setVersionId(checkVersion(workspaceId, req.getReqId(), req.getVersionId()));
        p.setPlannedStart(req.getPlannedStart());
        p.setPlannedEnd(req.getPlannedEnd());
        /* 新计划一律从草稿开始：running / done 只能走 setStatus（done 需先圈选用例） */
        p.setStatus("draft");
        p.setNote(Texts.trimToNull(req.getNote()));
        p.setCreatedBy(CurrentUser.get().getDisplayName());
        p.setCreatedByUserId(userId);
        planMapper.insert(p);
        return planMapper.selectViewById(p.getId());
    }

    @Transactional
    public TestPlanView update(String userId, String workspaceId, String id, TestPlanSaveRequest req) {
        TestPlan p = requirePlan(workspaceId, id);
        projectAccess.assertWrite(workspaceId, userId, p.getReqId());
        assertEditable(p);
        /* 计划圈选的用例都属于原项目：所属项目不可改，否则计划与用例跨项目错位 */
        if (req.getReqId() != null && !req.getReqId().equals(p.getReqId())) {
            throw AppException.badRequest("测试计划的所属项目不可修改");
        }
        checkDates(req);
        p.setName(Texts.cut(req.getName().trim(), 100));
        String keepVersion = Texts.trimToNull(req.getVersionId());
        if (keepVersion != null && keepVersion.equals(p.getVersionId()) && versionMapper.selectById(keepVersion) == null) {
            /* 历史悬空引用（版本已删）：保存时顺手解除，而不是让整个计划无法保存 */
            keepVersion = null;
        }
        p.setVersionId(checkVersion(workspaceId, p.getReqId(), keepVersion));
        p.setPlannedStart(req.getPlannedStart());
        p.setPlannedEnd(req.getPlannedEnd());
        p.setNote(Texts.trimToNull(req.getNote()));
        planMapper.update(p);
        return planMapper.selectViewById(id);
    }

    /** 关联版本必须属于本空间、本项目；空值表示不关联 */
    private String checkVersion(String workspaceId, String reqId, String versionId) {
        String id = Texts.trimToNull(versionId);
        if (id == null) {
            return null;
        }
        com.hourglass.entity.ProjectVersion v = versionMapper.selectById(id);
        if (v == null || !workspaceId.equals(v.getWorkspaceId()) || !java.util.Objects.equals(reqId, v.getReqId())) {
            throw AppException.badRequest("关联版本不存在或不属于该项目");
        }
        return id;
    }

    /** 状态流转：done 前必须已圈选用例；done 后禁止再改内容（快照口径） */
    @Transactional
    public TestPlanView setStatus(String userId, String workspaceId, String id, String status) {
        if (!status.matches("^(draft|running|done)$")) {
            throw AppException.badRequest("计划状态不合法");
        }
        TestPlan p = requirePlan(workspaceId, id);
        projectAccess.assertWrite(workspaceId, userId, p.getReqId());
        if ("done".equals(status)) {
            TestPlanView v = planMapper.selectViewById(id);
            if (v == null || v.getCaseCount() == 0) {
                throw AppException.badRequest("计划还没有圈选用例，无法标记完成");
            }
        }
        String oldStatus = p.getStatus();
        planMapper.updateStatus(id, status);
        if (!status.equals(oldStatus)) {
            auditService.recordCurrent(workspaceId, "test_plan_status", "test_plan", id, p.getName(), true,
                    "测试计划「" + p.getName() + "」状态：" + oldStatus + " → " + status, null);
        }
        return planMapper.selectViewById(id);
    }

    @Transactional
    public void delete(String userId, String workspaceId, String id) {
        TestPlan p = requirePlan(workspaceId, id);
        projectAccess.assertWrite(workspaceId, userId, p.getReqId());
        planCaseMapper.deleteByPlan(id);
        planMapper.deleteById(workspaceId, id);
        auditService.recordCurrent(workspaceId, "test_plan_delete", "test_plan", id, p.getName(), true,
                "删除测试计划「" + p.getName() + "」", null);
    }

    /* ---------- 圈选与批量执行 ---------- */

    /** 加入计划：只接受同项目的用例，已在计划内的静默跳过，返回实际新增数 */
    @Transactional
    public int addCases(String userId, String workspaceId, String planId, PlanBatchRequest req) {
        TestPlan p = requirePlan(workspaceId, planId);
        projectAccess.assertWrite(workspaceId, userId, p.getReqId());
        assertEditable(p);
        Set<String> exists = new HashSet<String>(planCaseMapper.selectCaseIds(planId));
        int added = 0;
        for (String caseId : req.getCaseIds()) {
            if (caseId == null || exists.contains(caseId)) {
                continue;
            }
            TestCase c = caseMapper.selectById(caseId);
            if (c == null || !workspaceId.equals(c.getWorkspaceId()) || !p.getReqId().equals(c.getReqId())) {
                throw AppException.badRequest("用例不属于该项目或已不存在：" + caseId);
            }
            TestPlanCase row = new TestPlanCase();
            row.setId(Ids.gen("PC"));
            row.setPlanId(planId);
            row.setCaseId(caseId);
            planCaseMapper.insert(row);
            exists.add(caseId);
            added++;
        }
        return added;
    }

    @Transactional
    public void removeCase(String userId, String workspaceId, String planId, String caseId) {
        TestPlan p = requirePlan(workspaceId, planId);
        projectAccess.assertWrite(workspaceId, userId, p.getReqId());
        assertEditable(p);
        planCaseMapper.deleteByPlanAndCase(planId, caseId);
    }

    /**
     * 批量执行：每例追加一条带 plan_id 的执行流水（沿用单例执行链路，
     * 用例全局最近结果同步更新），并把结果回写 test_plan_case；
     * draft 计划首次执行自动流转 running。返回处理条数。
     */
    @Transactional
    public int batchRun(String userId, String workspaceId, String planId, PlanBatchRequest req) {
        if (!CaseMeta.isRunStatus(req.getStatus())) {
            throw AppException.badRequest("执行结果不合法");
        }
        TestPlan p = requirePlan(workspaceId, planId);
        projectAccess.assertWrite(workspaceId, userId, p.getReqId());
        assertEditable(p);
        Set<String> inPlan = new HashSet<String>(planCaseMapper.selectCaseIds(planId));
        CaseRunRequest runReq = new CaseRunRequest();
        runReq.setStatus(req.getStatus());
        runReq.setNote(req.getNote());
        int done = 0;
        for (String caseId : req.getCaseIds()) {
            if (caseId == null || !inPlan.contains(caseId)) {
                continue;
            }
            caseService.run(userId, workspaceId, caseId, runReq, planId);
            String note = Texts.trimToNull(req.getNote());
            planCaseMapper.updateResult(planId, caseId, req.getStatus(), note,
                    CurrentUser.get().getDisplayName(), userId);
            done++;
        }
        if (done == 0) {
            throw AppException.badRequest("勾选的用例都不在本计划中");
        }
        if ("draft".equals(p.getStatus())) {
            planMapper.updateStatus(planId, "running");
        }
        return done;
    }

    /* ---------- 内部 ---------- */

    private TestPlan requirePlan(String workspaceId, String id) {
        TestPlan p = planMapper.selectById(id);
        if (p == null || !workspaceId.equals(p.getWorkspaceId())) {
            throw AppException.notFound("测试计划不存在：" + id);
        }
        return p;
    }

    private void assertEditable(TestPlan p) {
        if ("done".equals(p.getStatus())) {
            throw AppException.badRequest("计划已完成（快照口径），如需继续执行请先改回执行中");
        }
    }

    private void checkDates(TestPlanSaveRequest req) {
        if (req.getPlannedStart() != null && req.getPlannedEnd() != null
                && req.getPlannedEnd().isBefore(req.getPlannedStart())) {
            throw AppException.badRequest("计划结束日不能早于开始日");
        }
    }
}
