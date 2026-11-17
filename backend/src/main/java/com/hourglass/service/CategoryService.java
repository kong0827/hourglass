package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.common.Ids;
import com.hourglass.common.Texts;
import com.hourglass.dto.CaseModuleNode;
import com.hourglass.dto.CategoryRequest;
import com.hourglass.entity.Category;
import com.hourglass.entity.Requirement;
import com.hourglass.mapper.CategoryMapper;
import com.hourglass.mapper.RequirementMapper;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * 项目分类树：任务、需求、用例共用同一棵树（单归属，不限层级，仅防环）。
 * 用例通过 test_case.module_id 挂在唯一节点上，计数不重复；多归属的「自定义分组」由
 * CaseSetService 承载，两者语义不同，不共用一张表。
 */
@Service
public class CategoryService {

    private static final Pattern COLOR = Pattern.compile("^#[0-9a-fA-F]{6}$");
    private static final String DEFAULT_COLOR = "#8a8578";
    /** 新建项目时预置的默认分类名，保证项目从一开始就能按分类归类工作项 */
    public static final String DEFAULT_MODULE_NAME = "其他";

    private final CategoryMapper categoryMapper;
    private final RequirementMapper requirementMapper;
    private final ActivityService activityService;
    /** 删分类会批量改任务所属分类：为受影响任务补时间线 */
    private final DeletionTraceService deletionTrace;
    private final ProjectAccessService projectAccess;
    private final ReleasePermissionService releasePermission;
    /** 树节点计数与删除前守卫：用例是分类的主要使用者 */
    private final com.hourglass.mapper.TestCaseMapper caseMapper;
    /** 动态分组规则会引用分类节点：删除前必须拦住，否则规则读取时失效 */
    private final com.hourglass.mapper.CaseSetMapper setMapper;
    /** 分类列表缓存（空间全量，按项目内存过滤）：读列表/删除时选目标节点共用，写入口负责失效 */
    private final WorkspaceMetaCache metaCache;

    public CategoryService(CategoryMapper categoryMapper, RequirementMapper requirementMapper,
                           ActivityService activityService, DeletionTraceService deletionTrace,
                           ProjectAccessService projectAccess,
                           ReleasePermissionService releasePermission, WorkspaceMetaCache metaCache,
                           com.hourglass.mapper.TestCaseMapper caseMapper,
                           com.hourglass.mapper.CaseSetMapper setMapper) {
        this.categoryMapper = categoryMapper;
        this.requirementMapper = requirementMapper;
        this.activityService = activityService;
        this.deletionTrace = deletionTrace;
        this.projectAccess = projectAccess;
        this.releasePermission = releasePermission;
        this.metaCache = metaCache;
        this.caseMapper = caseMapper;
        this.setMapper = setMapper;
    }

    /** projectId 为空返回空间内全部项目的分类（跨项目展示/筛选），否则只返回该项目清单 */
    public List<Category> list(String workspaceId, String projectId) {
        List<Category> all = metaCache.categories(workspaceId);
        if (projectId == null || projectId.trim().isEmpty()) {
            return all;
        }
        List<Category> out = new ArrayList<Category>();
        for (Category c : all) {
            if (projectId.equals(c.getProjectId())) {
                out.add(c);
            }
        }
        return out;
    }

    /** 分类树：DFS 顺序的扁平列表，带层级、直接挂载数与子树合计（用例计数） */
    public List<CaseModuleNode> tree(String workspaceId, String userId, String projectId) {
        Requirement project = requireProject(workspaceId, projectId);
        projectAccess.assertView(workspaceId, userId, project.getId());
        List<Category> rows = categoryMapper.selectByProject(workspaceId, projectId);
        Map<String, Integer> counts = new HashMap<String, Integer>();
        for (Map<String, Object> row : caseMapper.countFacetsByModuleId(workspaceId, projectId)) {
            counts.put(String.valueOf(row.get("k")), ((Number) row.get("cnt")).intValue());
        }
        Map<String, List<Category>> children = childrenOf(rows);
        List<CaseModuleNode> out = new ArrayList<CaseModuleNode>();
        for (Category root : rootsOf(rows)) {
            appendNode(out, root, children, counts, 1);
        }
        return out;
    }

