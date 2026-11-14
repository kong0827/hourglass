package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.common.Ids;
import com.hourglass.common.Texts;
import com.hourglass.dto.DocCategoryNode;
import com.hourglass.dto.DocCategorySaveRequest;
import com.hourglass.entity.DocCategory;
import com.hourglass.entity.Requirement;
import com.hourglass.mapper.DocCategoryMapper;
import com.hourglass.mapper.RequirementMapper;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 文档分类树（单归属归类）：参照测试模块目录，但有两点不同——
 *   1) 不限层级，与测试模块目录同口径；分类只是归类层，切太细不影响执行范围，因此不设业务深度上限，仅做环 guard。
 *   2) 支持空间级：req_id 空串 = 不归属任何项目的分类（开发手册等），非空 = 项目级分类。
 *
 * <p>权限口径：项目级分类的增删改 = 项目可写者（projectAccess.assertWrite）；
 * 空间级分类的增删改 = 空间主/管理员（分类是空间级公共结构）；
 * 空间级<b>文档</b>的写则是「非查看者成员」（见 RequirementDocService + assertWrite 对 null 项目的口径），
 * 即普通成员能在空间分类下建文档，但不能维护空间分类本身。</p>
 *
 * <p>本期仅支持改名，分类拖拽排序/移动留待后续（update 保留原 parentId）。</p>
 */
@Service
public class DocCategoryService {

    /** 层级安全上限：不限层级，但父链超过此深度按数据异常拒绝，避免脏数据导致死循环 */
    private static final int DEPTH_GUARD = 200;

    private final DocCategoryMapper categoryMapper;
    private final RequirementMapper reqMapper;
    private final ProjectAccessService projectAccess;
    private final AuditService auditService;

    public DocCategoryService(DocCategoryMapper categoryMapper, RequirementMapper reqMapper,
                              ProjectAccessService projectAccess, AuditService auditService) {
        this.categoryMapper = categoryMapper;
        this.reqMapper = reqMapper;
        this.projectAccess = projectAccess;
        this.auditService = auditService;
    }

    /* ---------- 查询 ---------- */

    /** 单个范围的分类树：reqId 空 = 空间级，非空 = 项目级。DFS 顺序扁平列表，带层级。 */
    public List<DocCategoryNode> tree(String workspaceId, String userId, String reqId) {
        String scope = scopeKey(reqId);
        assertViewScope(workspaceId, userId, scope);
        return buildTree(categoryMapper.selectByScope(workspaceId, scope), scope);
    }

    /** 空间下全部可见分类（前端一次取回后按 reqId 分组到项目 / 空间两棵树）。 */
    public List<DocCategoryNode> listAll(String workspaceId, String userId) {
        List<DocCategory> rows = categoryMapper.selectByWorkspace(workspaceId);
        Map<String, List<DocCategory>> byScope = new LinkedHashMap<String, List<DocCategory>>();
        for (DocCategory c : rows) {
            String scope = scopeKey(c.getReqId());
            if (!projectAccess.canView(workspaceId, userId, scope.isEmpty() ? null : scope)) {
                continue;
            }
            List<DocCategory> bucket = byScope.get(scope);
            if (bucket == null) {
                bucket = new ArrayList<DocCategory>();
                byScope.put(scope, bucket);
            }
            bucket.add(c);
        }
        List<DocCategoryNode> out = new ArrayList<DocCategoryNode>();
        for (Map.Entry<String, List<DocCategory>> e : byScope.entrySet()) {
            out.addAll(buildTree(e.getValue(), e.getKey()));
        }
        return out;
    }

    private List<DocCategoryNode> buildTree(List<DocCategory> rows, String scope) {
        Map<String, List<DocCategory>> children = childrenOf(rows);
        List<DocCategoryNode> out = new ArrayList<DocCategoryNode>();
        for (DocCategory root : rootsOf(rows)) {
            appendNode(out, root, children, scope, 1);
        }
        return out;
    }

    private void appendNode(List<DocCategoryNode> out, DocCategory c, Map<String, List<DocCategory>> children,
                            String scope, int level) {
        out.add(nodeOf(c, scope, level));
        List<DocCategory> kids = children.get(c.getId());
        if (kids != null && level < DEPTH_GUARD) {
            for (DocCategory kid : kids) {
                appendNode(out, kid, children, scope, level + 1);
            }
        }
    }

    /** 节点必须存在、属于本空间且属于该范围（供文档保存时校验 categoryId）。 */
    public DocCategory requireNode(String workspaceId, String scope, String categoryId) {
        String id = Texts.trimToNull(categoryId);
        if (id == null) {
            throw AppException.badRequest("请选择分类节点");
        }
        DocCategory c = categoryMapper.selectById(id);
        if (c == null || !workspaceId.equals(c.getWorkspaceId()) || !scope.equals(scopeKey(c.getReqId()))) {
            throw AppException.badRequest("分类节点不存在或不属于该范围：" + id);
        }
        return c;
    }

