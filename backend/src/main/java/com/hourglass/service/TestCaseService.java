package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.common.CaseMeta;
import com.hourglass.common.CurrentUser;
import com.hourglass.common.Ids;
import com.hourglass.common.Texts;
import com.hourglass.dto.CaseDefectRequest;
import com.hourglass.dto.CaseRunRequest;
import com.hourglass.dto.CaseStatsView;
import com.hourglass.dto.TaskSaveRequest;
import com.hourglass.dto.TestCaseSaveRequest;
import com.hourglass.dto.TestCaseView;
import com.hourglass.entity.Demand;
import com.hourglass.entity.Requirement;
import com.hourglass.entity.Task;
import com.hourglass.entity.TestCase;
import com.hourglass.entity.TestCaseRun;
import com.hourglass.mapper.DemandMapper;
import com.hourglass.mapper.RequirementMapper;
import com.hourglass.mapper.TestCaseMapper;
import com.hourglass.mapper.TestCaseRunMapper;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * 测试用例：内容实体（标题/前置条件/结构化步骤）+ 执行流水（每次执行一行，
 * 最近一轮结果冗余在 test_case）。层级：空间 → 项目 → 用例 → 缺陷任务。
 */
@Service
public class TestCaseService {

    private static final Logger log = LoggerFactory.getLogger(TestCaseService.class);
    private static final ObjectMapper JSON = new ObjectMapper();

    private final TestCaseMapper caseMapper;
    private final TestCaseRunMapper runMapper;
    private final TaskCommandService taskCommandService;
    private final ProjectAccessService projectAccess;
    private final RequirementMapper reqMapper;
    private final DemandMapper demandMapper;

    public TestCaseService(TestCaseMapper caseMapper, TestCaseRunMapper runMapper,
                           TaskCommandService taskCommandService, ProjectAccessService projectAccess,
                           RequirementMapper reqMapper, DemandMapper demandMapper) {
        this.caseMapper = caseMapper;
        this.runMapper = runMapper;
        this.taskCommandService = taskCommandService;
        this.projectAccess = projectAccess;
        this.reqMapper = reqMapper;
        this.demandMapper = demandMapper;
    }

    /* ---------- 查询 ---------- */

    public List<TestCaseView> list(String workspaceId, String userId, String reqId) {
        String rid = ensureProject(workspaceId, reqId);
        projectAccess.assertView(workspaceId, userId, rid);
        List<TestCaseView> rows = caseMapper.selectViewByReq(workspaceId, rid);
        for (TestCaseView v : rows) {
            v.setSteps(parseSteps(v.getStepsJson()));
            v.setStepsJson(null);
        }
        return rows;
    }

    public CaseStatsView stats(String workspaceId, String userId, String reqId) {
        String rid = ensureProject(workspaceId, reqId);
        projectAccess.assertView(workspaceId, userId, rid);
        CaseStatsView s = new CaseStatsView();
        s.setTotal(caseMapper.countByReq(workspaceId, rid));
        for (Map<String, Object> row : caseMapper.countGroupByStatus(workspaceId, rid)) {
            String status = String.valueOf(row.get("status"));
            int cnt = ((Number) row.get("cnt")).intValue();
            if (CaseMeta.STATUS_PASSED.equals(status)) {
                s.setPassed(cnt);
            } else if (CaseMeta.STATUS_FAILED.equals(status)) {
                s.setFailed(cnt);
            } else if (CaseMeta.STATUS_BLOCKED.equals(status)) {
                s.setBlocked(cnt);
            }
        }
        s.setUntested(s.getTotal() - s.getPassed() - s.getFailed() - s.getBlocked());
        return s;
    }

    public TestCase get(String workspaceId, String id) {
        TestCase c = caseMapper.selectById(id);
        if (c == null || !workspaceId.equals(c.getWorkspaceId())) {
            throw AppException.notFound("用例不存在：" + id);
        }
        return c;
    }

    /* ---------- 写入 ---------- */