    private int appendNode(List<CaseModuleNode> out, Category node, Map<String, List<Category>> children,
                           Map<String, Integer> counts, int level) {
        CaseModuleNode view = new CaseModuleNode();
        view.setId(node.getId());
        view.setParentId(rootKey(node.getParentId()));
        view.setName(node.getName());
        view.setLevel(level);
        view.setSortOrder(node.getSortOrder() == null ? 0 : node.getSortOrder());
        Integer own = counts.get(node.getId());
        view.setCaseCount(own == null ? 0 : own);
        out.add(view);
        int subtree = view.getCaseCount();
        List<Category> kids = children.get(node.getId());
        if (kids != null) {
            for (Category kid : kids) {
                subtree += appendNode(out, kid, children, counts, level + 1);
            }
        }
        view.setSubtreeCount(subtree);
        return subtree;
    }

    /** 按 ID 取节点（项目由节点自身带出），供适配层做审计与层级计算 */
    public Category requireNodeById(String workspaceId, String categoryId) {
        Category c = categoryMapper.selectById(workspaceId, categoryId);
        if (c == null) {
            throw AppException.notFound("分类不存在：" + categoryId);
        }
        return c;
    }

    /** 节点必须存在且属于该项目 */
    public Category requireNode(String workspaceId, String projectId, String categoryId) {
        String id = Texts.trimToNull(categoryId);
        if (id == null) {
            throw AppException.badRequest("请选择分类节点");
        }
        Category c = categoryMapper.selectById(workspaceId, id);
        if (c == null || !workspaceId.equals(c.getWorkspaceId()) || !projectId.equals(c.getProjectId())) {
            throw AppException.badRequest("分类节点不存在或不属于该项目：" + id);
        }
        return c;
    }

    /** 分类筛选范围：本节点 +（可选）全部子节点 */
    public List<String> scopeIds(String workspaceId, String projectId, String categoryId, boolean includeSub) {
        Category node = requireNode(workspaceId, projectId, categoryId);
        List<String> ids = new ArrayList<String>();
        ids.add(node.getId());
        if (includeSub) {
            Map<String, List<Category>> children = childrenOf(categoryMapper.selectByProject(workspaceId, projectId));
            collectDescendants(node.getId(), children, ids);
        }
        return ids;
    }

    private static void collectDescendants(String parentId, Map<String, List<Category>> children, List<String> out) {
        List<Category> kids = children.get(parentId);
        if (kids == null) {
            return;
        }
        for (Category kid : kids) {
            if (!out.contains(kid.getId())) {
                out.add(kid.getId());
                collectDescendants(kid.getId(), children, out);
            }
        }
    }

    /**
     * 用例保存时的归属解析：给了节点就用节点；只给自由文本（旧客户端 / CSV / AI 生成）
     * 就按名称找节点（优先顶级，再全树同名），找不到补建顶级节点。
     */
    @Transactional
    public Category resolveForCase(String workspaceId, String projectId, String categoryId, String moduleText) {
        String id = Texts.trimToNull(categoryId);
        if (id != null) {
            return requireNode(workspaceId, projectId, id);
        }
        String name = Texts.trimToNull(moduleText);
        if (name == null) {
            return null;
        }
        name = Texts.cut(name, 50);
        Category found = categoryMapper.selectByName(workspaceId, projectId, "", name);
        if (found == null) {
            for (Category row : categoryMapper.selectByProject(workspaceId, projectId)) {
                if (name.equals(row.getName())) {
                    found = row;
                    break;
                }
            }
        }
        if (found != null) {
            return found;
        }
        Category c = new Category();
        c.setId(Ids.gen("G"));
        c.setWorkspaceId(workspaceId);
        c.setProjectId(projectId);
        c.setParentId("");
        c.setName(name);
        c.setColor(DEFAULT_COLOR);
        c.setSortOrder(categoryMapper.maxSortOrder(workspaceId, projectId, "") + 1);
        try {
            categoryMapper.insert(c);
        } catch (DuplicateKeyException e) {
            return categoryMapper.selectByName(workspaceId, projectId, "", name);
        }
        evictCategories(workspaceId);
        return c;
    }

