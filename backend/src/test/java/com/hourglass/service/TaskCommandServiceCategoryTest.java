package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.dto.TaskSaveRequest;
import com.hourglass.entity.Category;
import com.hourglass.entity.Requirement;
import com.hourglass.entity.Task;
import com.hourglass.mapper.CategoryMapper;
import com.hourglass.mapper.DemandMapper;
import com.hourglass.mapper.DevBranchMapper;
import com.hourglass.mapper.ProjectVersionMapper;
import com.hourglass.mapper.RequirementDocMapper;
import com.hourglass.mapper.RequirementMapper;
import com.hourglass.mapper.SubtaskMapper;
import com.hourglass.mapper.TaskMapper;
import com.hourglass.mapper.UserMapper;
import com.hourglass.mapper.VersionTaskMapper;
import com.hourglass.mapper.WorkspaceMemberMapper;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.Arrays;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 工作项模块：缺省取项目第一个模块，明确空串表示「未指定」，跨项目模块拒绝。 */
class TaskCommandServiceCategoryTest {

    private static final String WS = "W1";

    private final TaskMapper tasks = mock(TaskMapper.class);
    private final RequirementMapper reqs = mock(RequirementMapper.class);
    private final CategoryMapper categories = mock(CategoryMapper.class);
    private final WorkspaceMetaCache meta = mock(WorkspaceMetaCache.class);
    private final TaskCommandService service = new TaskCommandService(tasks, reqs,
            mock(SubtaskMapper.class), categories, mock(UserMapper.class), mock(RequirementDocMapper.class),
            mock(DevBranchMapper.class), mock(WorkspaceMemberMapper.class), mock(ProjectVersionMapper.class),
            mock(VersionTaskMapper.class), mock(DemandMapper.class), meta,
            mock(TaskSupport.class), mock(TaskCompletionService.class), mock(TaskWorkflowService.class),
            mock(TaskAuditLogger.class), mock(NotificationEventService.class), mock(ProjectAccessService.class),
            mock(TimeLogService.class), mock(DeliveryScopeLock.class), mock(ReleasePermissionService.class));

    @Test
    void explicitEmptyCategoryMeansUnspecified() {
        stubProject("R1");
        TaskSaveRequest req = request();
        req.setCategoryId("");

        service.create("U1", WS, req);

        assertEquals("", savedTask().getCategoryId());
    }

    @Test
    void omittedCategoryFallsBackToFirstProjectModule() {
        stubProject("R1");
        Category first = category("G1", "R1");
        when(meta.categories(WS)).thenReturn(Arrays.asList(first, category("G2", "R2")));
        TaskSaveRequest req = request();
        req.setCategoryId(null);

        service.create("U1", WS, req);

        assertEquals("G1", savedTask().getCategoryId());
    }

    @Test
    void categoryFromAnotherProjectIsRejected() {
        stubProject("R1");
        when(categories.selectById(WS, "G2")).thenReturn(category("G2", "R2"));
        TaskSaveRequest req = request();
        req.setCategoryId("G2");

        AppException ex = assertThrows(AppException.class, () -> service.create("U1", WS, req));

        assertTrue(ex.getMessage().contains("模块不属于该项目"), ex.getMessage());
    }

    private Task savedTask() {
        ArgumentCaptor<Task> saved = ArgumentCaptor.forClass(Task.class);
        verify(tasks).insert(saved.capture());
        return saved.getValue();
    }

    private TaskSaveRequest request() {
        TaskSaveRequest req = new TaskSaveRequest();
        req.setTitle("工作项标题");
        req.setReqId("R1");
        req.setBoardColumn("backlog");
        req.setPriority("P2");
        req.setProgress(0);
        req.setOwner("owner");
        return req;
    }

    private void stubProject(String reqId) {
        Requirement r = new Requirement();
        r.setId(reqId);
        r.setWorkspaceId(WS);
        r.setName("项目");
        when(reqs.selectById(reqId)).thenReturn(r);
    }

    private Category category(String id, String projectId) {
        Category c = new Category();
        c.setId(id);
        c.setWorkspaceId(WS);
        c.setProjectId(projectId);
        c.setName(id);
        return c;
    }
}
