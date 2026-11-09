package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.common.Ids;
import com.hourglass.common.Texts;
import com.hourglass.dto.CategoryRequest;
import com.hourglass.entity.Category;
import com.hourglass.mapper.CategoryMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;

@Service
public class CategoryService {

    private static final Pattern COLOR = Pattern.compile("^#[0-9a-fA-F]{6}$");
    private static final String DEFAULT_COLOR = "#8a8578";

    private final CategoryMapper categoryMapper;
    private final ActivityService activityService;
    /** 模块列表缓存：读列表/删除时选目标模块共用，写入口负责失效 */
    private final WorkspaceMetaCache metaCache;

    public CategoryService(CategoryMapper categoryMapper, ActivityService activityService,
                           WorkspaceMetaCache metaCache) {
        this.categoryMapper = categoryMapper;
        this.activityService = activityService;
        this.metaCache = metaCache;
    }

    public List<Category> list(String workspaceId) {
        return metaCache.categories(workspaceId);
    }

    @Transactional
    public Category create(String workspaceId, CategoryRequest req) {
        String name = cleanName(req.getName());
        if (categoryMapper.selectByName(workspaceId, name) != null) {
            throw new AppException(409, "已存在同名模块：" + name);
        }
        Category c = new Category();
        c.setId(Ids.gen("G"));
        c.setWorkspaceId(workspaceId);
        c.setName(Texts.cut(name, 12));
        c.setColor(normalizeColor(req.getColor()));
        c.setSortOrder(categoryMapper.maxSortOrder(workspaceId) + 1);
        categoryMapper.insert(c);
        evictCategories(workspaceId);
        return categoryMapper.selectById(workspaceId, c.getId());
    }

    @Transactional
    public Category update(String workspaceId, String id, CategoryRequest req) {
        Category c = categoryMapper.selectById(workspaceId, id);
        if (c == null) {
            throw AppException.notFound("模块不存在：" + id);
        }
        String name = cleanName(req.getName());
        if (!name.equals(c.getName())) {
            Category other = categoryMapper.selectByName(workspaceId, name);
            if (other != null && !other.getId().equals(id)) {
                throw new AppException(409, "已存在同名模块：" + name);
            }
            String oldName = c.getName();
            categoryMapper.renameInTasks(workspaceId, oldName, name);
            categoryMapper.renameInDemands(workspaceId, oldName, name);
            c.setName(name);
            /* O-9：配置变更留审计（活动流可见） */
            activityService.logConfig(workspaceId,
                    "模块改名「" + oldName + "」→「" + name + "」，其下任务与需求已同步");
        }
        c.setColor(normalizeColor(req.getColor()));
        categoryMapper.update(c);
        evictCategories(workspaceId);
        return categoryMapper.selectById(workspaceId, id);
    }

    /** 删除模块：其下任务与需求迁到指定模块；未指定时迁到最靠前的其他模块（至少保留一个） */
    @Transactional
    public void delete(String workspaceId, String id, String targetId) {
        Category c = categoryMapper.selectById(workspaceId, id);
        if (c == null) {
            throw AppException.notFound("模块不存在：" + id);
        }
        Category targetCat = null;
        for (Category other : metaCache.categories(workspaceId)) {
            if (other.getId().equals(id)) continue;
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
            throw AppException.badRequest("迁移目标模块不存在或不属于该空间：" + targetId);
        }
        if (targetCat == null) {
            throw AppException.badRequest("至少需要保留一个模块");
        }
        String target = targetCat.getName();
        categoryMapper.renameInTasks(workspaceId, c.getName(), target);
        categoryMapper.renameInDemands(workspaceId, c.getName(), target);
        categoryMapper.deleteById(workspaceId, id);
        evictCategories(workspaceId);
        /* O-9：破坏性配置变更留审计（活动流可见） */
        activityService.logConfig(workspaceId,
                "删除模块「" + c.getName() + "」，其下任务与需求已改到「" + target + "」");
    }

    @Transactional
    public void order(String workspaceId, List<String> ids) {
        Set<String> known = new HashSet<String>();
        for (Category c : metaCache.categories(workspaceId)) {
            known.add(c.getId());
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