    @Transactional
    public TestCase create(String userId, String workspaceId, TestCaseSaveRequest req) {
        String reqId = ensureProject(workspaceId, req.getReqId());
        projectAccess.assertWrite(workspaceId, userId, reqId);
        TestCase c = new TestCase();
        c.setId(Ids.gen("C"));
        c.setWorkspaceId(workspaceId);
        apply(c, reqId, req);
        caseMapper.insert(c);
        return caseMapper.selectById(c.getId());
    }

    @Transactional
    public TestCase update(String userId, String workspaceId, String id, TestCaseSaveRequest req) {
        TestCase c = get(workspaceId, id);
        projectAccess.assertWrite(workspaceId, userId, c.getReqId());
        String reqId = ensureProject(workspaceId, req.getReqId());
        projectAccess.assertWrite(workspaceId, userId, reqId);
        apply(c, reqId, req);
        caseMapper.update(c);
        return caseMapper.selectById(id);
    }

    @Transactional
    public void delete(String userId, String workspaceId, String id) {
        TestCase c = get(workspaceId, id);
        projectAccess.assertWrite(workspaceId, userId, c.getReqId());
        runMapper.deleteByCase(workspaceId, id);
        caseMapper.delete(workspaceId, id);
    }

    /** 记录一次执行：流水追加一行，最近一轮结果冗余回用例 */
    @Transactional
    public TestCase run(String userId, String workspaceId, String id, CaseRunRequest req) {
        TestCase c = get(workspaceId, id);
        projectAccess.assertWrite(workspaceId, userId, c.getReqId());
        String displayName = CurrentUser.get().getDisplayName();
        String note = Texts.trimToNull(req.getNote());
        TestCaseRun run = new TestCaseRun();
        run.setId(Ids.gen("R"));
        run.setCaseId(id);
        run.setWorkspaceId(workspaceId);
        run.setStatus(req.getStatus());
        run.setNote(note);
        run.setExecutedBy(displayName);
        run.setExecutedByUserId(userId);
        runMapper.insert(run);
        caseMapper.updateLatest(workspaceId, id, req.getStatus(), note, displayName, userId);
        return caseMapper.selectById(id);
    }

    /**
     * 执行失败转缺陷：生成 bug 类型任务（严重度必填，缺陷字段口径），
     * 并回填用例与最近一轮失败流水的缺陷引用。
     */
    @Transactional
    public Task fileDefect(String userId, String workspaceId, String id, CaseDefectRequest req) {
        TestCase c = get(workspaceId, id);
        projectAccess.assertWrite(workspaceId, userId, c.getReqId());
        if (!CaseMeta.STATUS_FAILED.equals(c.getLatestStatus())) {
            throw AppException.badRequest("只有执行失败的用例才能转缺陷");
        }
        TaskSaveRequest tReq = new TaskSaveRequest();
        /* 任务标题/描述上限（60/200）比用例口径窄：自动转出时截断，完整信息留在用例本体 */
        tReq.setTitle(Texts.cut(c.getTitle(), 60));
        tReq.setItemType("bug");
        tReq.setSeverity(req.getSeverity());
        tReq.setEnvironment(Texts.trimToNull(req.getEnvironment()));
        tReq.setReqId(c.getReqId());
        /* 用例关联了需求时，缺陷任务沿用该关联，保持追溯链一致 */
        tReq.setDemandId(c.getDemandId());
        tReq.setDescription(Texts.cut(buildDefectDescription(c), 200));
        Task task = taskCommandService.create(userId, workspaceId, tReq);
        caseMapper.updateLatestBug(workspaceId, id, task.getId());
        TestCaseRun latest = runMapper.selectLatestByCase(id);
        if (latest != null && CaseMeta.STATUS_FAILED.equals(latest.getStatus())) {
            runMapper.updateBugTask(latest.getId(), task.getId());
        }
        return task;
    }

    /** 项目删除级联：清理用例及其流水，返回被删用例数（确认提示用） */
    @Transactional
    public int deleteByReq(String workspaceId, String reqId) {
        int count = caseMapper.countByReq(workspaceId, reqId);
        if (count > 0) {
            runMapper.deleteByReq(workspaceId, reqId);
            caseMapper.deleteByReq(workspaceId, reqId);
        }
        return count;
    }

