package com.devstudio.kanban.service;

import com.devstudio.kanban.dto.TaskMoveRequest;
import com.devstudio.kanban.entity.Task;
import com.devstudio.kanban.mapper.SubtaskMapper;
import com.devstudio.kanban.mapper.TaskLogMapper;
import com.devstudio.kanban.mapper.TaskMapper;
import org.junit.jupiter.api.Test;

import java.util.Collections;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class TaskWorkflowServiceNotificationTest {

    private final TaskMapper tasks = mock(TaskMapper.class);
    private final TaskSupport support = mock(TaskSupport.class);
    private final NotificationEventService events = mock(NotificationEventService.class);
    private final TaskWorkflowService service = new TaskWorkflowService(tasks, mock(TaskLogMapper.class),
            mock(SubtaskMapper.class), support, mock(TimeLogService.class),
            mock(TaskCompletionService.class), mock(TaskAuditLogger.class), events,
            mock(ProjectAccessService.class));

    @Test
    void moveToAnotherColumnNotifiesOwner() {
        move("U2", "doing", "backlog");

        verify(events).notify(eq("U1"), eq("W1"), eq(UserNotificationPreferenceService.TASK_UPDATED),
                eq("任务更新：Task"), eq("从「进行中」移动到「待处理」"), eq("K1"), isNull());
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
    }

    private void move(String actorId, String from, String to) {
        Task task = new Task();
        task.setId("K1");
        task.setWorkspaceId("W1");
        task.setTitle("Task");
        task.setOwnerUserId("U1");
        task.setBoardColumn(from);
        when(support.require("W1", "K1")).thenReturn(task);
        when(tasks.selectColumnTasks("W1", to)).thenReturn(Collections.emptyList());
        when(support.columnName("W1", "doing")).thenReturn("进行中");
        when(support.columnName("W1", "backlog")).thenReturn("待处理");
        TaskMoveRequest req = new TaskMoveRequest();
        req.setColumn(to);
        req.setAutoTimer(false);
        req.setAutoResume(false);

        service.move(actorId, "W1", "K1", req);
    }
}
