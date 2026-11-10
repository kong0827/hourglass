package com.hourglass.service;

import com.hourglass.common.Consts;
import com.hourglass.entity.Task;
import com.hourglass.mapper.SubtaskMapper;
import com.hourglass.mapper.TaskLogMapper;
import com.hourglass.mapper.TaskMapper;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.Mockito.mock;

/** 测试窗口只由列流转驱动：进入测试中开新轮，离开测试中记录结束日。 */
class TaskWorkflowServiceTestFlowTest {

    private final TaskWorkflowService service = new TaskWorkflowService(
            mock(TaskMapper.class), mock(TaskLogMapper.class), mock(SubtaskMapper.class),
            mock(TaskSupport.class), mock(TimeLogService.class), mock(TaskCompletionService.class),
            mock(TaskAuditLogger.class), mock(NotificationEventService.class),
            mock(TaskWatchService.class), mock(ProjectAccessService.class),
            mock(ColumnTransitionService.class), mock(WorkspaceService.class),
            mock(DeliveryScopeLock.class));

    @Test
    void enteringTestingRecordsStart() {
        Task task = new Task();

        service.applyTestTimestamps(task, Consts.COL_TEST, Consts.COL_TESTING);

        assertEquals(LocalDate.now(), task.getTestStartedAt());
        assertNull(task.getTestFinishedAt());
    }

    @Test
    void leavingTestingRecordsFinishAndKeepsStart() {
        Task task = new Task();
        task.setTestStartedAt(LocalDate.of(2026, 11, 1));

        service.applyTestTimestamps(task, Consts.COL_TESTING, Consts.COL_DONE);

        assertEquals(LocalDate.of(2026, 11, 1), task.getTestStartedAt());
        assertEquals(LocalDate.now(), task.getTestFinishedAt());
    }

    @Test
    void returningToBacklogAlsoEndsTheRound() {
        Task task = new Task();
        task.setTestStartedAt(LocalDate.of(2026, 11, 1));

        service.applyTestTimestamps(task, Consts.COL_TESTING, Consts.COL_BACKLOG);

        assertEquals(LocalDate.now(), task.getTestFinishedAt());
    }

    @Test
    void reenteringTestingStartsANewRound() {
        Task task = new Task();
        task.setTestStartedAt(LocalDate.of(2026, 11, 1));
        task.setTestFinishedAt(LocalDate.of(2026, 11, 2));

        service.applyTestTimestamps(task, Consts.COL_DOING, Consts.COL_TESTING);

        assertEquals(LocalDate.now(), task.getTestStartedAt());
        assertNull(task.getTestFinishedAt());
    }

    @Test
    void sortingInsideTestingDoesNotResetTheWindow() {
        Task task = new Task();
        task.setTestStartedAt(LocalDate.of(2026, 11, 1));

        service.applyTestTimestamps(task, Consts.COL_TESTING, Consts.COL_TESTING);

        assertEquals(LocalDate.of(2026, 11, 1), task.getTestStartedAt());
        assertNull(task.getTestFinishedAt());
    }
}
