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
import com.hourglass.mapper.TestCaseTaskMapper;
import com.hourglass.mapper.TaskMapper;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.LinkedHashMap;
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
    /** 用例删除会连带执行流水，批量导入会一次性写入大量数据：都属于需可追责的动作 */
    private final AuditService auditService;
    private final NumberSeqService numberSeq;
    /** 用例 ↔ 工作项多对多：验证链路的核心关联 */
    private final TestCaseTaskMapper caseTaskMapper;
    private final TaskMapper taskMapper;

    public TestCaseService(TestCaseMapper caseMapper, TestCaseRunMapper runMapper,
                           TaskCommandService taskCommandService, ProjectAccessService projectAccess,
                           RequirementMapper reqMapper, DemandMapper demandMapper,
                           com.hourglass.mapper.TestModuleMapper moduleMapper,
                           AttachmentMapper attachmentMapper, AttachmentService attachmentService,
                           com.hourglass.mapper.TestPlanMapper planMapper,
                           com.hourglass.mapper.TestPlanCaseMapper planCaseMapper,
                           AuditService auditService, NumberSeqService numberSeq,
                           TestCaseTaskMapper caseTaskMapper, TaskMapper taskMapper) {
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
        this.auditService = auditService;
        this.numberSeq = numberSeq;
        this.caseTaskMapper = caseTaskMapper;
        this.taskMapper = taskMapper;
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
        attachTaskLinks(workspaceId, rows);
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
        attachTaskLinks(workspaceId, rows);

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
        page.setModuleCounts(facetCounts(caseMapper.countFacetsByModule(workspaceId, rid)));
        page.setPriorityCounts(facetCounts(caseMapper.countFacetsByPriority(workspaceId, rid)));
        page.setOwnerCounts(facetCounts(caseMapper.countFacetsByOwner(workspaceId, rid)));
        Map<String, Integer> statusCounts = new LinkedHashMap<String, Integer>();
        int executed = 0;
        for (Map<String, Object> row : caseMapper.countGroupByStatus(workspaceId, rid)) {
            String status = String.valueOf(row.get("status"));
            int cnt = ((Number) row.get("cnt")).intValue();
            statusCounts.put(status, cnt);
            executed += cnt;
        }
        int all = caseMapper.countByReq(workspaceId, rid);
        statusCounts.put("__untested", Math.max(0, all - executed));
        statusCounts.put("__all", all);
        page.setStatusCounts(statusCounts);
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

    /**
     * 用例编辑器的工作项候选：只返回本例主需求下的工作项。
     * 没有主需求时返回空列表——先选需求，再选需求下的工作项。
     */
    public List<com.hourglass.dto.CaseTaskLink> taskOptions(String workspaceId, String userId,
                                                            String reqId, String demandId, String q) {
        String rid = ensureProject(workspaceId, reqId);
        projectAccess.assertView(workspaceId, userId, rid);
        String did = Texts.trimToNull(demandId);
        if (did == null) {
            return new ArrayList<com.hourglass.dto.CaseTaskLink>();
        }
        requireDemandInProject(workspaceId, rid, did);
        String key = Texts.trimToNull(q);
        if (key != null && key.matches("(?i)^WI-?\\d+$")) {
            key = key.replaceAll("(?i)^WI-?0*", "");
            if (key.isEmpty()) {
                key = "0";
            }
        }
        Integer itemNo = key != null && key.matches("^\\d{1,9}$") ? Integer.valueOf(key) : null;
        return caseTaskMapper.selectOptions(workspaceId, rid, did,
                key == null ? null : Texts.cut(key, 50), itemNo, 200);
    }

    /** 需求详情的工作项级覆盖：每项工作项被多少条用例验证、结果分布。 */
    public List<com.hourglass.dto.TaskCoverageRow> taskCoverage(String workspaceId, String userId, String demandId) {
        String did = Texts.trimToNull(demandId);
        if (did == null) {
            throw AppException.badRequest("请选择需求");
        }
        Demand d = demandMapper.selectById(did);
        if (d == null || !workspaceId.equals(d.getWorkspaceId())) {
            throw AppException.notFound("需求不存在：" + did);
        }
        projectAccess.assertView(workspaceId, userId, d.getReqId());
        return caseTaskMapper.selectCoverageByDemand(workspaceId, did);
    }

    /** 空字符串统一映射为 __none，供前端「未指定模块 / 未设置 / 未执行」计数使用 */
    private static Map<String, Integer> facetCounts(List<Map<String, Object>> rows) {
        Map<String, Integer> counts = new LinkedHashMap<String, Integer>();
        if (rows == null) {
            return counts;
        }
        for (Map<String, Object> row : rows) {
            String key = String.valueOf(row.get("k"));
            if (key == null || "null".equals(key) || key.isEmpty()) {
                key = "__none";
            }
            counts.put(key, ((Number) row.get("cnt")).intValue());
        }
        return counts;
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
            } else if (CaseMeta.STATUS_SKIPPED.equals(status)) {
                s.setSkipped(cnt);
            }
        }
        s.setUntested(s.getTotal() - s.getPassed() - s.getFailed() - s.getBlocked() - s.getSkipped());
        return s;
    }

    /** 缺陷反查用例：执行流水记录过的 bug → 用例，缺陷 tab 展示来源用例 */
    public List<com.hourglass.dto.CaseBugLink> linkedBugs(String workspaceId, String userId, String reqId) {
        String rid = ensureProject(workspaceId, reqId);
        projectAccess.assertView(workspaceId, userId, rid);
        return runMapper.selectBugCaseLinks(workspaceId, rid);
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
        insertWithNo(c);
        syncTaskLinks(userId, c, req.getTaskIds());
        auditService.recordCurrent(workspaceId, "test_case_create", "test_case", c.getId(), c.getTitle(), true,
                "新建测试用例「" + caseNoText(c) + " " + c.getTitle() + "」", null);
        return caseMapper.selectById(c.getId());
    }

    /**
     * 分配项目内编号后插入。并发建用例会抢到同一个号，由唯一键 uk_case_no 拒绝，
     * 这里重算重试；失败的 INSERT 不会让 InnoDB 事务失效。
     * 取号走 number_seq（sql/87）：删除用例不回收编号。
     */
    private void insertWithNo(TestCase c) {
        for (int attempt = 0; attempt < 3; attempt++) {
            c.setCaseNo(numberSeq.nextCase(c.getWorkspaceId(), c.getReqId()));
            try {
                caseMapper.insert(c);
                return;
            } catch (org.springframework.dao.DuplicateKeyException e) {
                log.warn("用例编号并发冲突，重试第 {} 次：project={}", attempt + 2, c.getReqId());
            }
        }
        throw AppException.badRequest("用例编号生成冲突，请重试");
    }

    /** 换项目：编号是当前项目内的序号，过去后重新取号，避免与目标项目已有编号撞唯一键 */
    private void updateMovedWithNo(TestCase c) {
        for (int attempt = 0; attempt < 3; attempt++) {
            c.setCaseNo(numberSeq.nextCase(c.getWorkspaceId(), c.getReqId()));
            try {
                caseMapper.update(c);
                return;
            } catch (org.springframework.dao.DuplicateKeyException e) {
                log.warn("用例换项目编号冲突，重试第 {} 次：project={}", attempt + 2, c.getReqId());
            }
        }
        throw AppException.badRequest("用例编号生成冲突，请重试");
    }

    @Transactional
    public TestCase update(String userId, String workspaceId, String id, TestCaseSaveRequest req) {
        TestCase c = get(workspaceId, id);
        projectAccess.assertWrite(workspaceId, userId, c.getReqId());
        String reqId = ensureProject(workspaceId, req.getReqId());
        projectAccess.assertWrite(workspaceId, userId, reqId);
        boolean moved = !reqId.equals(c.getReqId());
        String oldReqId = c.getReqId();
        String oldTitle = c.getTitle();
        String oldDemandId = c.getDemandId();
        if (moved) {
            /* 计划只圈选本项目用例：改项目会让原项目计划里留下跨项目行（已完成计划是快照，不受限） */
            List<String> open = planCaseMapper.selectOpenPlanNamesByCase(workspaceId, id);
            if (open != null && !open.isEmpty()) {
                throw AppException.badRequest("用例仍在测试计划「" + open.get(0) + "」"
                        + (open.size() > 1 ? "等 " + open.size() + " 个计划" : "") + "中，请先移出再改所属项目");
            }
        }
        apply(c, reqId, req);
        if (moved) {
            updateMovedWithNo(c);
        } else {
            caseMapper.update(c);
        }
        boolean demandChanged = !java.util.Objects.equals(oldDemandId, c.getDemandId());
        /* taskIds=null 表示旧客户端没带该字段：保持原关联；主需求换了则必须重算，避免跨需求残留 */
        if (req.getTaskIds() != null || demandChanged) {
            syncTaskLinks(userId, c, req.getTaskIds() == null
                    ? new ArrayList<String>() : req.getTaskIds());
        }
        StringBuilder what = new StringBuilder("编辑测试用例「").append(caseNoText(c)).append(" ")
                .append(c.getTitle()).append("」");
        if (!java.util.Objects.equals(oldTitle, c.getTitle())) {
            what.append("，标题由「").append(oldTitle).append("」修改");
        }
        if (moved) {
            what.append("，所属项目由「").append(projectName(workspaceId, oldReqId))
                    .append("」改为「").append(projectName(workspaceId, reqId)).append("」（编号重取）");
        }
        if (demandChanged) {
            what.append(oldDemandId == null ? "，补充主需求" : (c.getDemandId() == null ? "，解除主需求" : "，更换主需求"));
        }
        auditService.recordCurrent(workspaceId, "test_case_update", "test_case", id, c.getTitle(), true,
                what.toString(), null);
        return caseMapper.selectById(id);
    }

    private String caseNoText(TestCase c) {
        int n = c.getCaseNo() == null ? 0 : c.getCaseNo();
        if (n <= 0) {
            return "";
        }
        StringBuilder s = new StringBuilder(String.valueOf(n));
        while (s.length() < 3) {
            s.insert(0, "0");
        }
        return "TC-" + s;
    }

    private String projectName(String workspaceId, String reqId) {
        com.hourglass.entity.Requirement r = reqId == null ? null : reqMapper.selectById(reqId);
        return r == null ? String.valueOf(reqId) : r.getName();
    }

    /**
     * 保存用例—工作项关联：整体替换。校验每个工作项都属于用例主需求，
     * 未选主需求时不允许挂工作项（否则追溯链没有共同的归口）。
     */
    private void syncTaskLinks(String userId, TestCase c, List<String> rawTaskIds) {
        List<String> taskIds = distinctTaskIds(rawTaskIds);
        if (!taskIds.isEmpty() && c.getDemandId() == null) {
            throw AppException.badRequest("请先关联主需求，再选择该需求下的工作项");
        }
        for (String taskId : taskIds) {
            Task t = taskMapper.selectById(taskId);
            if (t == null || !c.getWorkspaceId().equals(t.getWorkspaceId()) || t.getDeletedAt() != null) {
                throw AppException.badRequest("工作项不存在或已删除：" + taskId);
            }
            if (!c.getReqId().equals(t.getReqId())) {
                throw AppException.badRequest("工作项不属于用例所在项目：" + t.getTitle());
            }
            if (!c.getDemandId().equals(t.getDemandId())) {
                throw AppException.badRequest("工作项「" + Texts.cut(t.getTitle(), 30)
                        + "」不属于用例主需求，请先调整主需求或改选工作项");
            }
        }
        caseTaskMapper.deleteByCase(c.getId());
        for (String taskId : taskIds) {
            com.hourglass.entity.TestCaseTask link = new com.hourglass.entity.TestCaseTask();
            link.setId(Ids.gen("CT"));
            link.setWorkspaceId(c.getWorkspaceId());
            link.setCaseId(c.getId());
            link.setTaskId(taskId);
            link.setCreatedBy(userId);
            caseTaskMapper.insert(link);
        }
    }

    private static List<String> distinctTaskIds(List<String> raw) {
        List<String> out = new ArrayList<String>();
        if (raw == null) {
            return out;
        }
        java.util.Set<String> seen = new java.util.HashSet<String>();
        for (String id : raw) {
            String s = Texts.trimToNull(id);
            if (s != null && seen.add(s)) {
                out.add(s);
            }
        }
        if (out.size() > 100) {
            throw AppException.badRequest("单条用例最多关联 100 个工作项");
        }
        return out;
    }

    /** 列表页批量挂载工作项，避免逐行查询；没有关联的用例下发空数组而不是 null。 */
    private void attachTaskLinks(String workspaceId, List<TestCaseView> rows) {
        if (rows == null || rows.isEmpty()) {
            return;
        }
        List<String> ids = new ArrayList<String>(rows.size());
        for (TestCaseView v : rows) {
            ids.add(v.getId());
        }
        Map<String, List<com.hourglass.dto.CaseTaskLink>> byCase =
                new java.util.HashMap<String, List<com.hourglass.dto.CaseTaskLink>>();
        for (com.hourglass.dto.CaseTaskLink link : caseTaskMapper.selectByCaseIds(workspaceId, ids)) {
            List<com.hourglass.dto.CaseTaskLink> bucket = byCase.get(link.getCaseId());
            if (bucket == null) {
                bucket = new ArrayList<com.hourglass.dto.CaseTaskLink>();
                byCase.put(link.getCaseId(), bucket);
            }
            bucket.add(link);
        }
        for (TestCaseView v : rows) {
            List<com.hourglass.dto.CaseTaskLink> links = byCase.get(v.getId());
            v.setTasks(links == null ? new ArrayList<com.hourglass.dto.CaseTaskLink>() : links);
        }
    }

    @Transactional
    public void delete(String userId, String workspaceId, String id) {
        TestCase c = get(workspaceId, id);
        projectAccess.assertWrite(workspaceId, userId, c.getReqId());
        runMapper.deleteByCase(workspaceId, id);
        /* 用例被删后测试计划里的圈选行也成孤儿，一并摘除 */
        planCaseMapper.deleteByCase(id);
        caseTaskMapper.deleteByCase(id);
        caseMapper.delete(workspaceId, id);
        attachmentService.deleteOrphanCaseRunAttachments(workspaceId);
        auditService.recordCurrent(workspaceId, "test_case_delete", "test_case", id, c.getTitle(), true,
                "删除测试用例「" + c.getTitle() + "」，执行流水与计划圈选一并清理", null);
    }

    /* ---------- 批量维护（列表多选） ---------- */

    /** 批量改模块 / 优先级：跨项目勾选时逐个校验写权限，已删除的行跳过并回报 */
    @Transactional
    public Map<String, Object> batchUpdate(String userId, String workspaceId, com.hourglass.dto.TestCaseBatchRequest req) {
        List<String> ids = distinctIds(req.getIds());
        String moduleAction = Texts.trimToNull(req.getModuleAction());
        String priorityAction = Texts.trimToNull(req.getPriorityAction());
        boolean moduleClear = "clear".equals(moduleAction);
        boolean moduleSet = "set".equals(moduleAction);
        boolean priorityClear = "clear".equals(priorityAction);
        boolean prioritySet = "set".equals(priorityAction);
        if (!moduleSet && !moduleClear && !prioritySet && !priorityClear) {
            throw AppException.badRequest("没有要修改的内容");
        }
        String module = null;
        if (moduleSet) {
            module = Texts.trimToNull(req.getModule());
            if (module == null) {
                throw AppException.badRequest("请填写功能模块，或勾选「清空模块」");
            }
            module = Texts.cut(module, 50);
        }
        String priority = null;
        if (prioritySet) {
            priority = Texts.trimToNull(req.getPriority());
            if (priority == null || !priority.matches("P[0-3]")) {
                throw AppException.badRequest("优先级只允许 P0/P1/P2/P3");
            }
        }
        List<String> allowed = new ArrayList<String>();
        int skipped = 0;
        for (String id : ids) {
            TestCase c = caseMapper.selectById(id);
            if (c == null || !workspaceId.equals(c.getWorkspaceId())) {
                skipped++;
                continue;
            }
            projectAccess.assertWrite(workspaceId, userId, c.getReqId());
            allowed.add(id);
        }
        if (allowed.isEmpty()) {
            throw AppException.badRequest("勾选的用例已不存在或无权修改");
        }
        int updated = caseMapper.batchUpdate(workspaceId, allowed,
                moduleSet || moduleClear, module, prioritySet || priorityClear, priority);
        StringBuilder what = new StringBuilder();
        if (moduleSet) {
            what.append("模块=「").append(module).append("」");
        }
        if (moduleClear) {
            what.append(what.length() > 0 ? "、" : "").append("清空模块");
        }
        if (prioritySet) {
            what.append(what.length() > 0 ? "、" : "").append("优先级=").append(priority);
        }
        if (priorityClear) {
            what.append(what.length() > 0 ? "、" : "").append("清空优先级");
        }
        auditService.recordCurrent(workspaceId, "test_case_batch_update", "project", null, null, true,
                "批量更新 " + updated + " 条用例：" + what, null);
        Map<String, Object> out = new java.util.LinkedHashMap<String, Object>();
        out.put("updated", updated);
        out.put("skipped", skipped);
        return out;
    }

    /** 批量删除：逐条走单例删除链路（流水、计划圈选、证据一并清理并逐条留痕） */
    @Transactional
    public Map<String, Object> batchDelete(String userId, String workspaceId, List<String> rawIds) {
        List<String> ids = distinctIds(rawIds);
        int deleted = 0;
        int skipped = 0;
        for (String id : ids) {
            TestCase c = caseMapper.selectById(id);
            if (c == null || !workspaceId.equals(c.getWorkspaceId())) {
                skipped++;
                continue;
            }
            projectAccess.assertWrite(workspaceId, userId, c.getReqId());
            delete(userId, workspaceId, id);
            deleted++;
        }
        if (deleted == 0) {
            throw AppException.badRequest("勾选的用例已不存在或无权删除");
        }
        Map<String, Object> out = new java.util.LinkedHashMap<String, Object>();
        out.put("deleted", deleted);
        out.put("skipped", skipped);
        return out;
    }

    private static List<String> distinctIds(List<String> raw) {
        List<String> out = new ArrayList<String>();
        if (raw == null) {
            return out;
        }
        java.util.Set<String> seen = new java.util.HashSet<String>();
        for (String id : raw) {
            String s = Texts.trimToNull(id);
            if (s != null && seen.add(s)) {
                out.add(s);
            }
        }
        if (out.size() > 200) {
            throw AppException.badRequest("单次最多勾选 200 条用例");
        }
        return out;
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
            caseTaskMapper.deleteByReq(workspaceId, reqId);
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

    private static final String CSV_HEADER = "用例编号,标题,模块,优先级,前置条件,测试数据,步骤（每行：操作 => 预期）";
    private static final int IMPORT_MAX_ROWS = 1000;

    /** 模板：表头 + 一行示例（示例行导入前请删除或直接当第一条用例改） */
    public byte[] templateCsv() {
        List<String> lines = new ArrayList<String>();
        lines.add(CSV_HEADER);
        lines.add(com.hourglass.common.Csv.row("", "登录成功跳转首页", "账号体系", "P0", "已注册账号 demo/123456",
                "账号：demo / 密码：123456",
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
            lines.add(com.hourglass.common.Csv.row(caseNoLabel(v.getCaseNo()), v.getTitle(), v.getModule(),
                    v.getPriority(), v.getPrecondition(), v.getTestData(), steps.toString()));
        }
        return com.hourglass.common.Csv.toCsv(lines);
    }

    /**
     * 导入用例：逐行校验并创建，单行失败不影响其余行；返回
     * {total, created, failed, errors:[{row, message}], ignored:[列名]}（errors 最多 20 条）。
     *
     * 两种格式都接受：
     * 1) 表头驱动：按列名识别（标题/用例名称、模块/需求对应、优先级、前置条件、
     *    测试步骤、期望结果），外部 Excel 另存 CSV 后可直接导入；
     *    步骤与期望分两列时按行号一一配对，行首"1."等编号自动去掉。
     * 2) 无表头：沿用旧位置口径（标题, 模块, 优先级, 前置条件, 步骤），
     *    步骤列按换行分步、"操作 => 预期"。
     * 执行结果、截图、缺陷等列无法还原成执行流水，明确忽略并在结果里回报。
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
        Map<String, Integer> cols = new java.util.HashMap<String, Integer>();
        if (!rows.isEmpty()) {
            cols = mapHeader(rows.get(0));
        }
        boolean headerMode = cols.containsKey("title");
        if (headerMode) {
            start = 1; // 表头行
        }
        int dataRows = rows.size() - start;
        if (dataRows > IMPORT_MAX_ROWS) {
            throw AppException.badRequest("单次最多导入 " + IMPORT_MAX_ROWS + " 行（当前 " + dataRows + " 行），请拆分文件");
        }
        for (int i = start; i < rows.size(); i++) {
            List<String> r = rows.get(i);
            String title = headerMode ? cell(r, cols.get("title")) : cell(r, 0);
            if (title == null) {
                continue; // 空行跳过
            }
            try {
                TestCaseSaveRequest req = new TestCaseSaveRequest();
                req.setReqId(rid);
                req.setTitle(title);
                if (headerMode) {
                    if (cols.containsKey("module")) {
                        req.setModule(cell(r, cols.get("module")));
                    }
                    applyPriority(req, cell(r, cols.get("priority")));
                    if (cols.containsKey("precondition")) {
                        req.setPrecondition(cell(r, cols.get("precondition")));
                    }
                    if (cols.containsKey("data")) {
                        req.setTestData(cell(r, cols.get("data")));
                    }
                    String stepCell = cols.containsKey("steps") ? cell(r, cols.get("steps")) : null;
                    String expectedCell = cols.containsKey("expected") ? cell(r, cols.get("expected")) : null;
                    if (expectedCell != null) {
                        req.setSteps(pairSteps(stepCell, expectedCell));
                    } else if (stepCell != null) {
                        req.setSteps(parseStepsCell(stepCell));
                    }
                } else {
                    req.setModule(cell(r, 1));
                    applyPriority(req, cell(r, 2));
                    req.setPrecondition(cell(r, 3));
                    req.setSteps(parseStepsCell(cell(r, 4)));
                }
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
        out.put("headerMode", headerMode);
        out.put("renumbered", headerMode && cols.containsKey("no"));
        out.put("ignored", headerMode ? ignoredColumns(rows.get(0)) : new ArrayList<String>());
        int skipped = Math.max(0, dataRows - created - errors.size());
        out.put("skipped", skipped);
        /* 一条都没导入且存在错误时，审计结果记为失败，便于按结果筛选问题导入 */
        auditService.recordCurrent(workspaceId, "test_case_import", "project", rid, null,
                created > 0 || errors.isEmpty(), "导入测试用例：成功 " + created + " 条，失败 "
                        + errors.size() + " 条，跳过 " + skipped + " 条", null);
        return out;
    }

    /** 列名 → 语义键；未知列返回 null，调用方只取认识的列 */
    private static Map<String, Integer> mapHeader(List<String> header) {
        Map<String, Integer> map = new java.util.HashMap<String, Integer>();
        if (header == null) {
            return map;
        }
        for (int i = 0; i < header.size(); i++) {
            String kind = headerKind(header.get(i));
            if (kind != null && !map.containsKey(kind)) {
                map.put(kind, i);
            }
        }
        return map;
    }

    private static String headerKind(String raw) {
        if (raw == null) {
            return null;
        }
        String s = raw.trim().replace(" ", "").replace("\u3000", "")
                .replace("（", "(").replace("）", ")").replace("：", ":").toLowerCase();
        if (s.isEmpty()) {
            return null;
        }
        if ("编号".equals(s) || "用例编号".equals(s) || "用例id".equals(s)
                || "测试用例id".equals(s) || "id".equals(s)) {
            return "no";
        }
        if ("标题".equals(s) || "用例标题".equals(s) || "用例名称".equals(s)
                || "名称".equals(s) || "title".equals(s) || "name".equals(s)) {
            return "title";
        }
        if (s.contains("模块") || s.contains("需求对应")) {
            return "module";
        }
        if (s.contains("优先级") || "级别".equals(s) || "pri".equals(s) || "priority".equals(s)) {
            return "priority";
        }
        if (s.contains("前置") || s.contains("前提") || s.contains("预置")) {
            return "precondition";
        }
        if (s.contains("测试数据") || "数据".equals(s)) {
            return "data";
        }
        if (s.contains("步骤")) {
            return "steps";
        }
        if (s.contains("期望") || s.contains("预期")) {
            return "expected";
        }
        return null;
    }

    /** 引用了但无法落库的列：执行结果、截图、缺陷、执行人/时间 */
    private static List<String> ignoredColumns(List<String> header) {
        List<String> out = new ArrayList<String>();
        if (header == null) {
            return out;
        }
        for (String h : header) {
            if (h == null) {
                continue;
            }
            String s = h.trim();
            if (s.isEmpty()) {
                continue;
            }
            boolean ignore = s.contains("测试结果") || s.contains("截图") || s.contains("缺陷")
                    || s.contains("测试人员") || s.contains("测试时间") || s.contains("执行人");
            if (ignore && !out.contains(s)) {
                out.add(s);
            }
        }
        return out;
    }

    private static void applyPriority(TestCaseSaveRequest req, String pri) {
        if (pri == null) {
            return;
        }
        String up = pri.toUpperCase();
        if (!up.matches("^P[0-3]$")) {
            throw AppException.badRequest("优先级只允许 P0/P1/P2/P3：" + pri);
        }
        req.setPriority(up);
    }

    /** 步骤行首编号："1." "1、" "1)" "（1）" 等，导入时去掉，避免与系统步骤序号重复 */
    private static final java.util.regex.Pattern STEP_NO =
            java.util.regex.Pattern.compile("^\\s*(?:\\d+\\s*[.、．)）]|[（(]\\s*\\d+\\s*[)）])\\s*");

    private static List<String> splitLines(String raw) {
        List<String> out = new ArrayList<String>();
        if (raw == null) {
            return out;
        }
        for (String line : raw.split("\r?\n")) {
            String s = STEP_NO.matcher(line.trim()).replaceFirst("").trim();
            if (!s.isEmpty()) {
                out.add(s);
            }
        }
        return out;
    }

    /**
     * 两列结构（测试步骤 / 期望结果）按行号配对：第 n 条操作对应第 n 条期望。
     * 行数不一致时以操作为准，多出的期望行并入最后一步，避免内容丢失。
     */
    private List<TestCaseSaveRequest.StepItem> pairSteps(String stepsRaw, String expectedRaw) {
        List<String> actions = splitLines(stepsRaw);
        List<String> expects = splitLines(expectedRaw);
        if (actions.isEmpty()) {
            throw AppException.badRequest("「测试步骤」为空，无法与期望结果逐行对应");
        }
        if (actions.size() > 30) {
            throw AppException.badRequest("单条用例步骤最多 30 条（当前 " + actions.size() + " 条）");
        }
        List<TestCaseSaveRequest.StepItem> items = new ArrayList<TestCaseSaveRequest.StepItem>();
        for (int i = 0; i < actions.size(); i++) {
            TestCaseSaveRequest.StepItem item = new TestCaseSaveRequest.StepItem();
            item.setAction(Texts.cut(actions.get(i), 200));
            if (i < expects.size()) {
                item.setExpected(Texts.cut(expects.get(i), 500));
            }
            items.add(item);
        }
        if (expects.size() > actions.size()) {
            StringBuilder extra = new StringBuilder();
            for (int i = actions.size(); i < expects.size(); i++) {
                if (extra.length() > 0) {
                    extra.append('\n');
                }
                extra.append(expects.get(i));
            }
            TestCaseSaveRequest.StepItem last = items.get(items.size() - 1);
            String merged = last.getExpected() == null ? extra.toString() : last.getExpected() + "\n" + extra;
            last.setExpected(Texts.cut(merged, 500));
        }
        return items;
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
        c.setTestData(Texts.trimToNull(req.getTestData()));
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
        requireDemandInProject(workspaceId, reqId, demandId);
        return demandId;
    }

    private Demand requireDemandInProject(String workspaceId, String reqId, String demandId) {
        Demand d = demandMapper.selectById(demandId);
        if (d == null || !workspaceId.equals(d.getWorkspaceId()) || !reqId.equals(d.getReqId())) {
            throw AppException.badRequest("关联需求不存在或不属于该项目：" + demandId);
        }
        return d;
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

    /** 用例编号展示口径：TC-001；历史数据编号为 0 时留空，不臆造 */
    private static String caseNoLabel(Integer caseNo) {
        if (caseNo == null || caseNo <= 0) {
            return "";
        }
        return String.format("TC-%03d", caseNo);
    }

    private String buildDefectDescription(TestCase c) {
        StringBuilder sb = new StringBuilder();
        sb.append("测试用例 ").append(caseNoLabel(c.getCaseNo())).append("「").append(c.getTitle()).append("」执行失败，自动转出。\n");
        if (c.getPrecondition() != null) {
            sb.append("\n前置条件：\n").append(c.getPrecondition()).append("\n");
        }
        if (c.getTestData() != null) {
            sb.append("\n测试数据：\n").append(c.getTestData()).append("\n");
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