    /** 文档保存时取分类（不校验权限，权限由文档侧按归属范围判定）；categoryId 为空返回 null。 */
    public DocCategory findForDoc(String workspaceId, String categoryId) {
        String id = Texts.trimToNull(categoryId);
        if (id == null) {
            return null;
        }
        DocCategory c = categoryMapper.selectById(id);
        if (c == null || !workspaceId.equals(c.getWorkspaceId())) {
            throw AppException.badRequest("分类不存在：" + id);
        }
        return c;
    }

    /* ---------- 写入 ---------- */

    @Transactional
    public DocCategoryNode create(String userId, String workspaceId, DocCategorySaveRequest req) {
        String scope = normalizeScope(workspaceId, req.getReqId());
        assertManageScope(workspaceId, userId, scope);
        String name = Texts.cut(Texts.trimToNull(req.getName()), 50);
        if (name == null) {
            throw AppException.badRequest("请填写分类名称");
        }
        List<DocCategory> rows = categoryMapper.selectByScope(workspaceId, scope);
        String parentId = rootKey(req.getParentId());
        int level = 1;
        if (!parentId.isEmpty()) {
            DocCategory parent = requireNode(workspaceId, scope, parentId);
            level = levelOf(parent, rows) + 1;
            if (level > DEPTH_GUARD) {
                throw AppException.badRequest("分类层级过深，请在更浅的节点下新建");
            }
        }
        DocCategory c = new DocCategory();
        c.setId(Ids.gen("DC"));
        c.setWorkspaceId(workspaceId);
        c.setReqId(scope);
        c.setParentId(parentId);
        c.setName(name);
        c.setSortOrder(nextSortOrder(rows, parentId));
        try {
            categoryMapper.insert(c);
        } catch (DuplicateKeyException e) {
            throw AppException.badRequest("同级下已有分类「" + name + "」");
        }
        auditService.recordCurrent(workspaceId, "doc_category_create", "doc_category", c.getId(), name, true,
                "新建文档分类「" + name + "」" + (scope.isEmpty() ? "（空间级）" : "（项目 " + scope + "）")
                        + (parentId.isEmpty() ? "（顶级）" : "（第 " + level + " 级）"), null);
        return nodeOf(c, scope, level);
    }

    /** 改名（本期不支持移动分类：保留原 parentId 与 sortOrder）。 */
    @Transactional
    public DocCategoryNode update(String userId, String workspaceId, String id, DocCategorySaveRequest req) {
        DocCategory c = categoryMapper.selectById(id);
        if (c == null || !workspaceId.equals(c.getWorkspaceId())) {
            throw AppException.notFound("分类节点不存在：" + id);
        }
        String scope = scopeKey(c.getReqId());
        assertManageScope(workspaceId, userId, scope);
        String name = Texts.cut(Texts.trimToNull(req.getName()), 50);
        if (name == null) {
            throw AppException.badRequest("请填写分类名称");
        }
        String oldName = c.getName();
        c.setName(name);
        try {
            categoryMapper.update(c);
        } catch (DuplicateKeyException e) {
            throw AppException.badRequest("同级下已有分类「" + name + "」");
        }
        StringBuilder what = new StringBuilder("编辑文档分类「").append(name).append("」");
        if (!oldName.equals(name)) {
            what.append("，名称由「").append(oldName).append("」修改");
        }
        auditService.recordCurrent(workspaceId, "doc_category_update", "doc_category", id, name, true,
                what.toString(), null);
        List<DocCategory> rows = categoryMapper.selectByScope(workspaceId, scope);
        return nodeOf(c, scope, levelOf(c, rows));
    }

    /** 删除分类：仍有子分类或仍挂着文档时拒绝，避免把归类与文档一并丢掉。 */
    @Transactional
    public void delete(String userId, String workspaceId, String id) {
        DocCategory c = categoryMapper.selectById(id);
        if (c == null || !workspaceId.equals(c.getWorkspaceId())) {
            throw AppException.notFound("分类节点不存在：" + id);
        }
        String scope = scopeKey(c.getReqId());
        assertManageScope(workspaceId, userId, scope);
        int kids = categoryMapper.countChildren(workspaceId, scope, c.getId());
        int docs = categoryMapper.countDocs(workspaceId, c.getId());
        if (kids > 0 || docs > 0) {
            throw AppException.badRequest("分类「" + c.getName() + "」下还有 " + kids + " 个子分类、"
                    + docs + " 篇文档，请先移出或删除后再删分类");
        }
        categoryMapper.delete(workspaceId, id);
        auditService.recordCurrent(workspaceId, "doc_category_delete", "doc_category", id, c.getName(), true,
                "删除文档分类「" + c.getName() + "」", null);
    }

