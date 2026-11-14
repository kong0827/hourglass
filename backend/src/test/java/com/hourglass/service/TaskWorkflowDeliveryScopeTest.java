package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.dto.TaskBulkMoveRequest;
import com.hourglass.dto.TaskMoveRequest;
import com.hourglass.dto.TaskReopenRequest;
import com.hourglass.entity.Task;
import com.hourglass.entity.Workspace;
import com.hourglass.entity.WorkspaceMember;
import com.hourglass.mapper.ColumnTransitionMapper;
import com.hourglass.mapper.ProjectMemberMapper;
import com.hourglass.mapper.WorkspaceMemberMapper;
import com.hourglass.mapper.SubtaskMapper;
import com.hourglass.mapper.TaskLogMapper;
import com.hourglass.mapper.TaskMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.InOrder;

import java.time.LocalDate;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class TaskWorkflowDeliveryScopeTest {
    private final TaskMapper tasks = mock(TaskMapper.class);
    private final TaskSupport support = mock(TaskSupport.class);
    private final DeliveryScopeLock locks = mock(DeliveryScopeLock.class);
    private final TimeLogService timeLogs = mock(TimeLogService.class);
    private final TaskCompletionService completion = mock(TaskCompletionService.class);
    private final ColumnTransitionService transitions = mock(ColumnTransitionService.class);
    private final TaskLogMapper logs = mock(TaskLogMapper.class);
    private final WorkspaceMemberMapper members = mock(WorkspaceMemberMapper.class);
    private final ProjectMemberMapper grants = mock(ProjectMemberMapper.class);
    private final ProjectAccessService access = spy(new ProjectAccessService(grants, members));
    private final WorkspaceService workspaces = mock(WorkspaceService.class);
    private final TaskWorkflowService service = new TaskWorkflowService(tasks, logs,
            mock(SubtaskMapper.class), support, timeLogs, completion, mock(TaskAuditLogger.class),
            mock(NotificationEventService.class), mock(TaskWatchService.class), access,
            transitions, workspaces, members, locks);
    private Task published;

    @BeforeEach
    void prepare() {
        org.springframework.test.util.ReflectionTestUtils.setField(service, "versionTaskMapper", mock(com.hourglass.mapper.VersionTaskMapper.class));
        org.springframework.test.util.ReflectionTestUtils.setField(service, "publications", mock(TaskPublicationService.class));
        published = task("K1", "R1");
        published.setPublishedAt(LocalDate.of(2026, 11, 9));
        published.setPublishedReleaseId("VR1");
        published.setPublishSource("record");
        published.setEverPublished(true);
        published.setPublicationState("effective");
        published.setVersionIds(Arrays.asList("V1", "V2"));
        staleRole("member");
        currentSnapshot("R1", "member", null);
        currentSnapshot("R2", "member", null);
        when(logs.selectLastDoneFromColumn("W1", "K1")).thenReturn("backlog");
        when(support.columnExists("W1", "backlog")).thenReturn(true);
        when(transitions.check(anyString(), anyString(), anyString(), any(), anyBoolean(), anyBoolean()))
                .thenReturn(new ColumnTransitionService.Decision("allow", null, false));
    }

    private Task task(String id, String reqId) {
        Task task = new Task();
        task.setId(id);
        task.setWorkspaceId("W1");
        task.setReqId(reqId);
        task.setBoardColumn("done");
        task.setTitle(id);
        task.setOwnerUserId("U-other");
        when(support.require("W1", id)).thenReturn(task);
        when(locks.lockTask("W1", id)).thenReturn(task);
        return task;
    }

    private TaskMoveRequest moveRequest(String to) {
        TaskMoveRequest req = new TaskMoveRequest();
        req.setColumn(to);
        req.setAutoTimer(false);
        req.setAutoResume(false);
        req.setForce(true);
        return req;
    }

    @Test
    void publishedCanMoveOutWithHistoryAndPlanningPreserved() {
        service.move("U1", "W1", "K1", moveRequest("backlog"));
        assertEquals("backlog", published.getBoardColumn());
        verify(tasks).update(published);
        verify(completion).remove("W1", "K1");
        assertHistoryPreserved();
    }

    @Test
    void publishedCanReopenWithoutClearingFormalBadge() {
        service.reopen("U1", "W1", "K1", null);
        assertEquals("backlog", published.getBoardColumn());
        verify(tasks).update(published);
        verify(completion).remove("W1", "K1");
        assertHistoryPreserved();
    }

    @Test
    void publishedCanLeaveDoneThroughEditCallbackWithoutChangingEvidence() {
        assertDoesNotThrow(() -> service.beforeEditColumnChange("U1", "W1", "K1",
                "done", "doing", "强制", true, false));
        verify(timeLogs).closeRunningForTask(eq("W1"), eq("K1"), eq("U1"), anyString());
        assertHistoryPreserved();
    }

    private void assertHistoryPreserved() {
        assertEquals(LocalDate.of(2026, 11, 9), published.getPublishedAt());
        assertEquals("VR1", published.getPublishedReleaseId());
        assertEquals("record", published.getPublishSource());
        assertTrue(published.getEverPublished());
        assertEquals("effective", published.getPublicationState());
        assertEquals(Arrays.asList("V1", "V2"), published.getVersionIds());
    }

    @Test
    void sameColumnReorderOfPublishedTaskAllowedAndPublicationPreserved() {
        TaskMoveRequest req = moveRequest("done");
        req.setForce(false);
        service.move("U1", "W1", "K1", req);
        verify(tasks).update(published);
        assertNotNull(published.getPublishedAt());
        verifyNoInteractions(timeLogs, completion);
    }

    @Test
    void bulkLocksAllProjectsThenTasksSortedAndAllowsPublishedTask() {
        task("K2", "R2");
        TaskBulkMoveRequest req = new TaskBulkMoveRequest();
        req.setIds(Arrays.asList("K2", "K1", "K2"));
        req.setColumn("backlog");
        service.bulkMove("U1", "W1", req);
        InOrder order = inOrder(locks);
        order.verify(locks).lockProjects("W1", "R1", "R2");
        order.verify(locks).lockTask("W1", "K1");
        order.verify(locks).lockTask("W1", "K2");
        verify(tasks, times(2)).update(any());
        assertEquals("backlog", published.getBoardColumn());
        assertHistoryPreserved();
    }

    @Test
    void bulkUnpublishedMovesDoNotReacquireProjectsAfterTaskLocks() {
        published.setPublishedAt(null);
        task("K2", "R2");
        TaskBulkMoveRequest req = new TaskBulkMoveRequest();
        req.setIds(Arrays.asList("K2", "K1"));
        req.setColumn("backlog");
        service.bulkMove("U1", "W1", req);
        verify(locks).lockProjects("W1", "R1", "R2");
        verify(locks).lockTask("W1", "K1");
        verify(locks).lockTask("W1", "K2");
        verifyNoMoreInteractions(locks);
    }

    @Test
    void concurrentPublicationAfterObservationDoesNotLockExecution() {
        Task observed = new Task();
        observed.setReqId("R1");
        when(support.require("W1", "K1")).thenReturn(observed);
        service.move("U1", "W1", "K1", moveRequest("backlog"));
        verify(tasks).update(published);
        assertHistoryPreserved();
    }

    @ParameterizedTest
    @ValueSource(strings = {"move", "bulk", "reopen", "edit"})
    void rolledBackHistoricalFactSurvivesEveryWorkflowEntrypoint(String entrypoint) {
        published.setPublicationState("rolled_back");
        published.setPublishedAt(null);
        published.setPublishedReleaseId(null);
        published.setPublishSource(null);
        invoke(entrypoint, false);
        assertTrue(published.getEverPublished());
        assertEquals("rolled_back", published.getPublicationState());
        assertNull(published.getPublishedAt());
        assertEquals(Arrays.asList("V1", "V2"), published.getVersionIds());
    }

    @Test
    void callbackRejectsStaleFromColumn() {
        assertEquals(409, assertThrows(AppException.class, () -> service.beforeEditColumnChange(
                "U1", "W1", "K1", "doing", "done", null, false, false)).getCode());
        verifyNoInteractions(timeLogs);
    }

    @ParameterizedTest
    @CsvSource({"viewer,,403", "member,read,403", "member,none,404", ",,404"})
    void allWorkflowEntrypointsDenyCurrentAccessBeforeMutation(String role, String grant, int code) {
        published.setPublishedAt(null);
        staleRole("owner");
        currentSnapshot("R1", role, grant);

        for (String entrypoint : Arrays.asList("move", "bulk", "reopen", "edit")) {
            assertEquals(code, assertThrows(AppException.class, () -> invoke(entrypoint, false)).getCode());
        }
        InOrder order = inOrder(support, locks, access);
        for (int i = 0; i < 4; i++) {
            order.verify(support).require("W1", "K1");
            order.verify(locks).lockProjects("W1", "R1");
            order.verify(locks).lockTask("W1", "K1");
            order.verify(access).assertWriteForUpdate("W1", "U1", "R1");
        }
        verify(access, never()).assertWrite(anyString(), anyString(), any());
        verifyNoInteractions(tasks, timeLogs, completion, transitions, logs);
        assertEquals("done", published.getBoardColumn());
    }

    @ParameterizedTest
    @ValueSource(strings = {"move", "bulk", "reopen", "edit"})
    void ordinaryNonOwnerWriterIsAllowedAfterCurrentCheck(String entrypoint) {
        published.setPublishedAt(null);
        invoke(entrypoint, false);

        InOrder order = inOrder(support, locks, access, timeLogs, tasks);
        order.verify(support).require("W1", "K1");
        order.verify(locks).lockProjects("W1", "R1");
        order.verify(locks).lockTask("W1", "K1");
        order.verify(access).assertWriteForUpdate("W1", "U1", "R1");
        order.verify(timeLogs).closeRunningForTask(eq("W1"), eq("K1"), eq("U1"), anyString());
        if (!"edit".equals(entrypoint)) {
            order.verify(tasks).update(published);
            verify(completion).remove("W1", "K1");
        }
        verify(access, never()).assertWrite(anyString(), anyString(), any());
        verify(members, never()).selectDeliveryAccessForUpdate("W1", "U1", null);
        verifyNoInteractions(workspaces);
        assertEquals("U-other", published.getOwnerUserId());
    }

    @Test
    void bulkRevalidatesAllCurrentPermissionsBeforeAnyTaskMutation() {
        published.setPublishedAt(null);
        task("K2", "R2");
        staleRole("admin");
        currentSnapshot("R2", "member", "none");
        TaskBulkMoveRequest req = new TaskBulkMoveRequest();
        req.setIds(Arrays.asList("K2", "K1"));
        req.setColumn("backlog");

        assertEquals(404, assertThrows(AppException.class,
                () -> service.bulkMove("U1", "W1", req)).getCode());
        InOrder order = inOrder(locks, access);
        order.verify(locks).lockProjects("W1", "R1", "R2");
        order.verify(locks).lockTask("W1", "K1");
        order.verify(locks).lockTask("W1", "K2");
        order.verify(access).assertWriteForUpdate("W1", "U1", "R1");
        order.verify(access).assertWriteForUpdate("W1", "U1", "R2");
        verifyNoInteractions(tasks, timeLogs, completion);
    }

    @ParameterizedTest
    @ValueSource(strings = {"owner", "admin"})
    void demotedCachedPrivilegedRoleCannotForceAnyWorkflowEntrypoint(String staleRole) {
        published.setPublishedAt(null);
        staleRole(staleRole);
        currentSnapshot(null, "member", null);
        enforceDeniedTransition();

        for (String entrypoint : Arrays.asList("move", "bulk", "reopen", "edit")) {
            assertEquals(403, assertThrows(AppException.class, () -> invoke(entrypoint, true)).getCode());
        }
        verify(members, times(4)).selectDeliveryAccessForUpdate("W1", "U1", null);
        verifyNoInteractions(workspaces, tasks, timeLogs, completion);
    }

    @ParameterizedTest
    @ValueSource(strings = {"owner", "admin"})
    void currentPrivilegedRoleCanForceDespiteStaleMemberRole(String role) {
        published.setPublishedAt(null);
        currentSnapshot("R1", role, "none");
        currentSnapshot(null, role, null);
        enforceDeniedTransition();

        assertDoesNotThrow(() -> invoke("move", true));
        verify(transitions).check("W1", "done", "backlog", null, true, true);
        verify(tasks).update(published);
        verifyNoInteractions(workspaces);
    }

    private void invoke(String entrypoint, boolean force) {
        if ("move".equals(entrypoint)) {
            TaskMoveRequest req = moveRequest("backlog");
            req.setForce(force);
            service.move("U1", "W1", "K1", req);
        } else if ("bulk".equals(entrypoint)) {
            TaskBulkMoveRequest req = new TaskBulkMoveRequest();
            req.setIds(Collections.singletonList("K1"));
            req.setColumn("backlog");
            req.setForce(force);
            service.bulkMove("U1", "W1", req);
        } else if ("reopen".equals(entrypoint)) {
            TaskReopenRequest req = new TaskReopenRequest();
            req.setForce(force);
            service.reopen("U1", "W1", "K1", req);
        } else if ("edit".equals(entrypoint)) {
            service.beforeEditColumnChange("U1", "W1", "K1", "done", "backlog", null, force, false);
        } else {
            throw new AssertionError("Unknown workflow entrypoint: " + entrypoint);
        }
    }

    private void enforceDeniedTransition() {
        ColumnTransitionService rules = spy(new ColumnTransitionService(mock(ColumnTransitionMapper.class),
                mock(BoardColumnService.class), mock(WorkspaceMetaCache.class), mock(ActivityService.class)));
        doReturn(ColumnTransitionService.RULE_DENY).when(rules).effectiveRule("W1", "done", "backlog");
        when(transitions.check(anyString(), anyString(), anyString(), any(), anyBoolean(), anyBoolean()))
                .thenAnswer(call -> rules.check(call.getArgument(0), call.getArgument(1), call.getArgument(2),
                        call.getArgument(3), call.getArgument(4), call.getArgument(5)));
    }

    private void staleRole(String role) {
        WorkspaceMember member = new WorkspaceMember();
        member.setRole(role);
        when(members.selectMember("W1", "U1")).thenReturn(member);
        Workspace workspace = new Workspace();
        workspace.setMyRole(role);
        when(workspaces.requireMember("U1", "W1")).thenReturn(workspace);
    }

    private void currentSnapshot(String projectId, String role, String grant) {
        Map<String, Object> snapshot = null;
        if (role != null) {
            snapshot = new HashMap<String, Object>();
            snapshot.put("role", role);
            snapshot.put("access", grant);
            snapshot.put("projectOwnerUserId", "U-other");
        }
        when(members.selectDeliveryAccessForUpdate("W1", "U1", projectId)).thenReturn(snapshot);
    }

    @Test
    void scopeHelperSortsAndDeduplicatesProjectLocks() {
        com.hourglass.mapper.ReleaseMapper mapper = mock(com.hourglass.mapper.ReleaseMapper.class);
        when(mapper.lockProject("W1", "R1")).thenReturn("R1");
        when(mapper.lockProject("W1", "R2")).thenReturn("R2");
        new DeliveryScopeLock(mapper).lockProjects("W1", "R2", null, "R1", "R2", "");
        InOrder order = inOrder(mapper);
        order.verify(mapper).lockProject("W1", "R1");
        order.verify(mapper).lockProject("W1", "R2");
        verifyNoMoreInteractions(mapper);
    }
}
