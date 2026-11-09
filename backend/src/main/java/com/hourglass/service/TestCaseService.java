package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.common.CaseMeta;
import com.hourglass.common.CurrentUser;
import com.hourglass.common.Ids;
import com.hourglass.common.Texts;
import com.hourglass.dto.CaseDefectRequest;
import com.hourglass.dto.CaseQuery;
import com.hourglass.dto.CaseRunRequest;
import com.hourglass.dto.CaseRunView;
import com.hourglass.dto.CaseStatsView;
import com.hourglass.dto.TaskSaveRequest;
import com.hourglass.dto.TestCasePage;
import com.hourglass.dto.TestCaseSaveRequest;
import com.hourglass.dto.TestCaseView;
import com.hourglass.entity.Attachment;
import com.hourglass.entity.Demand;
import com.hourglass.entity.Requirement;
import com.hourglass.entity.Task;
import com.hourglass.entity.TestCase;
import com.hourglass.entity.TestCaseRun;
import com.hourglass.mapper.DemandMapper;
import com.hourglass.mapper.RequirementMapper;
import com.hourglass.mapper.AttachmentMapper;
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
    private final com.hourglass.mapper.TestModuleMapper moduleMapper;
    private final AttachmentMapper attachmentMapper;
    private final AttachmentService attachmentService;
    /* 测试计划关联清理：只依赖 mapper，避免与 TestPlanService 形成循环 */
    private final com.hourglass.mapper.TestPlanMapper planMapper;
    private final com.hourglass.mapper.TestPlanCaseMapper planCaseMapper;

    public TestCaseService(TestCaseMapper caseMapper, TestCaseRunMapper runMapper,
                           TaskCommandService taskCommandService, ProjectAccessService projectAccess,
                           RequirementMapper reqMapper, DemandMapper demandMapper,
                           com.hourglass.mapper.TestModuleMapper moduleMapper,
                           AttachmentMapper attachmentMapper, AttachmentService attachmentService,
                           com.hourglass.mapper.TestPlanMapper planMapper,
                           com.hourglass.mapper.TestPlanCaseMapper planCaseMapper) {
        this.caseMapper = caseMapper;
        this.runMapper = runMapper;
        this.taskCommandService = taskCommandService;
        this.projectAccess = projectAccess;
        this.reqMapper = reqMapper;
        this.demandMapper = demandMapper;
        this.moduleMapper = moduleMapper;
        this.attachmentMapper = attachmentMapper;
        this.attachmentService = attachmentService;
        this.planMapper = planMapper;
        this.planCaseMapper = planCaseMapper;
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

    /** 分页列表：筛选/分页在 SQL，筛选下拉候选值单独查（不受筛选影响） */
    public TestCasePage page(String workspaceId, String userId, CaseQuery query) {
        String rid = ensureProject(workspaceId, query.getReqId());
        projectAccess.assertView(workspaceId, userId, rid);
        query.setWorkspaceId(workspaceId);
        query.setReqId(rid);
        query.setQ(Texts.trimToNull(query.getQ()));
        query.setModule(Texts.trimToNull(query.getModule()));
        query.setPri(Texts.trimToNull(query.getPri()));
        query.setOwner(Texts.trimToNull(query.getOwner()));
        query.setOffset(Math.max(0, query.getOffset()));
        query.setLimit(Math.max(1, Math.min(100, query.getLimit())));

        int total = caseMapper.countByQuery(query);
        List<TestCaseView> rows = total <= query.getOffset()
                ? new ArrayList<TestCaseView>()
                : caseMapper.selectViewByQuery(query);
        for (TestCaseView v : rows) {
            v.setSteps(parseSteps(v.getStepsJson()));
            v.setStepsJson(null);
        }

        TestCasePage page = new TestCasePage();
        page.setTotal(total);
        page.setOffset(query.getOffset());
        page.setLimit(query.getLimit());
        page.setHasMore(query.getOffset() + rows.size() < total);
        page.setItems(rows);
        java.util.List<String> modules = new ArrayList<String>(caseMapper.selectModules(workspaceId, rid));
        for (String m : moduleMapper.selectNames(workspaceId, rid)) {
            if (!modules.contains(m)) {
                modules.add(m);
            }
        }
        java.util.Collections.sort(modules);
        page.setModules(modules);
        page.setOwners(caseMapper.selectOwners(workspaceId, rid));
        return page;
    }

    /** 需求—用例—缺陷覆盖矩阵：需求池需求逐行，未关联需求的用例单独补一行。 */
    public java.util.List<com.hourglass.dto.CaseCoverageRow> coverage(String workspaceId, String userId, String reqId) {
        String rid = ensureProject(workspaceId, reqId);
        projectAccess.assertView(workspaceId, userId, rid);
        java.util.List<com.hourglass.dto.CaseCoverageRow> rows =
                new ArrayList<com.hourglass.dto.CaseCoverageRow>(caseMapper.selectCoverageByDemand(workspaceId, rid));
        com.hourglass.dto.CaseCoverageRow unlinked = caseMapper.selectUnlinkedCoverage(workspaceId, rid);
        if (unlinked != null && unlinked.getCaseTotal() != null && unlinked.getCaseTotal() > 0) {
            unlinked.setDemandTitle("未关联需求");
            unlinked.setDemandStatus("");
            rows.add(unlinked);
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

    /** 执行历史（最近在前）：每轮带失败证据附件，供详情与测试报告追溯 */
    public com.hourglass.dto.PageResult<CaseRunView> runs(
            String workspaceId, String userId, String caseId, int offset, int limit) {
        TestCase c = get(workspaceId, caseId);
        projectAccess.assertView(workspaceId, userId, c.getReqId());
        int safeOffset = Math.max(0, offset);
        int safeLimit = Math.max(1, Math.min(100, limit));
        int total = runMapper.countByCase(workspaceId, caseId);
        List<TestCaseRun> rows = total <= safeOffset ? new ArrayList<TestCaseRun>()
                : runMapper.selectByCase(workspaceId, caseId, safeOffset, safeLimit);
        List<CaseRunView> out = new ArrayList<CaseRunView>();
        if (rows.isEmpty()) {
            return com.hourglass.dto.PageResult.of(out, total, safeOffset, safeLimit);
        }
        List<String> ids = new ArrayList<String>();
        for (TestCaseRun r : rows) {
            ids.add(r.getId());
        }
        java.util.Map<String, List<Attachment>> byTarget =
                new java.util.HashMap<String, List<Attachment>>();
        for (Attachment a : attachmentMapper.selectByTargets(workspaceId,
                AttachmentService.KIND_CASE_RUN, ids)) {
            List<Attachment> bucket = byTarget.get(a.getTargetId());
            if (bucket == null) {
                bucket = new ArrayList<Attachment>();
                byTarget.put(a.getTargetId(), bucket);
            }
            bucket.add(a);
        }
        for (TestCaseRun r : rows) {
            CaseRunView v = new CaseRunView();
            v.setId(r.getId());
            v.setStatus(r.getStatus());
            v.setNote(r.getNote());
            v.setBugTaskId(r.getBugTaskId());
            v.setExecutedBy(r.getExecutedBy());
            v.setCreatedAt(r.getCreatedAt());
            List<Attachment> atts = byTarget.get(r.getId());
            v.setAttachments(atts == null ? new ArrayList<Attachment>() : atts);
            out.add(v);
        }
        return com.hourglass.dto.PageResult.of(out, total, safeOffset, safeLimit);
    }

    /** 失败证据上传：附件挂在本轮执行记录下，删除流水时一并清理 */
    @Transactional
    public Attachment uploadEvidence(String userId, String workspaceId, String caseId,
                                     String runId, org.springframework.web.multipart.MultipartFile file) {
        TestCase c = get(workspaceId, caseId);
        projectAccess.assertWrite(workspaceId, userId, c.getReqId());
        TestCaseRun run = runMapper.selectById(runId);
        if (run == null || !workspaceId.equals(run.getWorkspaceId())
                || !caseId.equals(run.getCaseId())) {
            throw AppException.notFound("执行记录不存在：" + runId);
        }
        return attachmentService.upload(userId, workspaceId, runId,
                AttachmentService.KIND_CASE_RUN, file);
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
        /* 用例被删后测试计划里的圈选行也成孤儿，一并摘除 */
        planCaseMapper.deleteByCase(id);
        caseMapper.delete(workspaceId, id);
        attachmentService.deleteOrphanCaseRunAttachments(workspaceId);
    }

    /** 记录一次执行：流水追加一行，最近一轮结果冗余回用例；返回流水 id 供上传失败证据 */
    @Transactional
    public TestCaseRun run(String userId, String workspaceId, String id, CaseRunRequest req) {
        return run(userId, workspaceId, id, req, null);
    }

    /** 记录一次执行结果；planId 非空表示由测试计划批量执行发起（流水带计划归属，便于回溯） */
    @Transactional
    public TestCaseRun run(String userId, String workspaceId, String id, CaseRunRequest req, String planId) {
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
        run.setPlanId(Texts.trimToNull(planId));
        run.setExecutedBy(displayName);
        run.setExecutedByUserId(userId);
        runMapper.insert(run);
        caseMapper.updateLatest(workspaceId, id, req.getStatus(), note, displayName, userId);
        return runMapper.selectById(run.getId());
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
        /* 任务标题/描述上限（60/2000）比用例口径窄：自动转出时截断，完整信息留在用例本体 */
        tReq.setTitle(Texts.cut(c.getTitle(), 60));
        tReq.setItemType("bug");
        tReq.setSeverity(req.getSeverity());
        tReq.setEnvironment(Texts.trimToNull(req.getEnvironment()));
        tReq.setReqId(c.getReqId());
        /* 用例关联了需求时，缺陷任务沿用该关联，保持追溯链一致 */
        tReq.setDemandId(c.getDemandId());
        tReq.setDescription(Texts.cut(buildDefectDescription(c), 2000));
        Task task = taskCommandService.create(userId, workspaceId, tReq);
        caseMapper.updateLatestBug(workspaceId, id, task.getId());
        TestCaseRun latest = runMapper.selectLatestByCase(id);
        if (latest != null && CaseMeta.STATUS_FAILED.equals(latest.getStatus())) {
            runMapper.updateBugTask(latest.getId(), task.getId());
        }
        return task;
    }

    /** 项目内用例总数（删除影响预览用，不做权限校验：调用方已 assert） */
    public int countByReq(String workspaceId, String reqId) {
        return caseMapper.countByReq(workspaceId, reqId);
    }

    /** 项目删除级联：清理用例、执行流水与测试计划，返回被删用例数（确认提示用） */
    @Transactional
    public int deleteByReq(String workspaceId, String reqId) {
        int count = caseMapper.countByReq(workspaceId, reqId);
        if (count > 0) {
            runMapper.deleteByReq(workspaceId, reqId);
            caseMapper.deleteByReq(workspaceId, reqId);
            attachmentService.deleteOrphanCaseRunAttachments(workspaceId);
        }
        /* 测试计划强归属项目：先清圈选关系再删计划本体，避免残留孤儿 */
        planCaseMapper.deleteByReq(workspaceId, reqId);
        planMapper.deleteByReq(workspaceId, reqId);
        moduleMapper.deleteByReq(workspaceId, reqId);
        return count;
    }

    /* ---------- CSV 导入导出（A3：存量测试资产迁移入口） ---------- */

    private static final String CSV_HEADER = "标题,模块,优先级,前置条件,步骤（每行：操作 => 预期）";
    private static final int IMPORT_MAX_ROWS = 1000;

    /** 模板：表头 + 一行示例（示例行导入前请删除或直接当第一条用例改） */
    public byte[] templateCsv() {
        List<String> lines = new ArrayList<String>();
        lines.add(CSV_HEADER);
        lines.add(com.hourglass.common.Csv.row("登录成功跳转首页", "账号体系", "P0", "已注册账号 demo/123456",
                "打开登录页 => 出现用户名/密码输入框\n输入正确账号密码并提交 => 3 秒内进入首页且右上角显示昵称"));
        return com.hourglass.common.Csv.toCsv(lines);
    }

    /** 导出项目全部用例（口径同列表页：创建时间倒序） */
    public byte[] exportCsv(String workspaceId, String userId, String reqId) {
        String rid = ensureProject(workspaceId, reqId);
        projectAccess.assertView(workspaceId, userId, rid);
        List<TestCaseView> rows = caseMapper.selectViewByReq(workspaceId, rid);
        List<String> lines = new ArrayList<String>();
        lines.add(CSV_HEADER);
        for (TestCaseView v : rows) {
            StringBuilder steps = new StringBuilder();
            List<Map<String, String>> parsed = parseSteps(v.getStepsJson());
            if (parsed != null) {
                for (Map<String, String> s : parsed) {
                    if (steps.length() > 0) {
                        steps.append('\n');
                    }
                    steps.append(s.get("action") == null ? "" : s.get("action"));
                    if (s.get("expected") != null && !s.get("expected").isEmpty()) {
                        steps.append(" => ").append(s.get("expected"));
                    }
                }
            }
            lines.add(com.hourglass.common.Csv.row(v.getTitle(), v.getModule(), v.getPriority(),
                    v.getPrecondition(), steps.toString()));
        }
        return com.hourglass.common.Csv.toCsv(lines);
    }

    /**
     * 导入用例：逐行校验并创建，单行失败不影响其余行；返回
     * {total, created, failed, errors:[{row, message}]}（errors 最多 20 条）。
     * 步骤列按换行分步，"操作 => 预期" 中预期可省略。
     */
    @Transactional
    public Map<String, Object> importCsv(String userId, String workspaceId, String reqId, String text) {
        String rid = ensureProject(workspaceId, reqId);
        projectAccess.assertWrite(workspaceId, userId, rid);
        List<List<String>> rows = com.hourglass.common.Csv.parse(text == null ? "" : text);
        Map<String, Object> out = new java.util.LinkedHashMap<String, Object>();
        List<Map<String, Object>> errors = new ArrayList<Map<String, Object>>();
        int created = 0;
        int start = 0;
        if (!rows.isEmpty()) {
            String head = rows.get(0).isEmpty() ? "" : rows.get(0).get(0).trim();
            if ("标题".equals(head) || "title".equalsIgnoreCase(head)) {
                start = 1; // 表头行
            }
        }
        int dataRows = rows.size() - start;
        if (dataRows > IMPORT_MAX_ROWS) {
            throw AppException.badRequest("单次最多导入 " + IMPORT_MAX_ROWS + " 行（当前 " + dataRows + " 行），请拆分文件");
        }
        for (int i = start; i < rows.size(); i++) {
            List<String> r = rows.get(i);
            String title = cell(r, 0);
            if (title == null) {
                continue; // 空行跳过
            }
            try {
                TestCaseSaveRequest req = new TestCaseSaveRequest();
                req.setReqId(rid);
                req.setTitle(title);
                req.setModule(cell(r, 1));
                String pri = cell(r, 2);
                if (pri != null) {
                    String up = pri.toUpperCase();
                    if (!up.matches("^P[0-3]$")) {
                        throw AppException.badRequest("优先级只允许 P0/P1/P2/P3：" + pri);
                    }
                    req.setPriority(up);
                }
                req.setPrecondition(cell(r, 3));
                req.setSteps(parseStepsCell(cell(r, 4)));
                create(userId, workspaceId, req);
                created++;
            } catch (AppException ex) {
                if (errors.size() < 20) {
                    Map<String, Object> e = new java.util.LinkedHashMap<String, Object>();
                    e.put("row", i + 1);
                    e.put("message", ex.getMessage());
                    errors.add(e);
                }
            }
        }
        out.put("total", dataRows);
        out.put("created", created);
        out.put("failed", errors.size());
        out.put("errors", errors);
        out.put("skipped", Math.max(0, dataRows - created - errors.size()));
        return out;
    }

    private static String cell(List<String> row, int idx) {
        if (row == null || idx >= row.size()) {
            return null;
        }
        return Texts.trimToNull(row.get(idx));
    }

    /** 步骤列 → StepItem 列表：按换行分步，"操作 => 预期"；超过 30 步截断并报错 */
    private List<TestCaseSaveRequest.StepItem> parseStepsCell(String raw) {
        if (raw == null) {
            return null;
        }
        List<TestCaseSaveRequest.StepItem> items = new ArrayList<TestCaseSaveRequest.StepItem>();
        for (String line : raw.split("\r?\n")) {
            String s = line.trim();
            if (s.isEmpty()) {
                continue;
            }
            TestCaseSaveRequest.StepItem item = new TestCaseSaveRequest.StepItem();
            int sep = s.indexOf("=>");
            if (sep < 0) {
                item.setAction(Texts.cut(s, 200));
            } else {
                item.setAction(Texts.cut(s.substring(0, sep).trim(), 200));
                String expected = Texts.trimToNull(s.substring(sep + 2));
                if (expected != null) {
                    item.setExpected(Texts.cut(expected, 500));
                }
            }
            items.add(item);
        }
        if (items.isEmpty()) {
            return null;
        }
        if (items.size() > 30) {
            throw AppException.badRequest("单条用例步骤最多 30 条（当前 " + items.size() + " 条）");
        }
        return items;
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