    /* ---------- 内部 ---------- */

    private void apply(TestCase c, String reqId, TestCaseSaveRequest req) {
        c.setReqId(reqId);
        c.setDemandId(resolveDemand(c.getWorkspaceId(), reqId, req.getDemandId()));
        c.setTitle(Texts.cut(req.getTitle().trim(), 100));
        c.setPrecondition(Texts.trimToNull(req.getPrecondition()));
        c.setModule(Texts.trimToNull(req.getModule()));
        c.setPriority(Texts.trimToNull(req.getPriority()));
        c.setSteps(serializeSteps(req.getSteps()));
    }

    /** 关联需求选填：填了就必须是本空间、且与用例同一项目下的需求池条目 */
    private String resolveDemand(String workspaceId, String reqId, String rawDemandId) {
        String demandId = Texts.trimToNull(rawDemandId);
        if (demandId == null) {
            return null;
        }
        Demand d = demandMapper.selectById(demandId);
        if (d == null || !workspaceId.equals(d.getWorkspaceId()) || !reqId.equals(d.getReqId())) {
            throw AppException.badRequest("关联需求不存在或不属于该项目：" + demandId);
        }
        return demandId;
    }

    private String ensureProject(String workspaceId, String rawReqId) {
        String reqId = Texts.trimToNull(rawReqId);
        if (reqId == null) {
            throw AppException.badRequest("请选择所属项目");
        }
        Requirement r = reqMapper.selectById(reqId);
        if (r == null || !workspaceId.equals(r.getWorkspaceId())) {
            throw AppException.badRequest("所属项目不存在：" + reqId);
        }
        return reqId;
    }

    /** 步骤清洗：去掉空行；操作内容必填；序号在保存时重排 */
    private String serializeSteps(List<TestCaseSaveRequest.StepItem> items) {
        List<Map<String, String>> rows = new ArrayList<Map<String, String>>();
        if (items != null) {
            for (TestCaseSaveRequest.StepItem item : items) {
                if (item == null) {
                    continue;
                }
                String action = Texts.trimToNull(item.getAction());
                String expected = Texts.trimToNull(item.getExpected());
                if (action == null && expected == null) {
                    continue;
                }
                if (action == null) {
                    throw AppException.badRequest("第 " + (rows.size() + 1) + " 条步骤缺少操作内容");
                }
                rows.add(new java.util.LinkedHashMap<String, String>() {{
                    put("action", action);
                    put("expected", expected);
                }});
            }
        }
        if (rows.isEmpty()) {
            return null;
        }
        try {
            return JSON.writeValueAsString(rows);
        } catch (Exception e) {
            throw AppException.badRequest("步骤内容无法保存");
        }
    }

    private List<Map<String, String>> parseSteps(String raw) {
        if (raw == null) {
            return null;
        }
        try {
            return JSON.readValue(raw, new TypeReference<List<Map<String, String>>>() {
            });
        } catch (Exception e) {
            log.warn("用例步骤 JSON 解析失败，已忽略（id={}）", raw.length() > 40 ? raw.substring(0, 40) : raw);
            return null;
        }
    }

    private String buildDefectDescription(TestCase c) {
        StringBuilder sb = new StringBuilder();
        sb.append("测试用例「").append(c.getTitle()).append("」执行失败，自动转出。\n");
        if (c.getPrecondition() != null) {
            sb.append("\n前置条件：\n").append(c.getPrecondition()).append("\n");
        }
        List<Map<String, String>> steps = parseSteps(c.getSteps());
        if (steps != null && !steps.isEmpty()) {
            sb.append("\n执行步骤：\n");
            for (int i = 0; i < steps.size(); i++) {
                Map<String, String> s = steps.get(i);
                sb.append(i + 1).append(". ").append(s.get("action"));
                if (s.get("expected") != null) {
                    sb.append("（预期：").append(s.get("expected")).append("）");
                }
                sb.append("\n");
            }
        }
        if (c.getLatestNote() != null) {
            sb.append("\n失败备注：").append(c.getLatestNote()).append("\n");
        }
        return sb.toString();
    }
}
