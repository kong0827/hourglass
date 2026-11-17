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
import com.hourglass.dto.CaseRunStatsView;
import com.hourglass.dto.EntityTimelineItem;
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
import com.hourglass.entity.WorkspaceMember;
import com.hourglass.mapper.DemandMapper;
import com.hourglass.mapper.RequirementMapper;
import com.hourglass.mapper.AttachmentMapper;
import com.hourglass.mapper.TestCaseMapper;
import com.hourglass.mapper.TestCaseRunMapper;
import com.hourglass.mapper.TestCaseTaskMapper;
import com.hourglass.mapper.TaskMapper;
import com.hourglass.mapper.WorkspaceMemberMapper;
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

    /** 每页上限：列表仍用「加载更多」，页宽只影响一次取多少行 */
    private static final int MAX_PAGE_SIZE = 200;
    /** 按筛选批量动作的单事务上限，超出明确报错而不是静默截断 */
    private static final int MAX_BATCH = 2000;
    private static final int MAX_EXCLUDE = 500;
    /** 空值类筛选哨兵：未归类 / 未设置 / 未指派 */
    private static final String NONE = "__none";
    /** 动态分组：成员由规则派生，读取时自愈刷新 */
    private static final String KIND_DYNAMIC = "dynamic";
    private static final java.util.Set<String> SORTS = new java.util.HashSet<String>(
            java.util.Arrays.asList("created", "updated", "executed", "no", "pri", "module", "status", "manual"));
    private static final java.util.Set<String> GROUP_DIMS = new java.util.HashSet<String>(
            java.util.Arrays.asList("module", "priority", "status", "owner", "demand", "set"));

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
    /** 代录执行人校验：必须是当前空间成员 */
    private final WorkspaceMemberMapper memberMapper;
    /** 模块目录（单归属归类）：用例保存与批量移动都要校验节点 */
    private final TestModuleService moduleService;
    /** 用例集成员引用：用例 / 项目删除时一并摘除，只依赖 mapper 避免与 CaseSetService 循环 */
    private final com.hourglass.mapper.CaseSetMapper setMapper;
    /** 关联工作项列表与覆盖矩阵都要显示「已发布」徽标：与工作项列表同一派生口径 */
    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private TaskPublicationService publications;
    /** 用例新增 / 改需求 / 删除 / 执行都会改变需求完成判定 */
    private final DemandCompletionService demandCompletion;

    public TestCaseService(TestCaseMapper caseMapper, TestCaseRunMapper runMapper,
                           TaskCommandService taskCommandService, ProjectAccessService projectAccess,
                           RequirementMapper reqMapper, DemandMapper demandMapper,
                           com.hourglass.mapper.TestModuleMapper moduleMapper,
                           AttachmentMapper attachmentMapper, AttachmentService attachmentService,
                           com.hourglass.mapper.TestPlanMapper planMapper,
                           com.hourglass.mapper.TestPlanCaseMapper planCaseMapper,
                           AuditService auditService, NumberSeqService numberSeq,
                           TestCaseTaskMapper caseTaskMapper, TaskMapper taskMapper,
                           WorkspaceMemberMapper memberMapper,
                           TestModuleService moduleService,
                           com.hourglass.mapper.CaseSetMapper setMapper,
                           DemandCompletionService demandCompletion) {
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
        this.memberMapper = memberMapper;
        this.moduleService = moduleService;
        this.setMapper = setMapper;
        this.demandCompletion = demandCompletion;
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

    /** 分页列表：筛选/排序/分页在 SQL，筛选下拉候选值单独查（不受筛选影响） */
    public TestCasePage page(String workspaceId, String userId, CaseQuery query) {
        String rid = normalizeQuery(workspaceId, userId, query);
        query.setOffset(Math.max(0, query.getOffset()));
        query.setLimit(Math.max(1, Math.min(MAX_PAGE_SIZE, query.getLimit())));

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
        page.setModuleNodes(moduleService.tree(workspaceId, userId, rid));
        page.setModuleIdCounts(facetCounts(caseMapper.countFacetsByModuleId(workspaceId, rid)));
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

    /**
     * 查询条件归一：项目与权限校验、空串归 null、排序白名单、目录子树展开。
     * 排序值只用于在 XML 里选列，不拼进 SQL。
     */
    private String normalizeQuery(String workspaceId, String userId, CaseQuery query) {
        String rid = ensureProject(workspaceId, query.getReqId());
        projectAccess.assertView(workspaceId, userId, rid);
        query.setWorkspaceId(workspaceId);
        query.setReqId(rid);
        query.setViewerId(userId);
        query.setQ(Texts.trimToNull(query.getQ()));
        query.setModule(Texts.trimToNull(query.getModule()));
        query.setPri(Texts.trimToNull(query.getPri()));
        query.setOwner(Texts.trimToNull(query.getOwner()));
        query.setDemandId(Texts.trimToNull(query.getDemandId()));
        query.setSetId(Texts.trimToNull(query.getSetId()));
        /* 分组筛选也要过可见性：别人的个人 / 指定成员分组不能靠猜 ID 反查成员 */
        query.setSetIds(null);
        if (query.getSetId() != null && !NONE.equals(query.getSetId())) {
            com.hourglass.entity.CaseSet set = setMapper.selectById(query.getSetId());
            if (set == null || !workspaceId.equals(set.getWorkspaceId()) || !rid.equals(set.getReqId())
                    || !CaseSetService.canSee(set, userId, membersOf(set))) {
                throw AppException.notFound("分组不存在：" + query.getSetId());
            }
            refreshDynamicSet(workspaceId, set);
            /* 分组可嵌套：点父组默认看整棵子树的用例，setSub=false 只看直接成员 */
            List<String> scope = new ArrayList<String>();
            scope.add(set.getId());
            if (query.isSetSub()) {
                collectDescendantSets(set.getId(), setMapper.selectByReqAll(workspaceId, rid), scope);
            }
            query.setSetIds(scope);
        }
        query.setModuleId(Texts.trimToNull(query.getModuleId()));
        query.setModuleIds(null);
        if (query.getModuleId() != null && !NONE.equals(query.getModuleId())) {
            query.setModuleIds(moduleService.scopeIds(workspaceId, rid, query.getModuleId(), query.isModuleSub()));
        }
        String sort = Texts.trimToNull(query.getSort());
        query.setSort(SORTS.contains(sort) ? sort : "created");
        query.setSortDir("asc".equals(query.getSortDir()) ? "asc" : "desc");
        if (query.getExcludeIds() != null && query.getExcludeIds().size() > MAX_EXCLUDE) {
            throw AppException.badRequest("取消勾选的行最多 " + MAX_EXCLUDE + " 条，请改用明确勾选");
        }
        return rid;
    }

    /**
     * 分组段头：当前筛选范围内按维度聚合条数与结果分布。
     * 模块 / 优先级 / 执行结果 / 自定义分组补齐零用例的段，便于发现覆盖缺口。
     */
    public List<com.hourglass.dto.CaseGroupCount> groups(String workspaceId, String userId, CaseQuery query) {
        String rid = normalizeQuery(workspaceId, userId, query);
        String dim = Texts.trimToNull(query.getGroupBy());
        if (dim == null || !GROUP_DIMS.contains(dim)) {
            throw AppException.badRequest("请选择分组维度");
        }
        query.setGroupBy(dim);
        if ("set".equals(dim)) {
            refreshDynamicSets(workspaceId, rid);
        }
        List<Map<String, Object>> rows = "set".equals(dim)
                ? caseMapper.countGroupsBySet(query)
                : caseMapper.countGroupsByQuery(query);
        Map<String, com.hourglass.dto.CaseGroupCount> byKey =
                new LinkedHashMap<String, com.hourglass.dto.CaseGroupCount>();
        for (Map<String, Object> row : rows) {
            com.hourglass.dto.CaseGroupCount g = new com.hourglass.dto.CaseGroupCount();
            g.setKey(String.valueOf(row.get("k")));
            g.setTotal(intOf(row.get("cnt")));
            g.setPassed(intOf(row.get("passed")));
            g.setFailed(intOf(row.get("failed")));
            g.setBlocked(intOf(row.get("blocked")));
            g.setSkipped(intOf(row.get("skipped")));
            g.setUntested(intOf(row.get("untested")));
            byKey.put(g.getKey(), g);
        }
        List<com.hourglass.dto.CaseGroupCount> out = new ArrayList<com.hourglass.dto.CaseGroupCount>();
        if ("module".equals(dim)) {
            Map<String, String> paths = modulePaths(workspaceId, userId, rid);
            for (Map.Entry<String, String> e : paths.entrySet()) {
                out.add(segment(byKey, e.getKey(), e.getValue()));
            }
            out.add(segment(byKey, NONE, "未归类"));
        } else if ("priority".equals(dim)) {
            for (String p : new String[]{"P0", "P1", "P2", "P3"}) {
                out.add(segment(byKey, p, p + " 优先级"));
            }
            out.add(segment(byKey, NONE, "未设置优先级"));
        } else if ("status".equals(dim)) {
            out.add(segment(byKey, CaseMeta.STATUS_FAILED, "失败"));
            out.add(segment(byKey, CaseMeta.STATUS_BLOCKED, "阻塞"));
            out.add(segment(byKey, CaseMeta.STATUS_PASSED, "通过"));
            out.add(segment(byKey, CaseMeta.STATUS_SKIPPED, "跳过"));
            out.add(segment(byKey, "__untested", "未执行"));
        } else if ("demand".equals(dim)) {
            for (Demand d : demandMapper.selectByReq(workspaceId, rid)) {
                String no = com.hourglass.common.Nos.demand(d.getDemandNo());
                out.add(segment(byKey, d.getId(), (no == null || no.isEmpty() ? "" : no + " · ") + d.getTitle()));
            }
            out.add(segment(byKey, NONE, "未关联需求"));
        } else if ("set".equals(dim)) {
            List<com.hourglass.dto.CaseSetView> sets = setMapper.selectVisibleWithCounts(workspaceId, rid, userId);
            Map<String, String> paths = setPaths(sets);
            for (com.hourglass.dto.CaseSetView s : sets) {
                out.add(segment(byKey, s.getId(), paths.get(s.getId())));
            }
        } else {
            List<String> keys = new ArrayList<String>(byKey.keySet());
            java.util.Collections.sort(keys);
            for (String key : keys) {
                out.add(segment(byKey, key, NONE.equals(key) ? "未指派" : key));
            }
            if (!byKey.containsKey(NONE)) {
                out.add(segment(byKey, NONE, "未指派"));
            }
        }
        return out;
    }

    private static com.hourglass.dto.CaseGroupCount segment(
            Map<String, com.hourglass.dto.CaseGroupCount> byKey, String key, String label) {
        com.hourglass.dto.CaseGroupCount g = byKey.get(key);
        if (g == null) {
            g = new com.hourglass.dto.CaseGroupCount();
            g.setKey(key);
        }
        g.setLabel(label);
        return g;
    }

    /** 目录节点的全路径名（父 / 子），按 DFS 顺序 */
    private Map<String, String> modulePaths(String workspaceId, String userId, String reqId) {
        List<com.hourglass.dto.CaseModuleNode> nodes = moduleService.tree(workspaceId, userId, reqId);
        Map<String, String> paths = new LinkedHashMap<String, String>();
        for (com.hourglass.dto.CaseModuleNode n : nodes) {
            String parent = n.getParentId() == null || n.getParentId().isEmpty() ? null : paths.get(n.getParentId());
            paths.put(n.getId(), parent == null ? n.getName() : parent + " / " + n.getName());
        }
        return paths;
    }

    /** 分组段头标签：嵌套分组显示「父组 / 子组」，同级重名时也能区分 */
    private static Map<String, String> setPaths(List<com.hourglass.dto.CaseSetView> rows) {
        Map<String, com.hourglass.dto.CaseSetView> byId = new LinkedHashMap<String, com.hourglass.dto.CaseSetView>();
        for (com.hourglass.dto.CaseSetView s : rows) {
            byId.put(s.getId(), s);
        }
        Map<String, String> paths = new LinkedHashMap<String, String>();
        for (com.hourglass.dto.CaseSetView s : rows) {
            StringBuilder path = new StringBuilder(s.getName());
            String cursor = Texts.trimToNull(s.getParentId());
            int guard = 0;
            while (cursor != null && guard++ < 64) {
                com.hourglass.dto.CaseSetView up = byId.get(cursor);
                if (up == null) {
                    break;
                }
                path.insert(0, up.getName() + " / ");
                cursor = Texts.trimToNull(up.getParentId());
            }
            paths.put(s.getId(), path.toString());
        }
        return paths;
    }

    private static int intOf(Object value) {
        return value instanceof Number ? ((Number) value).intValue() : 0;
    }

    /* ---------- 动态分组：成员由规则派生，读取前自愈刷新 ---------- */

    /** 刷新项目下全部动态分组：分组列表 / 分组段头 / 证据聚合前调用 */
    @Transactional
    public void refreshDynamicSets(String workspaceId, String reqId) {
        for (com.hourglass.entity.CaseSet s : setMapper.selectDynamicByReq(workspaceId, reqId)) {
            refreshOne(workspaceId, s);
        }
    }

    /** 刷新单个动态分组；手工分组直接返回 */
    @Transactional
    public void refreshDynamicSet(String workspaceId, com.hourglass.entity.CaseSet set) {
        if (set != null && KIND_DYNAMIC.equals(set.getKind())) {
            refreshOne(workspaceId, set);
        }
    }

    /** 规则当前命中数：保存动态分组前校验规模上限 */
    public int countRuleHits(String workspaceId, String reqId, String viewerId, String ruleJson, String name) {
        return caseMapper.countByQuery(ruleQuery(workspaceId, reqId, viewerId, ruleJson, name));
    }

    /**
     * 把规则命中结果物化进 case_set_item：既让分组计数、__none 筛选、圈选入计划
     * 沿用同一条成员口径，也避免每次读取都重跑规则查询。只在差集上写库。
     */
    private void refreshOne(String workspaceId, com.hourglass.entity.CaseSet set) {
        String viewer = ruleViewer(set);
        List<String> want = caseMapper.selectIdsByQuery(
                ruleQuery(workspaceId, set.getReqId(), viewer, set.getRuleJson(), set.getName()));
        java.util.Set<String> stale = new java.util.HashSet<String>(setMapper.selectCaseIds(set.getId()));
        List<String> add = new ArrayList<String>();
        for (String id : want) {
            if (!stale.remove(id)) {
                add.add(id);
            }
        }
        for (List<String> chunk : chunks(add)) {
            setMapper.insertItems(workspaceId, set.getId(), chunk, viewer);
        }
        for (List<String> chunk : chunks(new ArrayList<String>(stale))) {
            setMapper.deleteItems(set.getId(), chunk);
        }
    }

    /** 规则按创建人视角求值：个人分组的可见性不随查看者变化 */
    private static String ruleViewer(com.hourglass.entity.CaseSet set) {
        String owner = Texts.trimToNull(set.getOwnerUserId());
        return owner != null ? owner : set.getCreatedByUserId();
    }

    /** 只有「指定成员可见」的分组才需要查名单 */
    private List<String> membersOf(com.hourglass.entity.CaseSet set) {
        return CaseSetService.VIS_MEMBERS.equals(set.getVisibility())
                ? setMapper.selectMemberIds(set.getId()) : java.util.Collections.<String>emptyList();
    }

    /** 分组子树展开：父组选中时把全部后代加进范围（可见范围继承，子组一定可见） */
    private static void collectDescendantSets(String parentId, List<com.hourglass.entity.CaseSet> all,
                                              List<String> out) {
        for (com.hourglass.entity.CaseSet s : all) {
            if (parentId.equals(Texts.trimToNull(s.getParentId())) && !out.contains(s.getId())) {
                out.add(s.getId());
                collectDescendantSets(s.getId(), all, out);
            }
        }
    }

    /** 规则 JSON → 查询条件：只认白名单字段，未知字段被忽略而不是拼进 SQL */
    private CaseQuery ruleQuery(String workspaceId, String reqId, String viewerId, String ruleJson, String name) {
        com.hourglass.dto.CaseSetSaveRequest.Rule rule;
        try {
            String json = Texts.trimToNull(ruleJson);
            rule = JSON.readValue(json == null ? "{}" : json, com.hourglass.dto.CaseSetSaveRequest.Rule.class);
        } catch (Exception e) {
            throw AppException.badRequest("动态分组「" + name + "」的规则无法解析，请重新编辑规则");
        }
        CaseQuery q = new CaseQuery();
        q.setWorkspaceId(workspaceId);
        q.setReqId(reqId);
        q.setViewerId(viewerId);
        q.setStatus(rule.getStatus());
        q.setPri(rule.getPri());
        q.setDemandId(rule.getDemandId());
        q.setOwner(rule.getOwner());
        q.setBugOnly(rule.isBugOnly());
        q.setRegression(rule.isRegression());
        q.setQ(rule.getQ());
        q.setSearchWide(rule.isSearchWide());
        q.setModuleId(rule.getModuleId());
        if (q.getModuleId() != null && !NONE.equals(q.getModuleId())) {
            q.setModuleIds(moduleService.scopeIds(workspaceId, reqId, q.getModuleId(), rule.isModuleSub()));
        }
        return q;
    }

    private static List<List<String>> chunks(List<String> ids) {
        List<List<String>> out = new ArrayList<List<String>>();
        for (int i = 0; i < ids.size(); i += 500) {
            out.add(ids.subList(i, Math.min(ids.size(), i + 500)));
        }
        return out;
    }

    /**
     * 批量动作的作用范围：明确勾选（≤200 条）或「全选筛选结果」（含未加载行，≤2000 条）。
     * 上限是单事务保护，超出时明确报错让用户缩小范围，不静默截断。
     */
    public List<String> selectionIds(String userId, String workspaceId, com.hourglass.dto.CaseSelection selection) {
        if (selection == null) {
            throw AppException.badRequest("请先勾选用例");
        }
        if (!selection.isAllFiltered()) {
            return distinctIds(selection.getIds());
        }
        CaseQuery filter = selection.getFilter();
        if (filter == null) {
            throw AppException.badRequest("按筛选全选时必须带上筛选条件");
        }
        filter.setExcludeIds(selection.getExcludeIds());
        normalizeQuery(workspaceId, userId, filter);
        int total = caseMapper.countByQuery(filter);
        if (total == 0) {
            throw AppException.badRequest("当前筛选没有命中用例");
        }
        if (total > MAX_BATCH) {
            throw AppException.badRequest("按筛选一次最多处理 " + MAX_BATCH + " 条用例，当前命中 "
                    + total + " 条，请先缩小筛选范围");
        }
        return caseMapper.selectIdsByQuery(filter);
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
        List<com.hourglass.dto.CaseTaskLink> links = caseTaskMapper.selectOptions(workspaceId, rid, did,
                key == null ? null : Texts.cut(key, 50), itemNo, 200);
        applyLinkPublication(workspaceId, links);
        return links;
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
        List<com.hourglass.dto.TaskCoverageRow> rows = caseTaskMapper.selectCoverageByDemand(workspaceId, did);
        applyTaskRowPublication(workspaceId, rows);
        return rows;
    }

    private void applyLinkPublication(String workspaceId, List<com.hourglass.dto.CaseTaskLink> links) {
        if (publications == null || links == null || links.isEmpty()) {
            return;
        }
        List<String> ids = new ArrayList<String>();
        for (com.hourglass.dto.CaseTaskLink link : links) {
            if (link.getTaskId() != null && !ids.contains(link.getTaskId())) {
                ids.add(link.getTaskId());
            }
        }
        TaskPublicationService.PublicationFacts facts = publications.facts(workspaceId, ids);
        for (com.hourglass.dto.CaseTaskLink link : links) {
            TaskPublicationService.PublicationSummary summary = facts.summary(link.getTaskId());
            link.setPublicationState(summary.getPublicationState());
            link.setEverPublished(summary.isEverPublished());
            link.setPublicationTargets(summary.getPublicationTargets());
            link.setPublishedAt(summary.getPublishedAt());
            com.hourglass.entity.TaskPublicationJudgement judgement = facts.judgement(link.getTaskId());
            link.setManualPublished(judgement != null);
            link.setManualPublishedAt(judgement == null ? null : judgement.getEffectiveOn());
            link.setManualJudgeName(judgement == null ? null : judgement.getJudgedByName());
            link.setManualJudgeReason(judgement == null ? null : judgement.getJudgeReason());
        }
    }

    private void applyTaskRowPublication(String workspaceId, List<com.hourglass.dto.TaskCoverageRow> rows) {
        if (publications == null || rows == null || rows.isEmpty()) {
            return;
        }
        List<String> ids = new ArrayList<String>();
        for (com.hourglass.dto.TaskCoverageRow row : rows) {
            if (row.getTaskId() != null && !ids.contains(row.getTaskId())) {
                ids.add(row.getTaskId());
            }
        }
        TaskPublicationService.PublicationFacts facts = publications.facts(workspaceId, ids);
        for (com.hourglass.dto.TaskCoverageRow row : rows) {
            TaskPublicationService.PublicationSummary summary = facts.summary(row.getTaskId());
            row.setPublicationState(summary.getPublicationState());
            row.setEverPublished(summary.isEverPublished());
            row.setPublicationTargets(summary.getPublicationTargets());
            row.setPublishedAt(summary.getPublishedAt());
            com.hourglass.entity.TaskPublicationJudgement judgement = facts.judgement(row.getTaskId());
            row.setManualPublished(judgement != null);
            row.setManualPublishedAt(judgement == null ? null : judgement.getEffectiveOn());
            row.setManualJudgeName(judgement == null ? null : judgement.getJudgedByName());
            row.setManualJudgeReason(judgement == null ? null : judgement.getJudgeReason());
        }
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

    /** 执行流水聚合：按执行人 / 环境 / 轮次的结果分布与通过率（口径同概览，跳过不计入分母） */
    public CaseRunStatsView runStats(String workspaceId, String userId, String reqId) {
        String rid = ensureProject(workspaceId, reqId);
        projectAccess.assertView(workspaceId, userId, rid);
        CaseRunStatsView view = new CaseRunStatsView();
        Map<String, Map<String, CaseRunStatsView.Bucket>> dims = new LinkedHashMap<String, Map<String, CaseRunStatsView.Bucket>>();
        dims.put("executor", new LinkedHashMap<String, CaseRunStatsView.Bucket>());
        dims.put("environment", new LinkedHashMap<String, CaseRunStatsView.Bucket>());
        dims.put("round", new LinkedHashMap<String, CaseRunStatsView.Bucket>());
        int totalRuns = 0;
        for (Map<String, Object> row : runMapper.selectRunStats(workspaceId, rid)) {
            String dim = String.valueOf(row.get("dim"));
            Map<String, CaseRunStatsView.Bucket> buckets = dims.get(dim);
            if (buckets == null) {
                continue;
            }
            String key = String.valueOf(row.get("k"));
            if (key == null || "null".equals(key) || key.isEmpty()) {
                key = "__none";
            }
            String label = row.get("label") == null ? "" : String.valueOf(row.get("label"));
            String status = String.valueOf(row.get("status"));
            int cnt = ((Number) row.get("cnt")).intValue();
            CaseRunStatsView.Bucket b = buckets.get(key);
            if (b == null) {
                b = new CaseRunStatsView.Bucket();
                b.setKey(key);
                b.setLabel(bucketLabel(dim, key, label));
                buckets.put(key, b);
            }
            b.setTotal(b.getTotal() + cnt);
            if (CaseMeta.STATUS_PASSED.equals(status)) {
                b.setPassed(b.getPassed() + cnt);
            } else if (CaseMeta.STATUS_FAILED.equals(status)) {
                b.setFailed(b.getFailed() + cnt);
            } else if (CaseMeta.STATUS_BLOCKED.equals(status)) {
                b.setBlocked(b.getBlocked() + cnt);
            } else if (CaseMeta.STATUS_SKIPPED.equals(status)) {
                b.setSkipped(b.getSkipped() + cnt);
            }
            if ("executor".equals(dim)) {
                totalRuns += cnt;
            }
        }
        view.setTotalRuns(totalRuns);
        view.setByExecutor(finishBuckets(dims.get("executor"), false));
        view.setByEnvironment(finishBuckets(dims.get("environment"), false));
        view.setByRound(finishBuckets(dims.get("round"), true));
        return view;
    }

    /** 维度桶展示名：空键与轮次做人类可读化 */
    private String bucketLabel(String dim, String key, String rawLabel) {
        if ("round".equals(dim)) {
            if ("1".equals(key)) {
                return "首次执行";
            }
            if ("2".equals(key)) {
                return "第 2 轮";
            }
            return "第 3 轮及以上";
        }
        if ("__none".equals(key)) {
            return "environment".equals(dim) ? "未记录环境" : "未记录执行人";
        }
        return (rawLabel == null || rawLabel.trim().isEmpty())
            ? ("environment".equals(dim) ? "未记录环境" : "未记录执行人")
            : rawLabel.trim();
    }

    /** 收尾：算通过率（跳过不计入分母），按总量降序；轮次按序号升序 */
    private List<CaseRunStatsView.Bucket> finishBuckets(Map<String, CaseRunStatsView.Bucket> buckets, final boolean ascByKey) {
        List<CaseRunStatsView.Bucket> list = new ArrayList<CaseRunStatsView.Bucket>(buckets.values());
        for (CaseRunStatsView.Bucket b : list) {
            int denom = b.getPassed() + b.getFailed() + b.getBlocked();
            b.setPassRate(denom == 0 ? 0d : Math.round((double) b.getPassed() / denom * 1000d) / 10d);
        }
        java.util.Collections.sort(list, new java.util.Comparator<CaseRunStatsView.Bucket>() {
            @Override
            public int compare(CaseRunStatsView.Bucket a, CaseRunStatsView.Bucket c) {
                if (ascByKey) {
                    return a.getKey().compareTo(c.getKey());
                }
                return Integer.compare(c.getTotal(), a.getTotal());
            }
        });
        return list;
    }

    /** 执行统计下钻：取某桶（dim=executor/environment/round）内执行流水明细，轮次口径同聚合 */
    public List<com.hourglass.dto.CaseRunDrillRow> runDrill(String workspaceId, String userId, String reqId,
                                                            String dim, String key) {
        String rid = ensureProject(workspaceId, reqId);
        projectAccess.assertView(workspaceId, userId, rid);
        if (!"executor".equals(dim) && !"environment".equals(dim) && !"round".equals(dim)) {
            throw AppException.badRequest("不支持的统计维度：" + dim);
        }
        String k = (key == null || "__none".equals(key)) ? "" : key;
        return runMapper.selectRunsByDimension(workspaceId, rid, dim, k, 1000);
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

    /** 变更记录（最近在前）：来自 audit_log 中该用例自身的行，执行结果另见 runs */
    public List<EntityTimelineItem> timeline(String workspaceId, String userId, String caseId) {
        TestCase c = get(workspaceId, caseId);
        projectAccess.assertView(workspaceId, userId, c.getReqId());
        return auditService.timeline(workspaceId, "test_case", caseId, 100);
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
            v.setEnvironment(r.getEnvironment());
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
        c.setCreatedBy(CurrentUser.get().getDisplayName());
        c.setCreatedByUserId(userId);
        apply(c, reqId, req);
        assertDemandNotDone(workspaceId, c.getDemandId());
        insertWithNo(c);
        syncTaskLinks(userId, c, req.getTaskIds());
        auditService.recordCurrent(workspaceId, "test_case_create", "test_case", c.getId(), c.getTitle(), true,
                "新建测试用例「" + caseNoText(c) + " " + c.getTitle() + "」", null);
        demandCompletion.refreshCompletion(workspaceId, c.getDemandId());
        return caseMapper.selectById(c.getId());
    }

    /**
     * 分配项目内编号后插入。并发建用例会抢到同一个号，由唯一键 uk_case_no 拒绝，
     * 这里重算重试；失败的 INSERT 不会让 InnoDB 事务失效。
     * 取号走 number_seq（sql/87）：删除用例不回收编号。
     */
    private void insertWithNo(TestCase c) {
        /* 手动排序：新用例排在项目末尾，不打断用户已有的顺序 */
        c.setSortOrder(caseMapper.maxSortOrder(c.getWorkspaceId(), c.getReqId()) + 1);
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
        /* 换项目后旧序号在新项目里没有意义：重新排到末尾 */
        c.setSortOrder(caseMapper.maxSortOrder(c.getWorkspaceId(), c.getReqId()) + 1);
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
        String oldModule = c.getModule();
        String oldPriority = c.getPriority();
        String oldPrecondition = c.getPrecondition();
        String oldTestData = c.getTestData();
        String oldSteps = c.getSteps();
        if (moved) {
            /* 计划只圈选本项目用例：改项目会让原项目计划里留下跨项目行（已完成计划是快照，不受限） */
            List<String> open = planCaseMapper.selectOpenPlanNamesByCase(workspaceId, id);
            if (open != null && !open.isEmpty()) {
                throw AppException.badRequest("用例仍在测试计划「" + open.get(0) + "」"
                        + (open.size() > 1 ? "等 " + open.size() + " 个计划" : "") + "中，请先移出再改所属项目");
            }
        }
        apply(c, reqId, req);
        boolean demandChanged = !java.util.Objects.equals(oldDemandId, c.getDemandId());
        if (demandChanged) {
            /* 已完成需求不再接收新的用例覆盖；已有用例的编辑与执行不受影响 */
            assertDemandNotDone(workspaceId, c.getDemandId());
        }
        if (moved) {
            updateMovedWithNo(c);
        } else {
            caseMapper.update(c);
        }
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
        if (!java.util.Objects.equals(oldModule, c.getModule())) {
            what.append("，分类由「").append(textOrDash(oldModule)).append("」改为「")
                    .append(textOrDash(c.getModule())).append("」");
        }
        if (!java.util.Objects.equals(oldPriority, c.getPriority())) {
            what.append("，优先级 ").append(textOrDash(oldPriority)).append(" → ").append(textOrDash(c.getPriority()));
        }
        if (!java.util.Objects.equals(oldPrecondition, c.getPrecondition())) {
            what.append("，修改前置条件");
        }
        if (!java.util.Objects.equals(oldTestData, c.getTestData())) {
            what.append("，修改测试数据");
        }
        if (!java.util.Objects.equals(oldSteps, c.getSteps())) {
            what.append("，修改执行步骤");
        }
        auditService.recordCurrent(workspaceId, "test_case_update", "test_case", id, c.getTitle(), true,
                what.toString(), null);
        if (demandChanged) {
            demandCompletion.refreshCompletion(workspaceId, oldDemandId);
        }
        demandCompletion.refreshCompletion(workspaceId, c.getDemandId());
        return caseMapper.selectById(id);
    }

    private static String textOrDash(String value) {
        return value == null || value.isEmpty() ? "未设置" : value;
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
        setMapper.deleteItemsByCase(id);
        caseMapper.delete(workspaceId, id);
        attachmentService.deleteOrphanCaseRunAttachments(workspaceId);
        auditService.recordCurrent(workspaceId, "test_case_delete", "test_case", id, c.getTitle(), true,
                "删除测试用例「" + c.getTitle() + "」，执行流水与计划圈选一并清理", null);
        demandCompletion.refreshCompletion(workspaceId, c.getDemandId());
    }

    /* ---------- 批量维护（列表多选） ---------- */

    /** 批量改模块 / 优先级：范围支持勾选或全选筛选结果，跨项目逐项目校验写权限并解析目录节点 */
    @Transactional
    public Map<String, Object> batchUpdate(String userId, String workspaceId, com.hourglass.dto.TestCaseBatchRequest req) {
        com.hourglass.dto.CaseSelection selection = new com.hourglass.dto.CaseSelection();
        selection.setIds(req.getIds());
        selection.setAllFiltered(req.isAllFiltered());
        selection.setFilter(req.getFilter());
        selection.setExcludeIds(req.getExcludeIds());
        List<String> ids = selectionIds(userId, workspaceId, selection);
        String moduleAction = Texts.trimToNull(req.getModuleAction());
        String priorityAction = Texts.trimToNull(req.getPriorityAction());
        boolean moduleClear = "clear".equals(moduleAction);
        boolean moduleSet = "set".equals(moduleAction);
        boolean priorityClear = "clear".equals(priorityAction);
        boolean prioritySet = "set".equals(priorityAction);
        if (!moduleSet && !moduleClear && !prioritySet && !priorityClear) {
            throw AppException.badRequest("没有要修改的内容");
        }
        String moduleText = null;
        String moduleNodeId = null;
        if (moduleSet) {
            moduleText = Texts.cut(Texts.trimToNull(req.getModule()), 50);
            moduleNodeId = Texts.trimToNull(req.getModuleId());
            if (moduleText == null && moduleNodeId == null) {
                throw AppException.badRequest("请选择分类节点或填写分类名称，或勾选「清空分类」");
            }
        }
        String priority = null;
        if (prioritySet) {
            priority = Texts.trimToNull(req.getPriority());
            if (priority == null || !priority.matches("P[0-3]")) {
                throw AppException.badRequest("优先级只允许 P0/P1/P2/P3");
            }
        }
        List<TestCase> cases = loadWritable(userId, workspaceId, ids);
        if (cases.isEmpty()) {
            throw AppException.badRequest("勾选的用例已不存在或无权修改");
        }
        int updated = 0;
        String moduleLabel = null;
        for (Map.Entry<String, List<String>> e : idsByReq(cases).entrySet()) {
            String module = null;
            String moduleId = null;
            if (moduleSet) {
                com.hourglass.entity.Category node =
                        moduleService.resolveForCase(workspaceId, e.getKey(), moduleNodeId, moduleText);
                moduleId = node == null ? null : node.getId();
                module = node == null ? null : node.getName();
                moduleLabel = module;
            }
            updated += caseMapper.batchUpdate(workspaceId, e.getValue(), moduleSet || moduleClear,
                    module, moduleId, prioritySet || priorityClear, priority);
        }
        StringBuilder what = new StringBuilder();
        if (moduleSet) {
            what.append("分类=「").append(moduleLabel).append("」");
        }
        if (moduleClear) {
            what.append(what.length() > 0 ? "、" : "").append("清空分类");
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
        out.put("skipped", ids.size() - cases.size());
        return out;
    }

    /** 批量删除：逐条走单例删除链路（流水、计划圈选、分组成员、证据一并清理并逐条留痕） */
    @Transactional
    public Map<String, Object> batchDelete(String userId, String workspaceId, com.hourglass.dto.TestCaseBatchRequest req) {
        com.hourglass.dto.CaseSelection selection = new com.hourglass.dto.CaseSelection();
        selection.setIds(req.getIds());
        selection.setAllFiltered(req.isAllFiltered());
        selection.setFilter(req.getFilter());
        selection.setExcludeIds(req.getExcludeIds());
        List<String> ids = selectionIds(userId, workspaceId, selection);
        List<TestCase> cases = loadWritable(userId, workspaceId, ids);
        if (cases.isEmpty()) {
            throw AppException.badRequest("勾选的用例已不存在或无权删除");
        }
        for (TestCase c : cases) {
            delete(userId, workspaceId, c.getId());
        }
        Map<String, Object> out = new java.util.LinkedHashMap<String, Object>();
        out.put("deleted", cases.size());
        out.put("skipped", ids.size() - cases.size());
        return out;
    }

    /**
     * 拖拽归类：目录是单归属，移动即从原节点移出，编号与执行历史不变。
     * 返回每条用例移动前的节点，供「撤销」一次性回放。
     */
    @Transactional
    public Map<String, Object> moveModule(String userId, String workspaceId, com.hourglass.dto.CaseMoveRequest req) {
        List<String> ids = selectionIds(userId, workspaceId, req.getSelection());
        List<TestCase> cases = loadWritable(userId, workspaceId, ids);
        if (cases.isEmpty()) {
            throw AppException.badRequest("勾选的用例已不存在或无权修改");
        }
        String targetId = Texts.trimToNull(req.getModuleId());
        Map<String, String> nameByReq = new LinkedHashMap<String, String>();
        for (String pid : idsByReq(cases).keySet()) {
            nameByReq.put(pid, targetId == null ? null
                    : moduleService.requireNode(workspaceId, pid, targetId).getName());
        }
        List<Map<String, Object>> items = new ArrayList<Map<String, Object>>();
        Map<String, Map<String, List<String>>> changed = new LinkedHashMap<String, Map<String, List<String>>>();
        for (TestCase c : cases) {
            String prev = Texts.trimToNull(c.getModuleId());
            if (targetId == null ? prev == null : targetId.equals(prev)) {
                continue;
            }
            Map<String, Object> item = new LinkedHashMap<String, Object>();
            item.put("id", c.getId());
            item.put("moduleId", prev);
            items.add(item);
            String nodeKey = targetId == null ? "" : targetId;
            Map<String, List<String>> byNode = changed.get(c.getReqId());
            if (byNode == null) {
                byNode = new LinkedHashMap<String, List<String>>();
                changed.put(c.getReqId(), byNode);
            }
            List<String> bucket = byNode.get(nodeKey);
            if (bucket == null) {
                bucket = new ArrayList<String>();
                byNode.put(nodeKey, bucket);
            }
            bucket.add(c.getId());
        }
        int moved = 0;
        for (Map.Entry<String, Map<String, List<String>>> e : changed.entrySet()) {
            String name = nameByReq.get(e.getKey());
            int nextSort = caseMapper.maxSortOrder(workspaceId, e.getKey()) + 1;
            for (Map.Entry<String, List<String>> n : e.getValue().entrySet()) {
                moved += caseMapper.updateModuleBatch(workspaceId, n.getValue(),
                        n.getKey().isEmpty() ? null : n.getKey(), name);
                /* 换目录的用例排到末尾，保持目标目录已有的手动顺序 */
                for (String caseId : n.getValue()) {
                    caseMapper.updateSortOrder(workspaceId, caseId, nextSort++);
                }
            }
        }
        String label = targetId == null ? "未归类" : joinNames(nameByReq.values());
        auditService.recordCurrent(workspaceId, "test_case_move_module", "project", null, null, true,
                "移动 " + moved + " 条用例到目录「" + label + "」，编号与执行历史不变", null);
        Map<String, Object> out = new java.util.LinkedHashMap<String, Object>();
        out.put("moved", moved);
        out.put("skipped", ids.size() - cases.size());
        out.put("items", items);
        return out;
    }

    /** 撤销归类：按移动前的归属一次事务恢复，避免逐组回放中途失败留下半截状态 */
    @Transactional
    public Map<String, Object> restoreModule(String userId, String workspaceId, com.hourglass.dto.CaseRestoreRequest req) {
        Map<String, String> prevById = new LinkedHashMap<String, String>();
        for (com.hourglass.dto.CaseRestoreRequest.Item item : req.getItems()) {
            String id = item == null ? null : Texts.trimToNull(item.getId());
            if (id != null) {
                prevById.put(id, Texts.trimToNull(item.getModuleId()));
            }
        }
        if (prevById.isEmpty()) {
            throw AppException.badRequest("没有可撤销的用例");
        }
        List<TestCase> cases = loadWritable(userId, workspaceId, new ArrayList<String>(prevById.keySet()));
        if (cases.isEmpty()) {
            throw AppException.badRequest("要撤销的用例已不存在或无权修改");
        }
        Map<String, Map<String, List<String>>> groups = new LinkedHashMap<String, Map<String, List<String>>>();
        for (TestCase c : cases) {
            String nodeKey = prevById.get(c.getId()) == null ? "" : prevById.get(c.getId());
            Map<String, List<String>> byNode = groups.get(c.getReqId());
            if (byNode == null) {
                byNode = new LinkedHashMap<String, List<String>>();
                groups.put(c.getReqId(), byNode);
            }
            List<String> bucket = byNode.get(nodeKey);
            if (bucket == null) {
                bucket = new ArrayList<String>();
                byNode.put(nodeKey, bucket);
            }
            bucket.add(c.getId());
        }
        int restored = 0;
        for (Map.Entry<String, Map<String, List<String>>> e : groups.entrySet()) {
            for (Map.Entry<String, List<String>> n : e.getValue().entrySet()) {
                String name = n.getKey().isEmpty() ? null
                        : moduleService.requireNode(workspaceId, e.getKey(), n.getKey()).getName();
                restored += caseMapper.updateModuleBatch(workspaceId, n.getValue(),
                        n.getKey().isEmpty() ? null : n.getKey(), name);
            }
        }
        auditService.recordCurrent(workspaceId, "test_case_move_undo", "project", null, null, true,
                "撤销归类：恢复 " + restored + " 条用例的原目录归属", null);
        Map<String, Object> out = new java.util.LinkedHashMap<String, Object>();
        out.put("restored", restored);
        out.put("skipped", prevById.size() - cases.size());
        return out;
    }

    /** 手动排序的当前顺序：目录内（__none = 未归类；不传 = 整个项目） */
    public List<String> orderIds(String userId, String workspaceId, String reqId, String moduleId) {
        String rid = ensureProject(workspaceId, reqId);
        projectAccess.assertView(workspaceId, userId, rid);
        String key = Texts.trimToNull(moduleId);
        if (key != null && !NONE.equals(key)) {
            moduleService.requireNode(workspaceId, rid, key);
        }
        return caseMapper.selectIdsForOrder(workspaceId, rid, key);
    }

    /**
     * 手动排序：ids 必须恰好是当前目录的用例全集，按数组顺序重写序号。
     * 只调整顺序，不改归属、编号与执行历史；目录内排序互不干扰。
     */
    @Transactional
    public Map<String, Object> reorder(String userId, String workspaceId, com.hourglass.dto.CaseOrderRequest req) {
        String rid = ensureProject(workspaceId, req.getReqId());
        projectAccess.assertWrite(workspaceId, userId, rid);
        String key = Texts.trimToNull(req.getModuleId());
        if (key != null && !NONE.equals(key)) {
            moduleService.requireNode(workspaceId, rid, key);
        }
        List<String> current = caseMapper.selectIdsForOrder(workspaceId, rid, key);
        if (current.size() > MAX_BATCH) {
            throw AppException.badRequest("单个目录用例超过 " + MAX_BATCH + " 条，暂不支持整体排序");
        }
        java.util.Set<String> unique = new java.util.HashSet<String>(req.getIds());
        if (unique.size() != req.getIds().size() || current.size() != unique.size()
                || !unique.containsAll(current)) {
            throw AppException.badRequest("排序列表与当前目录的用例不一致，请刷新后重试");
        }
        for (int i = 0; i < req.getIds().size(); i++) {
            caseMapper.updateSortOrder(workspaceId, req.getIds().get(i), i);
        }
        auditService.recordCurrent(workspaceId, "test_case_reorder", "project", rid, null, true,
                "调整 " + req.getIds().size() + " 条用例的手动顺序"
                        + (key == null ? "（整个项目）" : "（目录内）"), null);
        Map<String, Object> out = new java.util.LinkedHashMap<String, Object>();
        out.put("updated", req.getIds().size());
        return out;
    }

    /** 批量动作前一次性取回本体：跨项目逐项目校验写权限，已删除 / 不在本空间的行由调用方按差值回报 */
    private List<TestCase> loadWritable(String userId, String workspaceId, List<String> ids) {
        List<TestCase> out = new ArrayList<TestCase>();
        for (int i = 0; i < ids.size(); i += 500) {
            List<String> chunk = ids.subList(i, Math.min(ids.size(), i + 500));
            for (TestCase c : caseMapper.selectByIds(workspaceId, chunk)) {
                projectAccess.assertWrite(workspaceId, userId, c.getReqId());
                out.add(c);
            }
        }
        return out;
    }

    private static Map<String, List<String>> idsByReq(List<TestCase> cases) {
        Map<String, List<String>> out = new LinkedHashMap<String, List<String>>();
        for (TestCase c : cases) {
            List<String> bucket = out.get(c.getReqId());
            if (bucket == null) {
                bucket = new ArrayList<String>();
                out.put(c.getReqId(), bucket);
            }
            bucket.add(c.getId());
        }
        return out;
    }

    private static String joinNames(java.util.Collection<String> names) {
        StringBuilder sb = new StringBuilder();
        for (String n : names) {
            if (n == null || sb.indexOf(n) >= 0) {
                continue;
            }
            sb.append(sb.length() > 0 ? " / " : "").append(n);
        }
        return sb.toString();
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
        String executorId = userId;
        String executorName = CurrentUser.get().getDisplayName();
        String proxy = Texts.trimToNull(req.getExecutedByUserId());
        if (proxy != null && !proxy.equals(userId)) {
            /* 代录：执行人必须是当前空间成员，避免流水挂到不存在的人头上 */
            WorkspaceMember m = null;
            for (WorkspaceMember row : memberMapper.selectByWorkspace(workspaceId)) {
                if (proxy.equals(row.getUserId())) {
                    m = row;
                    break;
                }
            }
            if (m == null) {
                throw AppException.badRequest("执行人不是当前空间成员");
            }
            executorId = m.getUserId();
            executorName = m.getDisplayName() != null ? m.getDisplayName() : m.getUsername();
        }
        String note = Texts.trimToNull(req.getNote());
        TestCaseRun run = new TestCaseRun();
        run.setId(Ids.gen("R"));
        run.setCaseId(id);
        run.setWorkspaceId(workspaceId);
        run.setStatus(req.getStatus());
        run.setNote(note);
        run.setEnvironment(Texts.trimToNull(req.getEnvironment()));
        run.setPlanId(Texts.trimToNull(planId));
        run.setExecutedBy(executorName);
        run.setExecutedByUserId(executorId);
        runMapper.insert(run);
        caseMapper.updateLatest(workspaceId, id, req.getStatus(), note, executorName, executorId);
        demandCompletion.refreshCompletion(workspaceId, c.getDemandId());
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
        TestCaseRun latest = runMapper.selectLatestByCase(id);
        boolean failedRun = latest != null && CaseMeta.STATUS_FAILED.equals(latest.getStatus());
        TaskSaveRequest tReq = new TaskSaveRequest();
        /* 任务标题/描述上限（60/2000）比用例口径窄：自动转出时截断，完整信息留在用例本体 */
        tReq.setTitle(Texts.cut(c.getTitle(), 60));
        tReq.setItemType("bug");
        tReq.setSeverity(req.getSeverity());
        tReq.setEnvironment(Texts.trimToNull(req.getEnvironment()));
        tReq.setReqId(c.getReqId());
        /* 用例关联了需求时，缺陷任务沿用该关联，保持追溯链一致 */
        tReq.setDemandId(c.getDemandId());
        tReq.setDescription(Texts.cut(buildDefectDescription(c, failedRun ? latest : null,
                Texts.trimToNull(req.getNote())), 2000));
        Task task = taskCommandService.create(userId, workspaceId, tReq);
        caseMapper.updateLatestBug(workspaceId, id, task.getId());
        if (failedRun) {
            runMapper.updateBugTask(latest.getId(), task.getId());
        }
        int copied = 0;
        if (failedRun && (req.getCarryEvidence() == null || req.getCarryEvidence())) {
            copied = attachmentService.copyRunEvidenceToTask(userId, workspaceId, latest.getId(), task.getId());
        }
        auditService.recordCurrent(workspaceId, "test_case_defect", "test_case", c.getId(), c.getTitle(), true,
                "用例「" + caseNoText(c) + " " + c.getTitle() + "」转出缺陷「" + task.getTitle() + "」"
                        + (copied > 0 ? "，携带 " + copied + " 份失败证据" : ""), null);
        return task;
    }

    /** 缺陷详情反查来源用例：跨项目聚合，只返回当前用户可见项目的用例 */
    public List<com.hourglass.dto.CaseBugLink> byBugTask(String workspaceId, String userId, String bugTaskId) {
        List<com.hourglass.dto.CaseBugLink> links = runMapper.selectByBugTask(workspaceId, bugTaskId);
        List<com.hourglass.dto.CaseBugLink> out = new ArrayList<com.hourglass.dto.CaseBugLink>();
        for (com.hourglass.dto.CaseBugLink l : links) {
            if (l.getReqId() != null && projectAccess.canView(workspaceId, userId, l.getReqId())) {
                out.add(l);
            }
        }
        return out;
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
        /* 自定义分组同样强归属项目：先摘成员引用与可见名单再删分组本体 */
        setMapper.deleteMembersByReq(workspaceId, reqId);
        setMapper.deleteItemsByReq(workspaceId, reqId);
        setMapper.deleteByReq(workspaceId, reqId);
        return count;
    }

    /* ---------- CSV 导入导出（A3：存量测试资产迁移入口） ---------- */

    private static final String CSV_HEADER = "用例编号,标题,分类,优先级,前置条件,测试数据,步骤（每行：操作 => 预期）";
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

    /** Excel 模板：可回导的 8 列 + 示例行 + 填写说明页；优先级列带下拉 */
    public byte[] templateXlsx() {
        return com.hourglass.common.CaseExcel.template();
    }

    /** 导出项目全部用例（口径同列表页：创建时间倒序） */
    public byte[] exportCsv(String workspaceId, String userId, String reqId) {
        String rid = ensureProject(workspaceId, reqId);
        projectAccess.assertView(workspaceId, userId, rid);
        return csvOf(caseMapper.selectViewByReq(workspaceId, rid));
    }

    /** 导出项目全部用例（Excel，带表头样式与执行信息列） */
    public byte[] exportXlsx(String workspaceId, String userId, String reqId) {
        String rid = ensureProject(workspaceId, reqId);
        projectAccess.assertView(workspaceId, userId, rid);
        return com.hourglass.common.CaseExcel.export(
                caseMapper.selectViewByReq(workspaceId, rid), projectName(rid));
    }

    /** 按当前筛选导出（含未加载的行）：条数上限与批量动作一致，超出明确报错而不是截断 */
    public byte[] exportCsvByFilter(String workspaceId, String userId, CaseQuery query) {
        normalizeQuery(workspaceId, userId, query);
        int total = caseMapper.countByQuery(query);
        if (total > MAX_BATCH) {
            throw AppException.badRequest("一次最多导出 " + MAX_BATCH + " 条用例，当前命中 "
                    + total + " 条，请先缩小筛选范围");
        }
        query.setOffset(0);
        query.setLimit(Math.max(1, total));
        return csvOf(total == 0 ? new ArrayList<TestCaseView>() : caseMapper.selectViewByQuery(query));
    }

    /** 按当前筛选导出（Excel）：与 CSV 同一口径与上限 */
    public byte[] exportXlsxByFilter(String workspaceId, String userId, CaseQuery query) {
        String rid = normalizeQuery(workspaceId, userId, query);
        int total = caseMapper.countByQuery(query);
        if (total > MAX_BATCH) {
            throw AppException.badRequest("一次最多导出 " + MAX_BATCH + " 条用例，当前命中 "
                    + total + " 条，请先缩小筛选范围");
        }
        query.setOffset(0);
        query.setLimit(Math.max(1, total));
        return com.hourglass.common.CaseExcel.export(
                total == 0 ? new ArrayList<TestCaseView>() : caseMapper.selectViewByQuery(query), projectName(rid));
    }

    /** 导出所选：只导出当前用户可见项目的用例 */
    public byte[] exportCsvByIds(String workspaceId, String userId, List<String> rawIds) {
        List<String> ids = distinctIds(rawIds);
        if (ids.isEmpty()) {
            throw AppException.badRequest("请先勾选要导出的用例");
        }
        List<TestCaseView> rows = new ArrayList<TestCaseView>();
        for (int i = 0; i < ids.size(); i += 500) {
            rows.addAll(caseMapper.selectViewByIds(workspaceId, ids.subList(i, Math.min(ids.size(), i + 500))));
        }
        for (TestCaseView v : rows) {
            projectAccess.assertView(workspaceId, userId, v.getReqId());
        }
        return csvOf(rows);
    }

    /** 导出所选（Excel）；行顺序与勾选一致（按 mapper 返回顺序） */
    public byte[] exportXlsxByIds(String workspaceId, String userId, List<String> rawIds) {
        List<String> ids = distinctIds(rawIds);
        if (ids.isEmpty()) {
            throw AppException.badRequest("请先勾选要导出的用例");
        }
        List<TestCaseView> rows = new ArrayList<TestCaseView>();
        for (int i = 0; i < ids.size(); i += 500) {
            rows.addAll(caseMapper.selectViewByIds(workspaceId, ids.subList(i, Math.min(ids.size(), i + 500))));
        }
        for (TestCaseView v : rows) {
            projectAccess.assertView(workspaceId, userId, v.getReqId());
        }
        return com.hourglass.common.CaseExcel.export(rows,
                rows.isEmpty() ? null : projectName(rows.get(0).getReqId()));
    }

    /** 项目名只作工作表名，取不到时退回「测试用例」 */
    private String projectName(String reqId) {
        if (reqId == null) {
            return null;
        }
        Requirement r = reqMapper.selectById(reqId);
        return r == null ? null : r.getName();
    }

    private byte[] csvOf(List<TestCaseView> rows) {
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
     * 两种格式都接受：CSV 文本与 Excel（.xlsx / .xls，只读第一个工作表，表头可在说明行下方）。
     * 1) 表头驱动：按列名识别（标题/用例名称、模块/需求对应、优先级、前置条件、
     *    测试步骤、期望结果），外部表格直接导入；
     *    步骤与期望分两列时按行号一一配对，行首"1."等编号自动去掉。
     * 2) 无表头：沿用旧位置口径（标题, 模块, 优先级, 前置条件, 步骤），
     *    步骤列按换行分步、"操作 => 预期"。
     * 执行结果、截图、缺陷等列无法还原成执行流水，明确忽略并在结果里回报。
     */
    @Transactional
    public Map<String, Object> importCsv(String userId, String workspaceId, String reqId, String text) {
        String rid = ensureProject(workspaceId, reqId);
        projectAccess.assertWrite(workspaceId, userId, rid);
        return importRows(userId, workspaceId, rid,
                com.hourglass.common.Csv.parse(text == null ? "" : text));
    }

    /** 导入 Excel（.xlsx / .xls）：只读第一个工作表，逐行口径与 CSV 完全一致 */
    @Transactional
    public Map<String, Object> importExcel(String userId, String workspaceId, String reqId, byte[] data) {
        String rid = ensureProject(workspaceId, reqId);
        projectAccess.assertWrite(workspaceId, userId, rid);
        return importRows(userId, workspaceId, rid, com.hourglass.common.CaseExcel.read(data));
    }

    private Map<String, Object> importRows(String userId, String workspaceId, String rid,
                                           List<List<String>> rows) {
        Map<String, Object> out = new java.util.LinkedHashMap<String, Object>();
        List<Map<String, Object>> errors = new ArrayList<Map<String, Object>>();
        int created = 0;
        int headerIndex = findHeaderRow(rows);
        boolean headerMode = headerIndex >= 0;
        int start = headerMode ? headerIndex + 1 : 0;
        Map<String, Integer> cols = headerMode
                ? mapHeader(rows.get(headerIndex)) : new java.util.HashMap<String, Integer>();
        int dataRows = Math.max(0, rows.size() - start);
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
        out.put("ignored", headerMode ? ignoredColumns(rows.get(headerIndex)) : new ArrayList<String>());
        int skipped = Math.max(0, dataRows - created - errors.size());
        out.put("skipped", skipped);
        /* 一条都没导入且存在错误时，审计结果记为失败，便于按结果筛选问题导入 */
        auditService.recordCurrent(workspaceId, "test_case_import", "project", rid, null,
                created > 0 || errors.isEmpty(), "导入测试用例：成功 " + created + " 条，失败 "
                        + errors.size() + " 条，跳过 " + skipped + " 条", null);
        return out;
    }

    /**
     * 表头行定位：首行含「标题」即认；否则在前 10 行里找同时含标题与至少两类列的标题行，
     * 兼容外部表格在表头上方放一行说明/标题。
     */
    private static int findHeaderRow(List<List<String>> rows) {
        if (rows == null || rows.isEmpty()) {
            return -1;
        }
        if (mapHeader(rows.get(0)).containsKey("title")) {
            return 0;
        }
        int limit = Math.min(rows.size(), 10);
        for (int i = 1; i < limit; i++) {
            Map<String, Integer> cols = mapHeader(rows.get(i));
            if (cols.containsKey("title") && cols.size() >= 2) {
                return i;
            }
        }
        return -1;
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
        if (s.contains("模块") || s.contains("分类") || s.contains("需求对应")) {
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
        /* 以下只读列会被明确忽略；「预期结果」必须排在「结果」判断之前 */
        if (s.contains("结果") || s.contains("状态")) {
            return "status";
        }
        if (s.contains("执行人") || s.contains("测试人员") || s.contains("负责人")) {
            return "owner";
        }
        if (s.contains("执行时间") || s.contains("测试时间") || s.contains("完成时间")) {
            return "executedAt";
        }
        if (s.contains("备注")) {
            return "note";
        }
        return null;
    }

    /** 引用了但无法落库的列：执行结果、执行人/时间、备注、截图与缺陷 */
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
            String kind = headerKind(s);
            boolean ignore = "status".equals(kind) || "owner".equals(kind) || "executedAt".equals(kind)
                    || "note".equals(kind) || s.contains("截图") || s.contains("缺陷")
                    || s.contains("附件") || s.contains("证据");
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
     * 保位置分行：去掉行首编号但保留空行，供「步骤 + 预期」两列按行号配对；
     * 尾随空行忽略（导出时空预期会留一行序号，回导时仍是同一步）。
     */
    private static List<String> splitLinesKeep(String raw) {
        List<String> out = new ArrayList<String>();
        if (raw == null) {
            return out;
        }
        for (String line : raw.split("\r?\n", -1)) {
            out.add(STEP_NO.matcher(line.trim()).replaceFirst("").trim());
        }
        while (!out.isEmpty() && out.get(out.size() - 1).isEmpty()) {
            out.remove(out.size() - 1);
        }
        return out;
    }

    /**
     * 两列结构（测试步骤 / 期望结果）按行号配对：第 n 条操作对应第 n 条期望；
     * 某步没有预期时保留空位，不把后续预期错配到前一步。
     * 行数不一致时以操作为准，多出的期望行并入最后一步，避免内容丢失。
     */
    private List<TestCaseSaveRequest.StepItem> pairSteps(String stepsRaw, String expectedRaw) {
        List<String> actions = splitLinesKeep(stepsRaw);
        List<String> expects = splitLinesKeep(expectedRaw);
        boolean hasAction = false;
        for (String action : actions) {
            if (!action.isEmpty()) {
                hasAction = true;
                break;
            }
        }
        if (!hasAction) {
            throw AppException.badRequest("「测试步骤」为空，无法与期望结果逐行对应");
        }
        if (actions.size() > 30) {
            throw AppException.badRequest("单条用例步骤最多 30 条（当前 " + actions.size() + " 条）");
        }
        List<TestCaseSaveRequest.StepItem> items = new ArrayList<TestCaseSaveRequest.StepItem>();
        for (int i = 0; i < actions.size(); i++) {
            String action = actions.get(i);
            String expected = i < expects.size() ? expects.get(i) : null;
            if (action.isEmpty()) {
                if (expected == null || expected.isEmpty()) {
                    continue;
                }
                /* 空操作行带着预期：并入上一步；没有上一步时把预期当操作保留，不静默丢弃 */
                if (!items.isEmpty()) {
                    TestCaseSaveRequest.StepItem last = items.get(items.size() - 1);
                    String merged = last.getExpected() == null || last.getExpected().isEmpty()
                            ? expected : last.getExpected() + "\n" + expected;
                    last.setExpected(Texts.cut(merged, 500));
                } else {
                    TestCaseSaveRequest.StepItem item = new TestCaseSaveRequest.StepItem();
                    item.setAction(Texts.cut(expected, 200));
                    items.add(item);
                }
                continue;
            }
            TestCaseSaveRequest.StepItem item = new TestCaseSaveRequest.StepItem();
            item.setAction(Texts.cut(action, 200));
            if (expected != null && !expected.isEmpty()) {
                item.setExpected(Texts.cut(expected, 500));
            }
            items.add(item);
        }
        if (expects.size() > actions.size()) {
            StringBuilder extra = new StringBuilder();
            for (int i = actions.size(); i < expects.size(); i++) {
                if (expects.get(i).isEmpty()) {
                    continue;
                }
                if (extra.length() > 0) {
                    extra.append('\n');
                }
                extra.append(expects.get(i));
            }
            if (extra.length() > 0 && !items.isEmpty()) {
                TestCaseSaveRequest.StepItem last = items.get(items.size() - 1);
                String merged = last.getExpected() == null || last.getExpected().isEmpty()
                        ? extra.toString() : last.getExpected() + "\n" + extra;
                last.setExpected(Texts.cut(merged, 500));
            }
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
        /* 归属以目录节点为准；只给文本时按名称找节点，找不到补建顶级节点 */
        com.hourglass.entity.Category node =
                moduleService.resolveForCase(c.getWorkspaceId(), reqId, req.getModuleId(), req.getModule());
        c.setModuleId(node == null ? null : node.getId());
        c.setModule(node == null ? null : node.getName());
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

    /** 已完成需求不再接收新的用例覆盖；已完成状态只由完成判定服务改变。 */
    private void assertDemandNotDone(String workspaceId, String demandId) {
        if (demandId == null) {
            return;
        }
        Demand d = demandMapper.selectById(demandId);
        if (d != null && workspaceId.equals(d.getWorkspaceId()) && "done".equals(d.getStatus())) {
            throw AppException.badRequest("已完成需求不能新增关联用例");
        }
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

    private String buildDefectDescription(TestCase c, TestCaseRun latest, String extraNote) {
        StringBuilder sb = new StringBuilder();
        sb.append("测试用例 ").append(caseNoLabel(c.getCaseNo())).append("「").append(c.getTitle()).append("」执行失败，自动转出。\n");
        if (latest != null) {
            StringBuilder meta = new StringBuilder();
            if (latest.getExecutedBy() != null) {
                meta.append("执行人：").append(latest.getExecutedBy());
            }
            if (latest.getCreatedAt() != null) {
                if (meta.length() > 0) {
                    meta.append(" · ");
                }
                meta.append("执行时间：").append(latest.getCreatedAt()
                        .format(java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm")));
            }
            if (latest.getEnvironment() != null) {
                if (meta.length() > 0) {
                    meta.append(" · ");
                }
                meta.append("执行环境：").append(latest.getEnvironment());
            }
            if (meta.length() > 0) {
                sb.append(meta).append("\n");
            }
        }
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
        if (extraNote != null) {
            sb.append("\n转缺陷补充：").append(extraNote).append("\n");
        }
        return sb.toString();
    }
}