    /** 项目删除时连带清理它的分类（由 RequirementService 调用，空间级分类不受影响）。 */
    @Transactional
    public int deleteByReq(String workspaceId, String reqId) {
        String scope = scopeKey(reqId);
        if (scope.isEmpty()) {
            return 0;
        }
        List<DocCategory> rows = categoryMapper.selectByScope(workspaceId, scope);
        categoryMapper.deleteByReq(workspaceId, scope);
        return rows.size();
    }

    /* ---------- 权限 ---------- */

    private void assertViewScope(String workspaceId, String userId, String scope) {
        projectAccess.assertView(workspaceId, userId, scope.isEmpty() ? null : scope);
    }

    private void assertManageScope(String workspaceId, String userId, String scope) {
        if (scope.isEmpty()) {
            if (!projectAccess.canManage(workspaceId, userId)) {
                throw new AppException(403, "空间级分类仅空间主或管理员可维护");
            }
            return;
        }
        projectAccess.assertWrite(workspaceId, userId, scope);
    }

    /** 空串统一按空间级；非空时必须是本空间的项目。 */
    private String normalizeScope(String workspaceId, String raw) {
        String scope = scopeKey(raw);
        if (scope.isEmpty()) {
            return "";
        }
        Requirement r = reqMapper.selectById(scope);
        if (r == null || !workspaceId.equals(r.getWorkspaceId())) {
            throw AppException.badRequest("所属项目不存在：" + scope);
        }
        return scope;
    }

    /* ---------- 内部：分类规模小，一次取回后在内存里算层级 ---------- */

    private static Map<String, DocCategory> byIdOf(List<DocCategory> rows) {
        Map<String, DocCategory> byId = new LinkedHashMap<String, DocCategory>();
        for (DocCategory c : rows) {
            byId.put(c.getId(), c);
        }
        return byId;
    }

    private static List<DocCategory> rootsOf(List<DocCategory> rows) {
        Map<String, DocCategory> byId = byIdOf(rows);
        List<DocCategory> roots = new ArrayList<DocCategory>();
        for (DocCategory c : rows) {
            String pid = rootKey(c.getParentId());
            if (pid.isEmpty() || !byId.containsKey(pid)) {
                roots.add(c);
            }
        }
        return roots;
    }

    private static Map<String, List<DocCategory>> childrenOf(List<DocCategory> rows) {
        Map<String, DocCategory> byId = byIdOf(rows);
        Map<String, List<DocCategory>> children = new LinkedHashMap<String, List<DocCategory>>();
        for (DocCategory c : rows) {
            String pid = rootKey(c.getParentId());
            if (pid.isEmpty() || !byId.containsKey(pid)) {
                continue;
            }
            List<DocCategory> bucket = children.get(pid);
            if (bucket == null) {
                bucket = new ArrayList<DocCategory>();
                children.put(pid, bucket);
            }
            bucket.add(c);
        }
        return children;
    }

    private static int levelOf(DocCategory node, List<DocCategory> rows) {
        Map<String, DocCategory> byId = byIdOf(rows);
        int level = 1;
        String pid = rootKey(node.getParentId());
        while (!pid.isEmpty() && level <= DEPTH_GUARD) {
            DocCategory parent = byId.get(pid);
            if (parent == null) {
                break;
            }
            level++;
            pid = rootKey(parent.getParentId());
        }
        return level;
    }

    private static int nextSortOrder(List<DocCategory> rows, String parentId) {
        int max = -1;
        for (DocCategory c : rows) {
            if (parentId.equals(rootKey(c.getParentId()))) {
                max = Math.max(max, c.getSortOrder() == null ? 0 : c.getSortOrder());
            }
        }
        return max + 1;
    }

    private static DocCategoryNode nodeOf(DocCategory c, String scope, int level) {
        DocCategoryNode node = new DocCategoryNode();
        node.setId(c.getId());
        node.setReqId(scope);
        node.setParentId(rootKey(c.getParentId()));
        node.setName(c.getName());
        node.setLevel(level);
        node.setSortOrder(c.getSortOrder() == null ? 0 : c.getSortOrder());
        return node;
    }

    private static String rootKey(String parentId) {
        String s = Texts.trimToNull(parentId);
        return s == null ? "" : s;
    }

    private static String scopeKey(String reqId) {
        String s = Texts.trimToNull(reqId);
        return s == null ? "" : s;
    }
}