    @Transactional
    public Category create(String workspaceId, String userId, String projectId, CategoryRequest req) {
        Requirement project = requireProject(workspaceId, projectId);
        projectAccess.assertWrite(workspaceId, userId, project.getId());
        String parentId = rootKey(req.getParentId());
        if (!parentId.isEmpty()) {
            requireNode(workspaceId, project.getId(), parentId);
        }
        String name = cleanName(req.getName());
        if (categoryMapper.selectByName(workspaceId, project.getId(), parentId, name) != null) {
            throw new AppException(409, "同级下已有分类：" + name);
        }
        Category c = new Category();
        c.setId(Ids.gen("G"));
        c.setWorkspaceId(workspaceId);
        c.setProjectId(project.getId());
        c.setParentId(parentId);
        c.setName(name);
        c.setColor(normalizeColor(req.getColor()));
        c.setSortOrder(categoryMapper.maxSortOrder(workspaceId, project.getId(), parentId) + 1);
        categoryMapper.insert(c);
        evictCategories(workspaceId);
        activityService.logConfig(workspaceId, "新建项目「" + project.getName() + "」分类「" + c.getName() + "」"
                + (parentId.isEmpty() ? "（顶级）" : "（上级："
                + requireNode(workspaceId, project.getId(), parentId).getName() + "）"));
        return categoryMapper.selectById(workspaceId, c.getId());
    }

    /** 新建项目时预置默认分类（系统行为，不记审计） */
    @Transactional
    public void createDefault(String workspaceId, String projectId) {
        Category c = new Category();
        c.setId(Ids.gen("G"));
        c.setWorkspaceId(workspaceId);
        c.setProjectId(projectId);
        c.setParentId("");
        c.setName(DEFAULT_MODULE_NAME);
        c.setColor(DEFAULT_COLOR);
        c.setSortOrder(0);
        try {
            categoryMapper.insert(c);
        } catch (Exception ignored) {
            // 同名冲突（导入恢复等场景已存在）时跳过，保持幂等
        }
        evictCategories(workspaceId);
    }

    @Transactional
    public Category update(String workspaceId, String userId, String id, CategoryRequest req) {
        Category c = categoryMapper.selectById(workspaceId, id);
        if (c == null) {
            throw AppException.notFound("分类不存在：" + id);
        }
        projectAccess.assertWrite(workspaceId, userId, c.getProjectId());
        String name = cleanName(req.getName());
        /* 旧客户端只提交名称 / 颜色：parentId 缺省表示保持原父级 */
        String parentId = req.getParentId() == null ? rootKey(c.getParentId()) : rootKey(req.getParentId());
        if (parentId.equals(c.getId())) {
            throw AppException.badRequest("分类不能挂到自己下面");
        }
        if (!parentId.isEmpty()) {
            requireNode(workspaceId, c.getProjectId(), parentId);
            assertNoCycle(c, parentId, categoryMapper.selectByProject(workspaceId, c.getProjectId()));
        }
        if (!name.equals(c.getName()) || !parentId.equals(rootKey(c.getParentId()))) {
            Category other = categoryMapper.selectByName(workspaceId, c.getProjectId(), parentId, name);
            if (other != null && !other.getId().equals(id)) {
                throw new AppException(409, "同级下已有分类：" + name);
            }
        }
        String oldName = c.getName();
        String oldParent = rootKey(c.getParentId());
        boolean moved = !oldParent.equals(parentId);
        c.setName(name);
        c.setParentId(parentId);
        /* 只改名称 / 父级时不动颜色 */
        if (Texts.trimToNull(req.getColor()) != null) {
            c.setColor(normalizeColor(req.getColor()));
        }
        if (moved) {
            c.setSortOrder(categoryMapper.maxSortOrder(workspaceId, c.getProjectId(), parentId) + 1);
        }
        categoryMapper.update(c);
        /* 用例的 module 文本是节点名快照：改名后同步，避免列表还显示旧名 */
        if (!oldName.equals(name)) {
            caseMapper.updateModuleSnapshot(workspaceId, id, name);
        }
        evictCategories(workspaceId);
        StringBuilder what = new StringBuilder("项目「" + projectName(workspaceId, c.getProjectId())
                + "」分类「" + oldName + "」");
        if (!oldName.equals(name)) {
            what.append("改名为「").append(name).append("」");
        }
        if (moved) {
            what.append(what.toString().endsWith("」") ? "，" : "").append("调整了上级分类");
        }
        activityService.logConfig(workspaceId, what.toString());
        return categoryMapper.selectById(workspaceId, id);
    }

