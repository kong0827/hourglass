package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.dto.CategoryRequest;
import com.hourglass.entity.Category;
import com.hourglass.entity.Requirement;
import com.hourglass.mapper.CategoryMapper;
import com.hourglass.mapper.RequirementMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.Arrays;
import java.util.Collections;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 模块增删的破坏性行为：同项目迁移、至少保留一个、权限与审计文案。 */
class CategoryServiceTest {

    private static final String WS = "W1";
    private static final String PROJECT = "R1";
    private static final String OTHER_PROJECT = "R2";
    private static final String USER = "U1";

    private final CategoryMapper categoryMapper = mock(CategoryMapper.class);
    private final RequirementMapper requirementMapper = mock(RequirementMapper.class);
    private final ActivityService activityService = mock(ActivityService.class);
    private final ProjectAccessService projectAccess = mock(ProjectAccessService.class);
    private final ReleasePermissionService releasePermission = mock(ReleasePermissionService.class);
    private final WorkspaceMetaCache metaCache = mock(WorkspaceMetaCache.class);
    private final CategoryService service = new CategoryService(categoryMapper, requirementMapper,
            activityService, projectAccess, releasePermission, metaCache);

    @BeforeEach
    void setUp() {
        Requirement project = new Requirement();
        project.setId(PROJECT);
        project.setWorkspaceId(WS);
        project.setName("项目一");
        when(requirementMapper.selectById(PROJECT)).thenReturn(project);
        when(releasePermission.canManageProject(USER, WS, PROJECT)).thenReturn(true);
        when(categoryMapper.maxSortOrder(WS, PROJECT)).thenReturn(4);
    }

    @Test
    void deleteMovesTasksAndDemandsToFirstSiblingAndLogsCounts() {
        Category front = category("G1", "前端", PROJECT);
        Category back = category("G2", "后端", PROJECT);
        Category foreign = category("G9", "别的项目", OTHER_PROJECT);
        when(categoryMapper.selectById(WS, "G1")).thenReturn(front);
        when(metaCache.categories(WS)).thenReturn(Arrays.asList(front, back, foreign));
        when(categoryMapper.moveTasksToCategory(WS, PROJECT, "G1", "G2")).thenReturn(3);
        when(categoryMapper.moveDemandsToCategory(WS, PROJECT, "G1", "G2")).thenReturn(1);

        service.delete(WS, USER, "G1", null);

        verify(categoryMapper).moveTasksToCategory(WS, PROJECT, "G1", "G2");
        verify(categoryMapper).moveDemandsToCategory(WS, PROJECT, "G1", "G2");
        verify(categoryMapper).deleteById(WS, "G1");
        verify(activityService).logConfig(WS,
                "项目「项目一」删除模块「前端」，其下 3 个工作项与 1 个需求已改到「后端」");
    }

    @Test
    void deleteRejectsTargetFromAnotherProject() {
        Category front = category("G1", "前端", PROJECT);
        Category foreign = category("G9", "别的项目", OTHER_PROJECT);
        when(categoryMapper.selectById(WS, "G1")).thenReturn(front);
        when(metaCache.categories(WS)).thenReturn(Arrays.asList(front, foreign));

        assertEquals(400, assertThrows(AppException.class,
                () -> service.delete(WS, USER, "G1", "G9")).getCode());
        verify(categoryMapper, never()).moveTasksToCategory(any(), any(), any(), any());
        verify(categoryMapper, never()).deleteById(any(), any());
    }

    @Test
    void deleteKeepsLastModule() {
        Category only = category("G1", "其他", PROJECT);
        when(categoryMapper.selectById(WS, "G1")).thenReturn(only);
        when(metaCache.categories(WS)).thenReturn(Collections.singletonList(only));

        assertEquals(400, assertThrows(AppException.class,
                () -> service.delete(WS, USER, "G1", null)).getCode());
        verify(categoryMapper, never()).deleteById(any(), any());
    }

    @Test
    void deleteEmptyModuleLogsNoMigration() {
        Category front = category("G1", "前端", PROJECT);
        Category back = category("G2", "后端", PROJECT);
        when(categoryMapper.selectById(WS, "G1")).thenReturn(front);
        when(metaCache.categories(WS)).thenReturn(Arrays.asList(front, back));
        when(categoryMapper.moveTasksToCategory(WS, PROJECT, "G1", "G2")).thenReturn(0);
        when(categoryMapper.moveDemandsToCategory(WS, PROJECT, "G1", "G2")).thenReturn(0);

        service.delete(WS, USER, "G1", null);

        verify(activityService).logConfig(WS, "项目「项目一」删除模块「前端」，该模块没有工作项与需求");
    }

    @Test
    void createAppendsSortOrderAndFallsBackToDefaultColor() {
        CategoryRequest req = new CategoryRequest();
        req.setName("新模块");
        req.setColor("red");
        when(categoryMapper.insert(any(Category.class))).thenReturn(1);

        service.create(WS, USER, PROJECT, req);

        ArgumentCaptor<Category> saved = ArgumentCaptor.forClass(Category.class);
        verify(categoryMapper).insert(saved.capture());
        assertEquals(PROJECT, saved.getValue().getProjectId());
        assertEquals(5, saved.getValue().getSortOrder(), "新模块排在现有模块之后");
        assertEquals("#8a8578", saved.getValue().getColor(), "非法颜色回落到默认色");
    }

    @Test
    void createRequiresManagePermission() {
        when(releasePermission.canManageProject(USER, WS, PROJECT)).thenReturn(false);
        CategoryRequest req = new CategoryRequest();
        req.setName("新模块");

        assertEquals(403, assertThrows(AppException.class,
                () -> service.create(WS, USER, PROJECT, req)).getCode());
        verify(categoryMapper, never()).insert(any(Category.class));
    }

    private Category category(String id, String name, String projectId) {
        Category category = new Category();
        category.setId(id);
        category.setWorkspaceId(WS);
        category.setProjectId(projectId);
        category.setName(name);
        category.setSortOrder(0);
        return category;
    }
}
