package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.common.Ids;
import com.hourglass.common.Texts;
import com.hourglass.dto.CaseModuleNode;
import com.hourglass.dto.TestModuleSaveRequest;
import com.hourglass.entity.TestModule;
import com.hourglass.mapper.TestCaseMapper;
import com.hourglass.mapper.TestModuleMapper;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 模块目录（单归属归类）：项目下的树，不限层级，仅防环——与文档分类口径一致。
 * 用例通过 test_case.module_id 挂在唯一节点上，计数不重复，可直接进覆盖矩阵与交付证据；
 * 多归属的「自定义分组」由 CaseSetService 承载，两者语义不同，不共用一张表。
 */
@Service
public class TestModuleService {

    private final TestModuleMapper moduleMapper;
    private final TestCaseMapper caseMapper;
    private final ProjectAccessService projectAccess;
    private final AuditService auditService;
    /* 动态分组规则会引用目录节点：只依赖 mapper，避免与 CaseSetService 形成循环 */
    private final com.hourglass.mapper.CaseSetMapper setMapper;

    public TestModuleService(TestModuleMapper moduleMapper, TestCaseMapper caseMapper,
                             ProjectAccessService projectAccess, AuditService auditService,
                             com.hourglass.mapper.CaseSetMapper setMapper) {
        this.moduleMapper = moduleMapper;
        this.caseMapper = caseMapper;
        this.projectAccess = projectAccess;
        this.auditService = auditService;
        this.setMapper = setMapper;
    }

    /* ---------- 查询 ---------- */

    /** 目录树（DFS 顺序的扁平列表，带层级与计数）：caseCount 只算直接挂载，subtreeCount 含子节点 */
    public List<CaseModuleNode> tree(String workspaceId, String userId, String reqId) {
        projectAccess.assertView(workspaceId, userId, reqId);
        List<TestModule> rows = moduleMapper.selectByReq(workspaceId, reqId);
        Map<String, Integer> counts = new HashMap<String, Integer>();
        for (Map<String, Object> row : caseMapper.countFacetsByModuleId(workspaceId, reqId)) {
            counts.put(String.valueOf(row.get("k")), ((Number) row.get("cnt")).intValue());
        }
        Map<String, List<TestModule>> children = childrenOf(rows);
        List<CaseModuleNode> out = new ArrayList<CaseModuleNode>();
        for (TestModule root : rootsOf(rows)) {
            appendNode(out, root, children, counts, 1);
        }
        return out;
    }

    private int appendNode(List<CaseModuleNode> out, TestModule m, Map<String, List<TestModule>> children,
                           Map<String, Integer> counts, int level) {
        CaseModuleNode node = new CaseModuleNode();
        node.setId(m.getId());
        node.setParentId(rootKey(m.getParentId()));
        node.setName(m.getName());
        node.setLevel(level);
        node.setSortOrder(m.getSortOrder() == null ? 0 : m.getSortOrder());
        Integer own = counts.get(m.getId());
        node.setCaseCount(own == null ? 0 : own);
        out.add(node);
        int subtree = node.getCaseCount();
        List<TestModule> kids = children.get(m.getId());
        if (kids != null) {
            for (TestModule kid : kids) {
                subtree += appendNode(out, kid, children, counts, level + 1);
            }
        }
        node.setSubtreeCount(subtree);
        return subtree;
    }

    /** 节点必须存在且属于该项目 */
    public TestModule requireNode(String workspaceId, String reqId, String moduleId) {
        String id = Texts.trimToNull(moduleId);
        if (id == null) {
            throw AppException.badRequest("请选择目录节点");
        }
        TestModule m = moduleMapper.selectById(id);
        if (m == null || !workspaceId.equals(m.getWorkspaceId()) || !reqId.equals(m.getReqId())) {
            throw AppException.badRequest("目录节点不存在或不属于该项目：" + id);
        }
        return m;
    }

    /** 目录筛选范围：本节点 +（可选）全部子节点 */
    public List<String> scopeIds(String workspaceId, String reqId, String moduleId, boolean includeSub) {
        TestModule node = requireNode(workspaceId, reqId, moduleId);
        List<String> ids = new ArrayList<String>();
        ids.add(node.getId());
        if (includeSub) {
            Map<String, List<TestModule>> children = childrenOf(moduleMapper.selectByReq(workspaceId, reqId));
            collectDescendants(node.getId(), children, ids);
        }
        return ids;
    }

    private static void collectDescendants(String parentId, Map<String, List<TestModule>> children, List<String> out) {
        List<TestModule> kids = children.get(parentId);
        if (kids == null) {
            return;
        }
        for (TestModule kid : kids) {
            if (!out.contains(kid.getId())) {
                out.add(kid.getId());
                collectDescendants(kid.getId(), children, out);
            }
        }
    }