    /**
     * 删除分类：空间主 / 管理员 / 项目负责人。仍有子分类或动态规则引用时拒绝；
     * 有任务 / 需求 / 用例时迁到 targetId（缺省取项目内其他节点），避免归类与证据孤立。
     */
    @Transactional
    public void delete(String workspaceId, String userId, String id, String targetId) {
        Category c = categoryMapper.selectById(workspaceId, id);
        if (c == null) {
            throw AppException.notFound("分类不存在：" + id);
        }
        assertManage(workspaceId, userId, c.getProjectId());
        int kids = categoryMapper.countChildren(workspaceId, c.getProjectId(), c.getId());
        if (kids > 0) {
            throw AppException.badRequest("分类「" + c.getName() + "」下还有 " + kids
                    + " 个子分类，请先移走或删除子分类");
        }
        List<String> rules = setMapper.selectDynamicNamesByModule(workspaceId, c.getProjectId(), c.getId());
        if (!rules.isEmpty()) {
            throw AppException.badRequest("分类「" + c.getName() + "」被动态分组「" + rules.get(0)
                    + "」的收录规则引用，请先编辑该分组规则");
        }
        int cases = caseMapper.countByModuleId(workspaceId, c.getId());
        int tasks = categoryMapper.countTasksByCategory(workspaceId, c.getProjectId(), c.getId());
        int demands = categoryMapper.countDemandsByCategory(workspaceId, c.getProjectId(), c.getId());
        boolean hasContent = cases + tasks + demands > 0;
        Category target = null;
        if (targetId != null) {
            target = categoryMapper.selectById(workspaceId, targetId);
            if (target == null || !c.getProjectId().equals(target.getProjectId()) || id.equals(targetId)) {
                throw AppException.badRequest("迁移目标分类不存在或不属于该项目：" + targetId);
            }
        } else if (hasContent) {
            for (Category other : metaCache.categories(workspaceId)) {
                if (!other.getId().equals(id) && c.getProjectId().equals(other.getProjectId())) {
                    target = other;
                    break;
                }
            }
            if (target == null) {
                throw AppException.badRequest("请先选择迁移目标分类");
            }
        }
        String targetName = target == null ? null : target.getName();
        List<String> affectedTaskIds = categoryMapper.selectTaskIdsForCascade(
                workspaceId, c.getProjectId(), id);
        int movedTasks = target == null ? 0
                : categoryMapper.moveTasksToCategory(workspaceId, c.getProjectId(), id, target.getId());
        int movedDemands = target == null ? 0
                : categoryMapper.moveDemandsToCategory(workspaceId, c.getProjectId(), id, target.getId());
        int movedCases = target == null ? 0
                : caseMapper.moveCasesToModule(workspaceId, id, target.getId(), target.getName());
        categoryMapper.deleteById(workspaceId, id);
        if (target != null) {
            deletionTrace.logTaskCascade(workspaceId, userId, affectedTaskIds,
                    "因删除分类「" + c.getName() + "」，自动改到「" + targetName + "」");
        }
        evictCategories(workspaceId);
        String migration = target == null
                ? "，该分类没有工作项、需求与用例"
                : "，其下 " + movedTasks + " 个工作项、" + movedDemands + " 个需求、"
                + movedCases + " 条用例已改到「" + targetName + "」";
        activityService.logConfig(workspaceId, "项目「" + projectName(workspaceId, c.getProjectId())
                + "」删除分类「" + c.getName() + "」" + migration);
    }

    /** 项目删除时随项目清理：清空其下任务的分类引用并删除分类树（需求已随项目删除） */
    @Transactional
    public void purgeProject(String workspaceId, String projectId) {
        categoryMapper.clearTasksCategory(workspaceId, projectId);
        categoryMapper.deleteByProject(workspaceId, projectId);
        evictCategories(workspaceId);
    }

    /**
     * 同级排序：传 parentId 时要求 ids 恰好是该父级的全部直接子节点；
     * 不传 parentId（旧任务模块面板）时沿用整项目排序，assign 全局递增序号。
     */
    @Transactional
    public void order(String workspaceId, String userId, String projectId, String parentId, List<String> ids) {
        Requirement project = requireProject(workspaceId, projectId);
        projectAccess.assertWrite(workspaceId, userId, projectId);
        List<Category> all = categoryMapper.selectByProject(workspaceId, projectId);
        /* parentId 缺省（null）= 旧调用按整项目排序；显式传空串才是「顶级分类」同级排序 */
        String parentKey = parentId == null ? null : rootKey(parentId);
        Set<String> known = new HashSet<String>();
        for (Category c : all) {
            if (parentKey == null || parentKey.equals(rootKey(c.getParentId()))) {
                known.add(c.getId());
            }
        }
        Set<String> unique = new HashSet<String>(ids);
        if (unique.size() != ids.size() || ids.size() != known.size() || !known.containsAll(ids)) {
            throw AppException.badRequest(parentKey == null
                    ? "排序列表与现有分类不一致" : "排序列表与同级分类不一致");
        }
        for (int i = 0; i < ids.size(); i++) {
            categoryMapper.updateSortOrder(workspaceId, ids.get(i), i);
        }
        evictCategories(workspaceId);
        activityService.logConfig(workspaceId, "调整项目「" + project.getName() + "」的分类顺序");
    }

