package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.common.Ids;
import com.hourglass.common.Texts;
import com.hourglass.dto.CategoryRequest;
import com.hourglass.entity.Category;
import com.hourglass.entity.Requirement;
import com.hourglass.mapper.CategoryMapper;
import com.hourglass.mapper.RequirementMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;

@Service
public class CategoryService {

    private static final Pattern COLOR = Pattern.compile("^#[0-9a-fA-F]{6}$");
    private static final String DEFAULT_COLOR = "#8a8578";
    /** 新建项目时预置的默认模块名，保证项目从一开始就能按模块归类工作项 */
    public static final String DEFAULT_MODULE_NAME = "其他";

    private final CategoryMapper categoryMapper;
    private final RequirementMapper requirementMapper;
    private final ActivityService activityService;
    /** 模块列表缓存（空间全量，按项目内存过滤）：读列表/删除时选目标模块共用，写入口负责失效 */
    private final WorkspaceMetaCache metaCache;

    public CategoryService(CategoryMapper categoryMapper, RequirementMapper requirementMapper,
                           ActivityService activityService, WorkspaceMetaCache metaCache) {
        this.categoryMapper = categoryMapper;
        this.requirementMapper = requirementMapper;
        this.activityService = activityService;
        this.metaCache = metaCache;
    }

    /** projectId 为空返回空间内全部项目的模块（跨项目展示/筛选），否则只返回该项目清单 */
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

    @Transactional
    public Category create(String workspaceId, String projectId, CategoryRequest req) {
        Requirement project = requireProject(workspaceId, projectId);
        String name = cleanName(req.getName());
        if (categoryMapper.selectByName(workspaceId, projectId, name) != null) {
            throw new AppException(409, "已存在同名模块：" + name);
        }
        Category c = new Category();
        c.setId(Ids.gen("G"));
        c.setWorkspaceId(workspaceId);
        c.setProjectId(project.getId());
        c.setName(Texts.cut(name, 12));
        c.setColor(normalizeColor(req.getColor()));
        c.setSortOrder(categoryMapper.maxSortOrder(workspaceId, projectId) + 1);
        categoryMapper.insert(c);
        evictCategories(workspaceId);
        return categoryMapper.selectById(workspaceId, c.getId());
    }

    /** 新建项目时预置默认模块（系统行为，不记审计） */
    @Transactional
    public void createDefault(String workspaceId, String projectId) {
        Category c = new Category();
        c.setId(Ids.gen("G"));
        c.setWorkspaceId(workspaceId);
        c.setProjectId(projectId);
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
    public Category update(String workspaceId, String id, CategoryRequest req) {
        Category c = categoryMapper.selectById(workspaceId, id);
        if (c == null) {
            throw AppException.notFound("模块不存在：" + id);
        }
        String name = cleanName(req.getName());
        if (!name.equals(c.getName())) {
            Category other = categoryMapper.selectByName(workspaceId, c.getProjectId(), name);
            if (other != null && !other.getId().equals(id)) {
                throw new AppException(409, "已存在同名模块：" + name);
            }
            String oldName = c.getName();
            /* 关联只认 ID：改名不再回刷任务/需求，展示名一律经模块字典解析 */
            c.setName(name);
            /* O-9：配置变更留审计（活动流可见） */
            activityService.logConfig(workspaceId,
                    "项目「" + projectName(workspaceId, c.getProjectId()) + "」模块改名「" + oldName + "」→「" + name + "」");
        }
        c.setColor(normalizeColor(req.getColor()));
        categoryMapper.update(c);
        evictCategories(workspaceId);
        return categoryMapper.selectById(workspaceId, id);
    }

    /** 删除项目模块：该项目下任务与需求迁到指定模块；未指定时迁到项目内最靠前的其他模块（至少保留一个） */
    @Transactional
    public void delete(String workspaceId, String id, String targetId) {
        Category c = categoryMapper.selectById(workspaceId, id);
        if (c == null) {
            throw AppException.notFound("模块不存在：" + id);
        }
        Category targetCat = null;
        for (Category other : metaCache.categories(workspaceId)) {
            if (other.getId().equals(id) || !c.getProjectId().equals(other.getProjectId())) {
                continue;
            }
            if (targetId != null) {
                if (other.getId().equals(targetId)) {
                    targetCat = other;
                    break;
                }
            } else if (targetCat == null) {
                targetCat = other;
            }
        }
        if (targetId != null && targetCat == null) {
            throw AppException.badRequest("迁移目标模块不存在或不属于该项目：" + targetId);
        }
        if (targetCat == null) {
            throw AppException.badRequest("至少需要保留一个模块");
        }
        categoryMapper.moveTasksToCategory(workspaceId, c.getProjectId(), id, targetCat.getId());
        categoryMapper.moveDemandsToCategory(workspaceId, c.getProjectId(), id, targetCat.getId());
        categoryMapper.deleteById(workspaceId, id);
        evictCategories(workspaceId);
        /* O-9：破坏性配置变更留审计（活动流可见） */
        activityService.logConfig(workspaceId,
                "项目「" + projectName(workspaceId, c.getProjectId()) + "」删除模块「" + c.getName()
                        + "」，其下任务与需求已改到「" + targetCat.getName() + "」");
    }

    /** 项目删除时随项目清理：清空其下任务的模块引用并删除模块清单（需求已随项目删除） */
    @Transactional
    public void purgeProject(String workspaceId, String projectId) {
        categoryMapper.clearTasksCategory(workspaceId, projectId);
        categoryMapper.deleteByProject(workspaceId, projectId);
        evictCategories(workspaceId);
    }

    @Transactional
    public void order(String workspaceId, String projectId, List<String> ids) {
        requireProject(workspaceId, projectId);
        List<Category> all = metaCache.categories(workspaceId);
        Set<String> known = new HashSet<String>();
        for (Category c : all) {
            if (projectId.equals(c.getProjectId())) {
                known.add(c.getId());
            }
        }
        Set<String> unique = new HashSet<String>(ids);
        if (unique.size() != ids.size() || ids.size() != known.size() || !known.containsAll(ids)) {
            throw AppException.badRequest("排序列表与现有模块不一致");
        }
        for (int i = 0; i < ids.size(); i++) {
            categoryMapper.updateSortOrder(workspaceId, ids.get(i), i);
        }
        evictCategories(workspaceId);
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

    /** 模块名会拼接进筛选参数（逗号分隔），不允许含逗号 */
    private String cleanName(String raw) {
        String name = raw == null ? "" : raw.replace(',', ' ').replace('，', ' ').trim();
        name = Texts.cut(name, 12);
        if (name.isEmpty()) {
            throw AppException.badRequest("模块名称不能为空");
        }
        return name;
    }

    private String normalizeColor(String color) {
        String c = Texts.trimToNull(color);
        return c != null && COLOR.matcher(c).matches() ? c : DEFAULT_COLOR;
    }
}