    /**
     * 用例保存时的归属解析：给了节点就用节点；只给自由文本（旧客户端 / CSV / AI 生成）
     * 就按名称找节点，找不到补建顶级节点，保证目录与用例文本始终对得上。
     */
    @Transactional
    public TestModule resolveForCase(String workspaceId, String reqId, String moduleId, String moduleText) {
        String id = Texts.trimToNull(moduleId);
        if (id != null) {
            return requireNode(workspaceId, reqId, id);
        }
        String name = Texts.trimToNull(moduleText);
        if (name == null) {
            return null;
        }
        name = Texts.cut(name, 50);
        TestModule found = moduleMapper.selectByName(workspaceId, reqId, name);
        if (found != null) {
            return found;
        }
        TestModule m = new TestModule();
        m.setId(Ids.gen("M"));
        m.setWorkspaceId(workspaceId);
        m.setReqId(reqId);
        m.setParentId("");
        m.setName(name);
        m.setSortOrder(nextSortOrder(moduleMapper.selectByReq(workspaceId, reqId), ""));
        try {
            moduleMapper.insert(m);
        } catch (DuplicateKeyException e) {
            return moduleMapper.selectByName(workspaceId, reqId, name);
        }
        return m;
    }

    /* ---------- 写入 ---------- */

    @Transactional
    public CaseModuleNode create(String userId, String workspaceId, TestModuleSaveRequest req) {
        String reqId = Texts.trimToNull(req.getReqId());
        if (reqId == null) {
            throw AppException.badRequest("请选择所属项目");
        }
        projectAccess.assertWrite(workspaceId, userId, reqId);
        String name = Texts.cut(Texts.trimToNull(req.getName()), 50);
        if (name == null) {
            throw AppException.badRequest("请填写目录名称");
        }
        List<TestModule> rows = moduleMapper.selectByReq(workspaceId, reqId);
        String parentId = rootKey(req.getParentId());
        int level = 1;
        if (!parentId.isEmpty()) {
            TestModule parent = requireNode(workspaceId, reqId, parentId);
            level = levelOf(parent, rows) + 1;
        }
        TestModule m = new TestModule();
        m.setId(Ids.gen("M"));
        m.setWorkspaceId(workspaceId);
        m.setReqId(reqId);
        m.setParentId(parentId);
        m.setName(name);
        m.setSortOrder(nextSortOrder(rows, parentId));
        try {
            moduleMapper.insert(m);
        } catch (DuplicateKeyException e) {
            throw AppException.badRequest("同级下已有目录「" + name + "」");
        }
        auditService.recordCurrent(workspaceId, "test_module_create", "test_module", m.getId(), name, true,
                "新建用例目录「" + name + "」" + (parentId.isEmpty() ? "（顶级）" : "（第 " + level + " 级）"), null);
        return nodeOf(m, level);
    }

    @Transactional
    public CaseModuleNode update(String userId, String workspaceId, String id, TestModuleSaveRequest req) {
        TestModule m = moduleMapper.selectById(id);
        if (m == null || !workspaceId.equals(m.getWorkspaceId())) {
            throw AppException.notFound("目录节点不存在：" + id);
        }
        String reqId = m.getReqId();
        projectAccess.assertWrite(workspaceId, userId, reqId);
        String name = Texts.cut(Texts.trimToNull(req.getName()), 50);
        if (name == null) {
            throw AppException.badRequest("请填写目录名称");
        }
        List<TestModule> rows = moduleMapper.selectByReq(workspaceId, reqId);
        String oldName = m.getName();
        String oldParent = rootKey(m.getParentId());
        String parentId = rootKey(req.getParentId());
        if (parentId.equals(m.getId())) {
            throw AppException.badRequest("目录不能挂到自己下面");
        }
        int level = 1;
        if (!parentId.isEmpty()) {
            TestModule parent = requireNode(workspaceId, reqId, parentId);
            Map<String, TestModule> byId = byIdOf(rows);
            String cursor = parent.getId();
            /* 环检测按节点总数收敛，不设业务层级上限 */
            int guard = 0;
            while (!cursor.isEmpty() && guard++ <= rows.size()) {
                if (cursor.equals(m.getId())) {
                    throw AppException.badRequest("目录不能挂到自己的子目录下");
                }
                TestModule up = byId.get(cursor);
                cursor = up == null ? "" : rootKey(up.getParentId());
            }
            level = levelOf(parent, rows) + 1;
        }
        m.setName(name);
        m.setParentId(parentId);
        try {
            moduleMapper.update(m);
        } catch (DuplicateKeyException e) {
            throw AppException.badRequest("同级下已有目录「" + name + "」");
        }
        StringBuilder what = new StringBuilder("编辑用例目录「").append(name).append("」");
        if (!oldName.equals(name)) {
            what.append("，名称由「").append(oldName).append("」修改");
        }
        if (!oldParent.equals(parentId)) {
            what.append("，调整了上级目录");
        }
        auditService.recordCurrent(workspaceId, "test_module_update", "test_module", id, name, true,
                what.toString(), null);
        return nodeOf(m, level);
    }

