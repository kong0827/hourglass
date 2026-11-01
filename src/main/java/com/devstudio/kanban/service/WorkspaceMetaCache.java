package com.devstudio.kanban.service;

import com.devstudio.kanban.entity.BoardColumn;
import com.devstudio.kanban.entity.Category;
import com.devstudio.kanban.entity.TagCount;
import com.devstudio.kanban.mapper.BoardColumnMapper;
import com.devstudio.kanban.mapper.CategoryMapper;
import com.devstudio.kanban.mapper.TagMapper;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.LongSupplier;

/**
 * 空间 meta 缓存：看板列 / 分类 / 标签，按空间 + WorkspaceVersionService 版本号失效。
 *
 * <p>写请求成功后版本号自增，下一次读取自然重新加载；另外各写入口会主动失效，
 * 版本号没来得及 bump（如不带 workspace 参数的写请求）时也不会长期陈旧。
 * TTL 只是兜底上限（默认 300 秒），不是主要失效手段。</p>
 *
 * <p>进程内、单实例：多实例部署时其它实例的写操作不会 bump 本实例的版本号，
 * meta 最多延迟一个兜底 TTL。返回的列表是只读副本，调用方改动不会污染缓存。</p>
 */
@Service
public class WorkspaceMetaCache {

    private final BoardColumnMapper boardColumnMapper;
    private final CategoryMapper categoryMapper;
    private final TagMapper tagMapper;
    private final WorkspaceVersionService versionService;
    private final long ttlMillis;
    private final LongSupplier clock;

    private final Map<String, Entry<List<BoardColumn>>> columns =
            new ConcurrentHashMap<String, Entry<List<BoardColumn>>>();
    private final Map<String, Entry<List<Category>>> categories =
            new ConcurrentHashMap<String, Entry<List<Category>>>();
    private final Map<String, Entry<List<TagCount>>> tags =
            new ConcurrentHashMap<String, Entry<List<TagCount>>>();

    @Autowired
    public WorkspaceMetaCache(BoardColumnMapper boardColumnMapper, CategoryMapper categoryMapper,
                              TagMapper tagMapper, WorkspaceVersionService versionService,
                              @Value("${app.cache.meta-ttl-seconds:300}") long ttlSeconds) {
        this(boardColumnMapper, categoryMapper, tagMapper, versionService,
                Math.max(0L, ttlSeconds) * 1000L, System::currentTimeMillis);
    }

    WorkspaceMetaCache(BoardColumnMapper boardColumnMapper, CategoryMapper categoryMapper,
                       TagMapper tagMapper, WorkspaceVersionService versionService,
                       long ttlMillis, LongSupplier clock) {
        this.boardColumnMapper = boardColumnMapper;
        this.categoryMapper = categoryMapper;
        this.tagMapper = tagMapper;
        this.versionService = versionService;
        this.ttlMillis = ttlMillis;
        this.clock = clock;
    }

    public List<BoardColumn> columns(String workspaceId) {
        if (workspaceId == null) {
            return copyColumns(boardColumnMapper.selectAll(null));
        }
        Entry<List<BoardColumn>> e = columns.get(workspaceId);
        long version = versionService.version(workspaceId);
        long now = clock.getAsLong();
        if (e != null && e.version == version && now < e.expiresAt) {
            return copyColumns(e.value);
        }
        List<BoardColumn> loaded = boardColumnMapper.selectAll(workspaceId);
        columns.put(workspaceId, new Entry<List<BoardColumn>>(version, now + ttlMillis, loaded));
        return copyColumns(loaded);
    }

    /** 按 id 取列定义（只读副本）；找不到返回 null */
    public BoardColumn column(String workspaceId, String columnId) {
        if (columnId == null) {
            return null;
        }
        for (BoardColumn c : columns(workspaceId)) {
            if (columnId.equals(c.getId())) {
                BoardColumn copy = new BoardColumn();
                BeanUtils.copyProperties(c, copy);
                return copy;
            }
        }
        return null;
    }

    public List<Category> categories(String workspaceId) {
        if (workspaceId == null) {
            return copyCategories(categoryMapper.selectByWorkspace(null));
        }
        Entry<List<Category>> e = categories.get(workspaceId);
        long version = versionService.version(workspaceId);
        long now = clock.getAsLong();
        if (e != null && e.version == version && now < e.expiresAt) {
            return copyCategories(e.value);
        }
        List<Category> loaded = categoryMapper.selectByWorkspace(workspaceId);
        categories.put(workspaceId, new Entry<List<Category>>(version, now + ttlMillis, loaded));
        return copyCategories(loaded);
    }

    public List<TagCount> tags(String workspaceId) {
        if (workspaceId == null) {
            return copyTags(tagMapper.selectAllWithCount(null));
        }
        Entry<List<TagCount>> e = tags.get(workspaceId);
        long version = versionService.version(workspaceId);
        long now = clock.getAsLong();
        if (e != null && e.version == version && now < e.expiresAt) {
            return copyTags(e.value);
        }
        List<TagCount> loaded = tagMapper.selectAllWithCount(workspaceId);
        tags.put(workspaceId, new Entry<List<TagCount>>(version, now + ttlMillis, loaded));
        return copyTags(loaded);
    }

    public void evictColumns(String workspaceId) {
        if (workspaceId != null) {
            columns.remove(workspaceId);
        }
    }

    public void evictCategories(String workspaceId) {
        if (workspaceId != null) {
            categories.remove(workspaceId);
        }
    }

    public void evictTags(String workspaceId) {
        if (workspaceId != null) {
            tags.remove(workspaceId);
        }
    }

    /** 空间配置整体变化（删除空间、导入覆盖、补齐默认配置） */
    public void evict(String workspaceId) {
        if (workspaceId == null) {
            return;
        }
        columns.remove(workspaceId);
        categories.remove(workspaceId);
        tags.remove(workspaceId);
    }

    private static List<BoardColumn> copyColumns(List<BoardColumn> src) {
        List<BoardColumn> out = new ArrayList<BoardColumn>(src.size());
        for (BoardColumn c : src) {
            BoardColumn copy = new BoardColumn();
            BeanUtils.copyProperties(c, copy);
            out.add(copy);
        }
        return Collections.unmodifiableList(out);
    }

    private static List<Category> copyCategories(List<Category> src) {
        List<Category> out = new ArrayList<Category>(src.size());
        for (Category c : src) {
            Category copy = new Category();
            BeanUtils.copyProperties(c, copy);
            out.add(copy);
        }
        return Collections.unmodifiableList(out);
    }

    private static List<TagCount> copyTags(List<TagCount> src) {
        List<TagCount> out = new ArrayList<TagCount>(src.size());
        for (TagCount t : src) {
            TagCount copy = new TagCount();
            BeanUtils.copyProperties(t, copy);
            out.add(copy);
        }
        return Collections.unmodifiableList(out);
    }

    private static final class Entry<T> {
        private final long version;
        private final long expiresAt;
        private final T value;

        private Entry(long version, long expiresAt, T value) {
            this.version = version;
            this.expiresAt = expiresAt;
            this.value = value;
        }
    }
}
