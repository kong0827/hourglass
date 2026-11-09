package com.hourglass.service;

import com.hourglass.entity.BoardColumn;
import com.hourglass.entity.Category;
import com.hourglass.entity.TagCount;
import com.hourglass.mapper.BoardColumnMapper;
import com.hourglass.mapper.CategoryMapper;
import com.hourglass.mapper.ColumnTransitionMapper;
import com.hourglass.mapper.TagMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.Arrays;
import java.util.List;
import java.util.concurrent.atomic.AtomicLong;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotSame;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 列/模块/标签 meta 缓存：按空间版本号失效、TTL 兜底、空间隔离。 */
class WorkspaceMetaCacheTest {

    private static final String W1 = "S1";
    private static final String W2 = "S2";
    private static final long TTL = 300_000L;

    private BoardColumnMapper columnMapper;
    private CategoryMapper categoryMapper;
    private TagMapper tagMapper;
    private WorkspaceVersionService versions;
    private AtomicLong now;
    private WorkspaceMetaCache cache;

    @BeforeEach
    void setUp() {
        columnMapper = mock(BoardColumnMapper.class);
        categoryMapper = mock(CategoryMapper.class);
        tagMapper = mock(TagMapper.class);
        versions = new WorkspaceVersionService();
        now = new AtomicLong(1_000_000L);
        cache = new WorkspaceMetaCache(columnMapper, categoryMapper, tagMapper,
                mock(ColumnTransitionMapper.class), versions, TTL, now::get);
    }

    @Test
    void columnsReloadWhenWorkspaceVersionBumps() {
        when(columnMapper.selectAll(W1)).thenReturn(Arrays.asList(column("C1", "待处理", 0)));
        assertEquals("待处理", cache.column(W1, "C1").getName());
        assertEquals(1, cache.columns(W1).size());
        verify(columnMapper, times(1)).selectAll(W1);

        when(columnMapper.selectAll(W1)).thenReturn(Arrays.asList(column("C1", "排队中", 0)));
        /* 版本未变：仍然命中旧值，不查库 */
        assertEquals("待处理", cache.column(W1, "C1").getName());
        verify(columnMapper, times(1)).selectAll(W1);

        versions.bump(W1);
        assertEquals("排队中", cache.column(W1, "C1").getName());
        verify(columnMapper, times(2)).selectAll(W1);
    }

    @Test
    void metaExpiresByTtlEvenWithoutVersionBump() {
        when(columnMapper.selectAll(W1)).thenReturn(Arrays.asList(column("C1", "待处理", 0)));
        cache.columns(W1);
        now.addAndGet(TTL);
        cache.columns(W1);
        verify(columnMapper, times(2)).selectAll(W1);
    }

    @Test
    void categoriesAndTagsAreIsolatedPerWorkspace() {
        when(categoryMapper.selectByWorkspace(W1)).thenReturn(Arrays.asList(category("G1", "工作")));
        when(categoryMapper.selectByWorkspace(W2)).thenReturn(Arrays.asList(category("G2", "学习")));
        when(tagMapper.selectAllWithCount(W1)).thenReturn(Arrays.asList(tag("bug", 2)));
        when(tagMapper.selectAllWithCount(W2)).thenReturn(Arrays.asList(tag("doc", 1)));

        assertEquals("工作", cache.categories(W1).get(0).getName());
        assertEquals("学习", cache.categories(W2).get(0).getName());
        assertEquals("bug", cache.tags(W1).get(0).getName());
        assertEquals("doc", cache.tags(W2).get(0).getName());

        versions.bump(W1);
        when(categoryMapper.selectByWorkspace(W1)).thenReturn(Arrays.asList(category("G1", "研发")));
        assertEquals("研发", cache.categories(W1).get(0).getName());
        assertEquals("学习", cache.categories(W2).get(0).getName());
        verify(categoryMapper, times(2)).selectByWorkspace(W1);
        verify(categoryMapper, times(1)).selectByWorkspace(W2);
    }

    @Test
    void returnedListsAreReadOnlyCopies() {
        List<Category> stored = Arrays.asList(category("G1", "工作"));
        when(categoryMapper.selectByWorkspace(W1)).thenReturn(stored);
        List<Category> view = cache.categories(W1);
        assertEquals("工作", view.get(0).getName());
        try {
            view.add(category("G2", "学习"));
            throw new AssertionError("缓存列表必须是只读副本");
        } catch (UnsupportedOperationException expected) {
            // ok
        }
        view.get(0).setName("被调用方改名");
        assertEquals("工作", cache.categories(W1).get(0).getName());
        verify(categoryMapper, times(1)).selectByWorkspace(W1);
        assertNotSame(view, cache.categories(W1));
    }

    private static BoardColumn column(String id, String name, int sort) {
        BoardColumn c = new BoardColumn();
        c.setId(id);
        c.setWorkspaceId(W1);
        c.setName(name);
        c.setSortOrder(sort);
        return c;
    }

    private static Category category(String id, String name) {
        Category c = new Category();
        c.setId(id);
        c.setName(name);
        return c;
    }

    private static TagCount tag(String name, int count) {
        TagCount t = new TagCount();
        t.setName(name);
        t.setCount(count);
        return t;
    }
}
