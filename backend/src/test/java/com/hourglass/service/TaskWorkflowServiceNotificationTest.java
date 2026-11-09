package com.hourglass.service;

import com.hourglass.dto.TaskMoveRequest;
import com.hourglass.entity.Task;
import com.hourglass.mapper.SubtaskMapper;
import com.hourglass.mapper.TaskLogMapper;
import com.hourglass.mapper.TaskMapper;
import org.junit.jupiter.api.Test;

import java.util.Collections;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class TaskWorkflowServiceNotificationTest {

    private final DeliveryScopeLock scopeLock = mock(DeliveryScopeLock.class);
    private final TaskMapper tasks = mock(TaskMapper.class);
    private final TaskSupport support = mock(TaskSupport.class);
    private final NotificationEventService events = mock(NotificationEventService.class);
    private final TaskWatchService watchers = mock(TaskWatchService.class);
    private final ColumnTransitionService transitions = mock(ColumnTransitionService.class);
    private final TaskWorkflowService service = new TaskWorkflowService(tasks, mock(TaskLogMapper.class),
            mock(SubtaskMapper.class), support, mock(TimeLogService.class),
            mock(TaskCompletionService.class), mock(TaskAuditLogger.class), events, watchers,
            mock(ProjectAccessService.class), transitions, mock(WorkspaceService.class), scopeLock);

    @org.junit.jupiter.api.BeforeEach
    void setupResponse() {
        org.springframework.test.util.ReflectionTestUtils.setField(service, "versionTaskMapper", mock(com.hourglass.mapper.VersionTaskMapper.class));
        org.springframework.test.util.ReflectionTestUtils.setField(service, "publications", mock(TaskPublicationService.class));
    }

    @Test
    void moveToAnotherColumnNotifiesOwner() {
        move("U2", "doing", "backlog");

        verify(events).notify(eq("U1"), eq("W1"), eq(UserNotificationPreferenceService.TASK_UPDATED),
                eq("任务更新：Task"), eq("从「进行中」移动到「待处理」"), eq("K1"), isNull());
    }

    @Test
    void moveToAnotherColumnNotifiesWatchers() {
        move("U2", "doing", "backlog");

        verify(watchers).notifyWatchers(eq("W1"), eq("K1"), eq("U2"),
                eq(UserNotificationPreferenceService.TASK_WATCH),
                eq("「Task」已流转"), eq("从「进行中」移动到「待处理」"), isNull(),
                eq(Collections.singletonList("U1")));
    }

    @Test
    void moveByOwnerDoesNotNotifySelf() {
        move("U1", "doing", "backlog");

        verifyNoInteractions(events);
    }

    @Test
    void columnReorderDoesNotCreateUpdateEvent() {
        move("U2", "doing", "doing");

        verifyNoInteractions(events);
        verifyNoInteractions(watchers);
    }

    @Test
    void editColumnChangeNotifiesWatchersOnly() {
        Task task = new Task();
        task.setId("K1");
        task.setWorkspaceId("W1");
        task.setTitle("Task");
        task.setOwnerUserId("U1");
        task.setBoardColumn("done");
        when(support.columnName("W1", "doing")).thenReturn("进行中");
        when(support.columnName("W1", "done")).thenReturn("已完成");

        service.afterEditColumnChange("U2", "W1", task, "doing", null);

        // 负责人由编辑入口合并成一条 task_updated，这里不发；关注者照常，负责人进 skip
        verifyNoInteractions(events);
        verify(watchers).notifyWatchers(eq("W1"), eq("K1"), eq("U2"),
                eq(UserNotificationPreferenceService.TASK_WATCH),
                eq("「Task」已流转"), eq("从「进行中」移动到「已完成」"), isNull(),
                eq(Collections.singletonList("U1")));
    }

    private void move(String actorId, String from, String to) {
        Task task = new Task();
        task.setId("K1");
        task.setWorkspaceId("W1");
        task.setTitle("Task");
        task.setOwnerUserId("U1");
        task.setBoardColumn(from);
        when(support.require("W1", "K1")).thenReturn(task);
        when(scopeLock.lockTask("W1", "K1")).thenReturn(task);
        when(tasks.selectColumnTasks("W1", to)).thenReturn(Collections.emptyList());
        when(support.columnName("W1", "doing")).thenReturn("进行中");
        when(support.columnName("W1", "backlog")).thenReturn("待处理");
        TaskMoveRequest req = new TaskMoveRequest();
        req.setColumn(to);
        req.setAutoTimer(false);
        req.setAutoResume(false);
        when(transitions.check("W1", from, to, null, false, false))
                .thenReturn(new ColumnTransitionService.Decision("allow", null, false));

        service.move(actorId, "W1", "K1", req);
    }
}
