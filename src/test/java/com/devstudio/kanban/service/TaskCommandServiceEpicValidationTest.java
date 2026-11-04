package com.devstudio.kanban.service;

import com.devstudio.kanban.common.AppException;
import com.devstudio.kanban.dto.TaskSaveRequest;
import com.devstudio.kanban.entity.Category;
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

import java.util.ArrayList;
import java.util.Collections;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** P0 修复回归：Epic 归属校验（一层聚合/同项目/防环）与生命周期清理。 */
class TaskCommandServiceEpicValidationTest {

    private static final String WS = "W1";

    private final TaskMapper tasks = mock(TaskMapper.class);
    private final UserMapper users = mock(UserMapper.class);
    private final CategoryMapper categories = mock(CategoryMapper.class);
    private final WorkspaceMemberMapper members = mock(WorkspaceMemberMapper.class);
    private final TaskSupport support = mock(TaskSupport.class);
    private final TaskAuditLogger audit = mock(TaskAuditLogger.class);
    private final NotificationEventService events = mock(NotificationEventService.class);
    private final RequirementMapper reqs = mock(RequirementMapper.class);
    private final TaskCommandService service = new TaskCommandService(tasks, reqs,
            mock(SubtaskMapper.class), categories, users, mock(RequirementDocMapper.class),
            mock(DevBranchMapper.class), members, mock(ProjectVersionMapper.class),
            mock(VersionTaskMapper.class), mock(DemandMapper.class), mock(WorkspaceMetaCache.class),
            support, mock(TaskCompletionService.class), mock(TaskWorkflowService.class), audit, events,
            mock(ProjectAccessService.class));

    @Test
    void epicCannotAttachToAnotherEpic() {
        stubProject("R1");
        TaskSaveRequest req = request("K1", "epic", "E1");

        AppException ex = assertThrows(AppException.class, () -> service.create("U1", WS, req));

        assertTrue(ex.getMessage().contains("史诗不能再挂到其他史诗下"), ex.getMessage());
    }

    @Test
    void taskCannotUseItselfAsEpic() {
        stubProject("R1");
        TaskSaveRequest req = request("K1", "task", "K1");

        AppException ex = assertThrows(AppException.class, () -> service.create("U1", WS, req));

        assertTrue(ex.getMessage().contains("任务不能作为自己的史诗"), ex.getMessage());
    }

    @Test
    void missingEpicIsRejected() {
        stubProject("R1");
        TaskSaveRequest req = request("K1", "task", "E9");
        when(tasks.selectById("E9")).thenReturn(null);

        AppException ex = assertThrows(AppException.class, () -> service.create("U1", WS, req));

        assertTrue(ex.getMessage().contains("所属史诗不存在"), ex.getMessage());
    }

    @Test
    void deletedEpicIsRejected() {
        stubProject("R1");
        TaskSaveRequest req = request("K1", "task", "E2");
        Task deleted = epic("E2", "R1", null);
        deleted.setDeletedAt(java.time.LocalDateTime.now());
        when(tasks.selectById("E2")).thenReturn(deleted);

        AppException ex = assertThrows(AppException.class, () -> service.create("U1", WS, req));

        assertTrue(ex.getMessage().contains("所属史诗不存在"), ex.getMessage());
    }

    @Test
    void nonEpicTaskCannotBeUsedAsEpic() {
        stubProject("R1");
        TaskSaveRequest req = request("K1", "task", "E2");
        Task plain = task("E2", "R1");
        when(tasks.selectById("E2")).thenReturn(plain);

        AppException ex = assertThrows(AppException.class, () -> service.create("U1", WS, req));

        assertTrue(ex.getMessage().contains("所选任务不是史诗"), ex.getMessage());
    }

    @Test
    void epicMustBelongToSameProject() {
        stubProject("R1");
        TaskSaveRequest req = request("K1", "task", "E2");
        when(tasks.selectById("E2")).thenReturn(epic("E2", "R2", null));

        AppException ex = assertThrows(AppException.class, () -> service.create("U1", WS, req));

        assertTrue(ex.getMessage().contains("史诗须与任务属于同一项目"), ex.getMessage());
    }

