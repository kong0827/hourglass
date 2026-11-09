package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.dto.TaskMoveRequest;
import com.hourglass.entity.Task;
import com.hourglass.mapper.SubtaskMapper;
import com.hourglass.mapper.TaskLogMapper;
import com.hourglass.mapper.TaskMapper;
import org.junit.jupiter.api.Test;

import java.util.Collections;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/** 抽屉里改列的计时口径必须与看板拖拽 / 列表行内移动一致。 */
class TaskWorkflowServiceTimerTest {

    private final DeliveryScopeLock scopeLock = mock(DeliveryScopeLock.class);
    private final TaskMapper tasks = mock(TaskMapper.class);
    private final TaskSupport support = mock(TaskSupport.class);
    private final TimeLogService timeLogs = mock(TimeLogService.class);
    private final ColumnTransitionService transitions = mock(ColumnTransitionService.class);
    private final TaskWorkflowService service = new TaskWorkflowService(tasks, mock(TaskLogMapper.class),
            mock(SubtaskMapper.class), support, timeLogs, mock(TaskCompletionService.class),
            mock(TaskAuditLogger.class), mock(NotificationEventService.class),
            mock(TaskWatchService.class), mock(ProjectAccessService.class), transitions,
            mock(WorkspaceService.class), scopeLock);

    @org.junit.jupiter.api.BeforeEach
    void setupResponse() {
        org.springframework.test.util.ReflectionTestUtils.setField(service, "versionTaskMapper", mock(com.hourglass.mapper.VersionTaskMapper.class));
        org.springframework.test.util.ReflectionTestUtils.setField(service, "publications", mock(TaskPublicationService.class));
    }

    @Test
    void editMoveToNormalColumnStartsTimer() {
        allow("backlog", "doing");
        when(support.canTime("W1", "doing")).thenReturn(true);

        service.beforeEditColumnChange("U1", "W1", "K1", "backlog", "doing", null, false, false);

        verify(timeLogs).start("U1", "W1", "K1");
        verify(timeLogs, never()).closeRunningForTask(anyString(), anyString(), anyString(), anyString());
    }

    @Test
    void dragMoveToNormalColumnDoesNotStartTimerForBlockedTask() {
        Task blocked = new Task();
        blocked.setId("K1");
        blocked.setWorkspaceId("W1");
        blocked.setReqId("R1");
        blocked.setTitle("Task");
        blocked.setBoardColumn("backlog");
        blocked.setBlocked(true);
        when(support.require("W1", "K1")).thenReturn(blocked);
        when(scopeLock.lockTask("W1", "K1")).thenReturn(blocked);
        when(support.canTime("W1", "doing")).thenReturn(true);
        when(tasks.selectColumnTasks("W1", "doing")).thenReturn(Collections.<Task>emptyList());
        allow("backlog", "doing");
        when(support.require("W1", "K1")).thenReturn(blocked);
        when(scopeLock.lockTask("W1", "K1")).thenReturn(blocked);
        TaskMoveRequest req = new TaskMoveRequest();
        req.setColumn("doing");

        service.move("U1", "W1", "K1", req);

        verify(timeLogs, never()).start(anyString(), anyString(), anyString());
    }

    @Test
    void editMoveToNormalColumnDoesNotStartForBlockedTask() {
        allow("backlog", "doing");
        when(support.canTime("W1", "doing")).thenReturn(true);

        service.beforeEditColumnChange("U1", "W1", "K1", "backlog", "doing", null, false, true);

        verify(timeLogs, never()).start(anyString(), anyString(), anyString());
    }

    @Test
    void editMoveToWaitingColumnStopsTimer() {
        allow("doing", "waiting");
        when(support.canTime("W1", "waiting")).thenReturn(false);
        when(support.processingRule("W1", "waiting")).thenReturn("waiting");

        service.beforeEditColumnChange("U1", "W1", "K1", "doing", "waiting", null, false, false);

        verify(timeLogs).closeRunningForTask("W1", "K1", "U1", "进入等待列");
        verify(timeLogs, never()).start(anyString(), anyString(), anyString());
    }

    @Test
    void editMoveToDoneClosesTimersAndResumesNext() {
        allow("doing", "done");

        service.beforeEditColumnChange("U1", "W1", "K1", "doing", "done", null, false, false);

        verify(timeLogs).closeRunningForTask("W1", "K1", "U1", "任务已完成");
        verify(timeLogs).resumeInColumn("U1", "W1", "doing", "K1");
        verify(timeLogs, never()).start(anyString(), anyString(), anyString());
    }

    @Test
    void editMoveRejectedByTransitionDoesNotTouchTimer() {
        prepareTask("doing");
        when(transitions.check("W1", "doing", "done", null, false, false))
                .thenThrow(new AppException(412, "该流转需要填写原因"));

        AppException ex = assertThrows(AppException.class, () -> service.beforeEditColumnChange(
                "U1", "W1", "K1", "doing", "done", null, false, false));

        assertEquals(412, ex.getCode());
        verifyNoInteractions(timeLogs);
    }

    @Test
    void editWithoutColumnChangeDoesNotTouchTimer() {
        service.beforeEditColumnChange("U1", "W1", "K1", "doing", "doing", null, false, false);

        verifyNoInteractions(timeLogs);
        verifyNoInteractions(transitions);
    }

    private void prepareTask(String from) {
        Task task = new Task();
        task.setId("K1");
        task.setWorkspaceId("W1");
        task.setBoardColumn(from);
        when(support.require("W1", "K1")).thenReturn(task);
        when(scopeLock.lockTask("W1", "K1")).thenReturn(task);
    }

    private void allow(String from, String to) {
        prepareTask(from);
        when(transitions.check("W1", from, to, null, false, false))
                .thenReturn(new ColumnTransitionService.Decision("allow", null, false));
    }
}
