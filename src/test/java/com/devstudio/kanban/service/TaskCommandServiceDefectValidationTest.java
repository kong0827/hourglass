package com.devstudio.kanban.service;

import com.devstudio.kanban.common.AppException;
import com.devstudio.kanban.dto.TaskSaveRequest;
import com.devstudio.kanban.entity.Category;
import com.devstudio.kanban.entity.ProjectVersion;
import com.devstudio.kanban.entity.Requirement;
import com.devstudio.kanban.entity.Task;
import com.devstudio.kanban.mapper.CategoryMapper;
import com.devstudio.kanban.mapper.DemandMapper;
import com.devstudio.kanban.mapper.DevBranchMapper;
import com.devstudio.kanban.mapper.ProjectVersionMapper;
import com.devstudio.kanban.mapper.RequirementDocMapper;
import com.devstudio.kanban.mapper.RequirementMapper;
import com.devstudio.kanban.mapper.SubtaskMapper;
import com.devstudio.kanban.mapper.TaskMapper;
import com.devstudio.kanban.mapper.UserMapper;
import com.devstudio.kanban.mapper.VersionTaskMapper;
import com.devstudio.kanban.mapper.WorkspaceMemberMapper;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 缺陷专属字段：严重度必填、发现版本同项目、非缺陷清空。 */
class TaskCommandServiceDefectValidationTest {

    private static final String WS = "W1";

    private final TaskMapper tasks = mock(TaskMapper.class);
    private final RequirementMapper reqs = mock(RequirementMapper.class);
    private final CategoryMapper categories = mock(CategoryMapper.class);
    private final ProjectVersionMapper versions = mock(ProjectVersionMapper.class);
    private final TaskSupport support = mock(TaskSupport.class);
    private final TaskAuditLogger audit = mock(TaskAuditLogger.class);
    private final TaskCommandService service = new TaskCommandService(tasks, reqs,
            mock(SubtaskMapper.class), categories, mock(UserMapper.class), mock(RequirementDocMapper.class),
            mock(DevBranchMapper.class), mock(WorkspaceMemberMapper.class), versions,
            mock(VersionTaskMapper.class), mock(DemandMapper.class), mock(WorkspaceMetaCache.class),
            support, mock(TaskCompletionService.class), mock(TaskWorkflowService.class), audit,
            mock(NotificationEventService.class), mock(ProjectAccessService.class));

    @Test
    void bugWithoutSeverityIsRejected() {
        stubProject("R1");
        TaskSaveRequest req = request("bug", null);
        req.setSeverity(null);

        AppException ex = assertThrows(AppException.class, () -> service.create("U1", WS, req));

        assertTrue(ex.getMessage().contains("缺陷必须选择严重度"), ex.getMessage());
    }

    @Test
    void bugPersistsDefectFields() {
        stubProject("R1");
        stubVersion("V1", "R1");
        TaskSaveRequest req = request("bug", "blocker");
        req.setEnvironment("生产环境 / Chrome 120");
        req.setReproduceSteps("1. 打开详情\n2. 点击保存");
        req.setFoundVersionId("V1");
        req.setRegressionStatus("pending");

        service.create("U1", WS, req);

        ArgumentCaptor<Task> saved = ArgumentCaptor.forClass(Task.class);
        verify(tasks).insert(saved.capture());
        assertEquals("blocker", saved.getValue().getSeverity());
        assertEquals("生产环境 / Chrome 120", saved.getValue().getEnvironment());
        assertEquals("1. 打开详情\n2. 点击保存", saved.getValue().getReproduceSteps());
        assertEquals("V1", saved.getValue().getFoundVersionId());
        assertEquals("pending", saved.getValue().getRegressionStatus());
    }

    @Test
    void nonBugTypeClearsDefectFields() {
        stubProject("R1");
        stubVersion("V1", "R1");
        TaskSaveRequest req = request("task", "major");
        req.setEnvironment("测试环境");
        req.setFoundVersionId("V1");
        req.setRegressionStatus("passed");

        service.create("U1", WS, req);

        ArgumentCaptor<Task> saved = ArgumentCaptor.forClass(Task.class);
        verify(tasks).insert(saved.capture());
        assertNull(saved.getValue().getSeverity());
        assertNull(saved.getValue().getEnvironment());
        assertNull(saved.getValue().getFoundVersionId());
        assertNull(saved.getValue().getRegressionStatus());
    }

    @Test
    void foundVersionMustBelongToTaskProject() {
        stubProject("R1");
        stubVersion("V2", "R2");
        TaskSaveRequest req = request("bug", "major");
        req.setFoundVersionId("V2");

        AppException ex = assertThrows(AppException.class, () -> service.create("U1", WS, req));

        assertTrue(ex.getMessage().contains("发现版本不属于任务所属项目"), ex.getMessage());
    }

    private void prepare(TaskSaveRequest req) {
        req.setId(null);
        req.setTitle("缺陷标题");
        req.setReqId("R1");
        req.setCategory("general");
        req.setBoardColumn("backlog");
        req.setPriority("P2");
        req.setProgress(0);
        req.setOwner("owner");
    }

    private TaskSaveRequest request(String itemType, String severity) {
        TaskSaveRequest req = new TaskSaveRequest();
        prepare(req);
        req.setItemType(itemType);
        req.setSeverity(severity);
        return req;
    }

    private void stubProject(String reqId) {
        Requirement r = new Requirement();
        r.setId(reqId);
        r.setWorkspaceId(WS);
        r.setName("项目");
        when(reqs.selectById(reqId)).thenReturn(r);
        when(categories.selectByName(WS, "general")).thenReturn(new Category());
    }

    private void stubVersion(String id, String reqId) {
        ProjectVersion version = new ProjectVersion();
        version.setId(id);
        version.setWorkspaceId(WS);
        version.setReqId(reqId);
        when(versions.selectById(id)).thenReturn(version);
    }
}
