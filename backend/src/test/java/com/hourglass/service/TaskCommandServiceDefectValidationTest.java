package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.dto.TaskSaveRequest;
import com.hourglass.entity.Category;
import com.hourglass.entity.ProjectVersion;
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
    private final DeliveryScopeLock scopeLock = mock(DeliveryScopeLock.class);
    private final TaskCommandService service = new TaskCommandService(tasks, reqs,
            mock(SubtaskMapper.class), categories, mock(UserMapper.class), mock(RequirementDocMapper.class),
            mock(DevBranchMapper.class), mock(WorkspaceMemberMapper.class), versions,
            mock(VersionTaskMapper.class), mock(DemandMapper.class), mock(WorkspaceMetaCache.class),
            support, mock(TaskCompletionService.class), mock(TaskWorkflowService.class), audit,
            mock(NotificationEventService.class), mock(ProjectAccessService.class), mock(TimeLogService.class), scopeLock,
            mock(ReleasePermissionService.class));

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
    void bugSubmittedForTestBecomesPending() {
        stubProject("R1");
        TaskSaveRequest req = request("bug", "major");
        req.setBoardColumn("test");

        service.create("U1", WS, req);

        ArgumentCaptor<Task> saved = ArgumentCaptor.forClass(Task.class);
        verify(tasks).insert(saved.capture());
        assertEquals("pending", saved.getValue().getRegressionStatus());
    }

    @Test
    void bugCreatedDoneBecomesPassed() {
        stubProject("R1");
        TaskSaveRequest req = request("bug", "major");
        req.setBoardColumn("done");

        service.create("U1", WS, req);

        ArgumentCaptor<Task> saved = ArgumentCaptor.forClass(Task.class);
        verify(tasks).insert(saved.capture());
        assertEquals("passed", saved.getValue().getRegressionStatus());
    }

    @Test
    void bugNotSubmittedYetHasNoRegressionStatus() {
        stubProject("R1");
        TaskSaveRequest req = request("bug", "major");
        req.setBoardColumn("backlog");

        service.create("U1", WS, req);

        ArgumentCaptor<Task> saved = ArgumentCaptor.forClass(Task.class);
        verify(tasks).insert(saved.capture());
        assertNull(saved.getValue().getRegressionStatus());
    }

    @Test
    void doneRejectsExplicitFailedRegression() {
        stubProject("R1");
        TaskSaveRequest req = request("bug", "major");
        req.setBoardColumn("done");
        req.setRegressionStatus("failed");

        AppException ex = assertThrows(AppException.class, () -> service.create("U1", WS, req));

        assertTrue(ex.getMessage().contains("需回归通过"), ex.getMessage());
    }

    @Test
    void passedRegressionOutsideDoneIsRejected() {
        stubProject("R1");
        TaskSaveRequest req = request("bug", "major");
        req.setBoardColumn("doing");
        req.setRegressionStatus("passed");

        AppException ex = assertThrows(AppException.class, () -> service.create("U1", WS, req));

        assertTrue(ex.getMessage().contains("请同时将任务状态改为「已完成」"), ex.getMessage());
    }

    @Test
    void movingBugToDoneKeepsPassedWhenDrawerEchoesOldPending() {
        stubProject("R1");
        Task old = new Task();
        old.setId("K1");
        old.setWorkspaceId(WS);
        old.setReqId("R1");
        old.setTitle("缺陷标题");
        old.setItemType("bug");
        old.setSeverity("major");
        old.setBoardColumn("test");
        old.setRegressionStatus("pending");
        old.setOwner("owner");
        old.setPriority("P2");
        old.setProgress(0);
        old.setCategoryId("general");
        old.setSortOrder(1024);
        when(support.require(WS, "K1")).thenReturn(old);
        when(scopeLock.lockTask(WS, "K1")).thenReturn(old);
        when(support.tagNames(WS, "K1")).thenReturn(java.util.Collections.<String>emptyList());
        when(audit.diffParts(org.mockito.ArgumentMatchers.eq(WS), org.mockito.ArgumentMatchers.eq(old),
                org.mockito.ArgumentMatchers.any(Task.class), org.mockito.ArgumentMatchers.anyList(),
                org.mockito.ArgumentMatchers.anyList())).thenReturn(new java.util.ArrayList<String>());
        when(tasks.update(org.mockito.ArgumentMatchers.any(Task.class))).thenReturn(1);

        TaskSaveRequest req = request("bug", "major");
        req.setId("K1");
        req.setBoardColumn("done");
        /* 抽屉会把打开时的旧值原样回传，应视为“未修改”，由列流转自动记为回归通过 */
        req.setRegressionStatus("pending");

        service.update("U1", WS, "K1", req);

        ArgumentCaptor<Task> saved = ArgumentCaptor.forClass(Task.class);
        verify(tasks).update(saved.capture());
        assertEquals("passed", saved.getValue().getRegressionStatus());
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
        req.setCategoryId("general");
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
        Category cat = new Category();
        cat.setId("general");
        cat.setProjectId(reqId);
        when(categories.selectById(WS, "general")).thenReturn(cat);
    }

    private void stubVersion(String id, String reqId) {
        ProjectVersion version = new ProjectVersion();
        version.setId(id);
        version.setWorkspaceId(WS);
        version.setReqId(reqId);
        when(versions.selectById(id)).thenReturn(version);
    }
}
