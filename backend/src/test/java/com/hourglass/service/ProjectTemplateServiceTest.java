package com.hourglass.service;

import com.hourglass.dto.CategoryRequest;
import com.hourglass.dto.ProjectVersionSaveRequest;
import com.hourglass.dto.TaskSaveRequest;
import com.hourglass.entity.ProjectVersion;
import com.hourglass.entity.RequirementDoc;
import com.hourglass.mapper.ProjectVersionMapper;
import com.hourglass.mapper.RequirementDocMapper;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 模板预置的测试模块必须写进项目目录树（category），不能落到仅供回滚的 test_module。 */
class ProjectTemplateServiceTest {

    private static final String WS = "W1";
    private static final String USER = "U1";
    private static final String PROJECT = "R1";

    private final BoardColumnService columnService = mock(BoardColumnService.class);
    private final RequirementDocService docService = mock(RequirementDocService.class);
    private final ProjectVersionService versionService = mock(ProjectVersionService.class);
    private final ProjectVersionMapper versionMapper = mock(ProjectVersionMapper.class);
    private final CategoryService categoryService = mock(CategoryService.class);
    private final RequirementDocMapper docMapper = mock(RequirementDocMapper.class);
    private final TaskCommandService taskService = mock(TaskCommandService.class);
    private final ProjectTemplateService service = new ProjectTemplateService(columnService, docService,
            versionService, versionMapper, categoryService, docMapper, taskService);

    @Test
    void standardTemplateWritesModulesAsCategoryNodes() {
        when(columnService.list(WS)).thenReturn(Collections.emptyList());
        when(versionMapper.selectByReq(WS, PROJECT)).thenReturn(Collections.emptyList());
        when(docService.create(anyString(), anyString(), any())).thenAnswer(inv -> {
            RequirementDoc doc = new RequirementDoc();
            doc.setId("D" + System.nanoTime());
            return doc;
        });

        service.apply(WS, USER, PROJECT, ProjectTemplateService.STANDARD);

        ArgumentCaptor<CategoryRequest> captor = ArgumentCaptor.forClass(CategoryRequest.class);
        verify(categoryService, times(3)).create(eq(WS), eq(USER), eq(PROJECT), captor.capture());
        List<String> names = new ArrayList<String>();
        for (CategoryRequest req : captor.getAllValues()) {
            names.add(req.getName());
        }
        assertEquals(java.util.Arrays.asList("核心流程", "异常与边界", "权限与安全"), names);
    }

    @Test
    void sampleTemplateSeedsWorkItemsIntoAnActiveVersion() {
        when(columnService.list(WS)).thenReturn(Collections.emptyList());
        when(versionMapper.selectByReq(WS, PROJECT)).thenReturn(Collections.emptyList());
        when(docService.create(anyString(), anyString(), any())).thenAnswer(inv -> {
            RequirementDoc doc = new RequirementDoc();
            doc.setId("D" + System.nanoTime());
            return doc;
        });
        when(versionService.create(anyString(), anyString(), any(ProjectVersionSaveRequest.class)))
                .thenAnswer(inv -> {
                    ProjectVersion v = new ProjectVersion();
                    v.setId("V1");
                    return v;
                });

        service.apply(WS, USER, PROJECT, ProjectTemplateService.OUTSOURCING);

        ArgumentCaptor<ProjectVersionSaveRequest> ver = ArgumentCaptor.forClass(ProjectVersionSaveRequest.class);
        verify(versionService).create(eq(USER), eq(WS), ver.capture());
        assertEquals("active", ver.getValue().getStatus());
        assertEquals("交付 V1.0", ver.getValue().getName());

        ArgumentCaptor<TaskSaveRequest> tasks = ArgumentCaptor.forClass(TaskSaveRequest.class);
        verify(taskService, times(16)).create(eq(USER), eq(WS), tasks.capture());
        for (TaskSaveRequest req : tasks.getAllValues()) {
            assertEquals(PROJECT, req.getReqId());
            assertEquals(Collections.singletonList("V1"), req.getVersionIds());
            assertFalse(req.getTitle().isEmpty());
            if ("bug".equals(req.getItemType())) {
                assertEquals("major", req.getSeverity());
            }
        }
        assertTrue(tasks.getAllValues().get(0).getBoardColumn().equals("done"));
    }

    @Test
    void templateListExposesSampleCount() {
        List<com.hourglass.dto.ProjectTemplateView> list = service.list();
        int sampleTemplates = 0;
        for (com.hourglass.dto.ProjectTemplateView v : list) {
            if (v.getSampleCount() != null && v.getSampleCount() > 0) sampleTemplates++;
        }
        assertEquals(3, sampleTemplates);
    }
}