    /** 删除口径：空间主 / 管理员，或该项目负责人；写成员可建、改名、换父级与排序 */
    public void assertManage(String workspaceId, String userId, String projectId) {
        projectAccess.assertView(workspaceId, userId, projectId);
        if (!releasePermission.canManageProject(userId, workspaceId, projectId)) {
            throw new AppException(403, "仅空间主、管理员或项目负责人可删除项目分类");
        }
    }

    private void assertNoCycle(Category node, String newParentId, List<Category> rows) {
        Map<String, Category> byId = byIdOf(rows);
        String cursor = newParentId;
        int guard = 0;
        while (!cursor.isEmpty() && guard++ <= rows.size()) {
            if (cursor.equals(node.getId())) {
                throw AppException.badRequest("分类不能挂到自己的子分类下");
            }
            Category up = byId.get(cursor);
            cursor = up == null ? "" : rootKey(up.getParentId());
        }
    }

    /** 校验项目存在且属于该空间，返回项目实体 */
    private Requirement requireProject(String workspaceId, String projectId) {
        Requirement r = requirementMapper.selectById(projectId);
        if (r == null || !workspaceId.equals(r.getWorkspaceId())) {
            throw AppException.badRequest("所属项目不存在：" + projectId);
        }
        return r;
    }

    private String projectName(String workspaceId, String projectId) {
        Requirement r = requirementMapper.selectById(projectId);
        return r != null && workspaceId.equals(r.getWorkspaceId()) ? r.getName() : projectId;
    }

    private void evictCategories(String workspaceId) {
        metaCache.evictCategories(workspaceId);
        CacheSync.evictAfterCommitOrNow(() -> metaCache.evictCategories(workspaceId));
    }

    /** 分类名会拼接进筛选参数（逗号分隔），不允许含逗号 */
    private String cleanName(String raw) {
        String name = raw == null ? "" : raw.replace(',', ' ').replace('，', ' ').trim();
        name = Texts.cut(name, 50);
        if (name.isEmpty()) {
            throw AppException.badRequest("分类名称不能为空");
        }
        return name;
    }

    private String normalizeColor(String color) {
        String c = Texts.trimToNull(color);
        return c != null && COLOR.matcher(c).matches() ? c : DEFAULT_COLOR;
    }

    /* ---------- 内部：分类规模小，一次取回后在内存里算层级 ---------- */

    private static Map<String, Category> byIdOf(List<Category> rows) {
        Map<String, Category> byId = new LinkedHashMap<String, Category>();
        for (Category c : rows) {
            byId.put(c.getId(), c);
        }
        return byId;
    }

    private static List<Category> rootsOf(List<Category> rows) {
        Map<String, Category> byId = byIdOf(rows);
        List<Category> roots = new ArrayList<Category>();
        for (Category c : rows) {
            String pid = rootKey(c.getParentId());
            if (pid.isEmpty() || !byId.containsKey(pid)) {
                roots.add(c);
            }
        }
        return roots;
    }

    private static Map<String, List<Category>> childrenOf(List<Category> rows) {
        Map<String, Category> byId = byIdOf(rows);
        Map<String, List<Category>> children = new LinkedHashMap<String, List<Category>>();
        for (Category c : rows) {
            String pid = rootKey(c.getParentId());
            if (pid.isEmpty() || !byId.containsKey(pid)) {
                continue;
            }
            List<Category> bucket = children.get(pid);
            if (bucket == null) {
                bucket = new ArrayList<Category>();
                children.put(pid, bucket);
            }
            bucket.add(c);
        }
        return children;
    }

    private static String rootKey(String parentId) {
        String s = Texts.trimToNull(parentId);
        return s == null ? "" : s;
    }
}