    @Test
    void circularEpicChainIsRejected() {
        stubProject("R1");
        TaskSaveRequest req = request("K1", "task", "E2");
        when(tasks.selectById("E2")).thenReturn(epic("E2", "R1", "K1"));

        AppException ex = assertThrows(AppException.class, () -> service.create("U1", WS, req));

        assertTrue(ex.getMessage().contains("不能形成循环的史诗归属"), ex.getMessage());
    }

    @Test
    void validEpicIsAccepted() {
        stubProject("R1");
        when(tasks.selectById("E1")).thenReturn(epic("E1", "R1", null));

        service.create("U1", WS, request("K1", "task", "E1"));

        ArgumentCaptor<Task> saved = ArgumentCaptor.forClass(Task.class);
        verify(tasks).insert(saved.capture());
        assertEquals("E1", saved.getValue().getEpicId());
    }

    @Test
    void epicTypeChangeClearsChildrenEpicRefs() {
        Task old = task("K1", "R1");
        old.setItemType("epic");
        TaskSaveRequest req = request("K1", "task", null);
        prepareUpdate(old, req);
        when(tasks.clearEpicChildren(WS, "K1")).thenReturn(2);

        service.update("U1", WS, "K1", req);

        verify(tasks).clearEpicChildren(WS, "K1");
        ArgumentCaptor<Task> saved = ArgumentCaptor.forClass(Task.class);
        verify(tasks).update(saved.capture());
        assertEquals("task", saved.getValue().getItemType());
        assertNull(saved.getValue().getEpicId());
    }

    @Test
    void staleEpicIsClearedWhenEpicChangedProject() {
        Task old = task("K1", "R1");
        old.setItemType("task");
        old.setEpicId("E2");
        TaskSaveRequest req = request("K1", null, null);
        prepareUpdate(old, req);
        when(tasks.selectById("E2")).thenReturn(epic("E2", "R2", null));

        service.update("U1", WS, "K1", req);

        ArgumentCaptor<Task> saved = ArgumentCaptor.forClass(Task.class);
        verify(tasks).update(saved.capture());
        assertNull(saved.getValue().getEpicId(), "Epic 换项目后旧归属自动解除");
        verify(tasks, never()).clearEpicChildren(anyString(), anyString());
    }

    private void prepareUpdate(Task old, TaskSaveRequest req) {
        stubProject("R1");
        when(support.require(WS, "K1")).thenReturn(old);
        when(support.tagNames(WS, "K1")).thenReturn(Collections.emptyList());
        when(tasks.selectById("K1")).thenReturn(old);
        when(categories.selectByName(WS, "general")).thenReturn(new Category());
        when(audit.diffParts(eq(WS), eq(old), any(Task.class), anyList(), any()))
                .thenReturn(new ArrayList<String>());
    }

    private void stubProject(String reqId) {
        Requirement r = new Requirement();
        r.setId(reqId);
        r.setWorkspaceId(WS);
        r.setName("项目");
        when(reqs.selectById(reqId)).thenReturn(r);
        when(categories.selectByName(WS, "general")).thenReturn(new Category());
    }

    private TaskSaveRequest request(String id, String itemType, String epicId) {
        TaskSaveRequest req = new TaskSaveRequest();
        req.setId(id);
        req.setTitle("标题");
        req.setItemType(itemType);
        req.setEpicId(epicId);
        req.setReqId("R1");
        req.setCategory("general");
        req.setBoardColumn("backlog");
        req.setPriority("P2");
        req.setProgress(0);
        req.setOwner("owner");
        return req;
    }

    private Task task(String id, String reqId) {
        Task t = new Task();
        t.setId(id);
        t.setWorkspaceId(WS);
        t.setTitle("任务 " + id);
        t.setReqId(reqId);
        t.setItemType("task");
        t.setBoardColumn("backlog");
        t.setSortOrder(1024);
        t.setIsMilestone(false);
        t.setRemindSent(false);
        return t;
    }

    private Task epic(String id, String reqId, String epicId) {
        Task t = task(id, reqId);
        t.setItemType("epic");
        t.setEpicId(epicId);
        return t;
    }
}