    /** 删除目录：仍有子目录或仍挂着用例时拒绝，避免把归类与证据一并丢掉 */
    @Transactional
    public void delete(String userId, String workspaceId, String id) {
        TestModule m = moduleMapper.selectById(id);
        if (m == null || !workspaceId.equals(m.getWorkspaceId())) {
            throw AppException.notFound("目录节点不存在：" + id);
        }
        projectAccess.assertWrite(workspaceId, userId, m.getReqId());
        int kids = moduleMapper.countChildren(workspaceId, m.getReqId(), m.getId());
        if (kids > 0) {
            throw AppException.badRequest("目录「" + m.getName() + "」下还有 " + kids + " 个子目录，请先删除或移走子目录");
        }
        int cases = caseMapper.countByModuleId(workspaceId, m.getId());
        if (cases > 0) {
            throw AppException.badRequest("目录「" + m.getName() + "」下还有 " + cases + " 条用例，请先把用例移到其他目录");
        }
        List<String> rules = setMapper.selectDynamicNamesByModule(workspaceId, m.getReqId(), m.getId());
        if (!rules.isEmpty()) {
            throw AppException.badRequest("目录「" + m.getName() + "」被动态分组「" + rules.get(0)
                    + "」的收录规则引用，请先编辑该分组规则");
        }
        moduleMapper.delete(workspaceId, id);
        auditService.recordCurrent(workspaceId, "test_module_delete", "test_module", id, m.getName(), true,
                "删除用例目录「" + m.getName() + "」", null);
    }

    /* ---------- 内部：目录规模小，一次取回后在内存里算层级 ---------- */

    private static Map<String, TestModule> byIdOf(List<TestModule> rows) {
        Map<String, TestModule> byId = new LinkedHashMap<String, TestModule>();
        for (TestModule m : rows) {
            byId.put(m.getId(), m);
        }
        return byId;
    }

    private static List<TestModule> rootsOf(List<TestModule> rows) {
        Map<String, TestModule> byId = byIdOf(rows);
        List<TestModule> roots = new ArrayList<TestModule>();
        for (TestModule m : rows) {
            String pid = rootKey(m.getParentId());
            if (pid.isEmpty() || !byId.containsKey(pid)) {
                roots.add(m);
            }
        }
        return roots;
    }

    private static Map<String, List<TestModule>> childrenOf(List<TestModule> rows) {
        Map<String, TestModule> byId = byIdOf(rows);
        Map<String, List<TestModule>> children = new LinkedHashMap<String, List<TestModule>>();
        for (TestModule m : rows) {
            String pid = rootKey(m.getParentId());
            if (pid.isEmpty() || !byId.containsKey(pid)) {
                continue;
            }
            List<TestModule> bucket = children.get(pid);
            if (bucket == null) {
                bucket = new ArrayList<TestModule>();
                children.put(pid, bucket);
            }
            bucket.add(m);
        }
        return children;
    }

    private static int levelOf(TestModule node, List<TestModule> rows) {
        Map<String, TestModule> byId = byIdOf(rows);
        int level = 1, guard = 0;
        String pid = rootKey(node.getParentId());
        while (!pid.isEmpty() && guard++ <= rows.size()) {
            TestModule parent = byId.get(pid);
            if (parent == null) {
                break;
            }
            level++;
            pid = rootKey(parent.getParentId());
        }
        return level;
    }

    private static int nextSortOrder(List<TestModule> rows, String parentId) {
        int max = -1;
        for (TestModule m : rows) {
            if (parentId.equals(rootKey(m.getParentId()))) {
                max = Math.max(max, m.getSortOrder() == null ? 0 : m.getSortOrder());
            }
        }
        return max + 1;
    }

    private static CaseModuleNode nodeOf(TestModule m, int level) {
        CaseModuleNode node = new CaseModuleNode();
        node.setId(m.getId());
        node.setParentId(rootKey(m.getParentId()));
        node.setName(m.getName());
        node.setLevel(level);
        node.setSortOrder(m.getSortOrder() == null ? 0 : m.getSortOrder());
        return node;
    }

    private static String rootKey(String parentId) {
        String s = Texts.trimToNull(parentId);
        return s == null ? "" : s;
    }
}