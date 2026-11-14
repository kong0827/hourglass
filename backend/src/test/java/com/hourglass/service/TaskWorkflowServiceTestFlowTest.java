package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.common.Consts;
import com.hourglass.dto.TaskMoveRequest;
import com.hourglass.entity.Task;
import com.hourglass.entity.WorkspaceMember;
import com.hourglass.mapper.SubtaskMapper;
import com.hourglass.mapper.TaskLogMapper;
import com.hourglass.mapper.TaskMapper;
import com.hourglass.mapper.VersionTaskMapper;
import com.hourglass.mapper.WorkspaceMemberMapper;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.LocalDateTime;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 测试窗口只由列流转驱动：进入测试中开新轮，离开测试中记录结束时间。 */
class TaskWorkflowServiceTestFlowTest {

    private final WorkspaceMemberMapper members = mock(WorkspaceMemberMapper.class);
    private final TaskMapper taskMapper = mock(TaskMapper.class);
    private final TaskSupport support = mock(TaskSupport.class);
    private final ProjectAccessService projectAccess = mock(ProjectAccessService.class);
    private final DeliveryScopeLock scopeLock = mock(DeliveryScopeLock.class);
    private final TaskAuditLogger audit = mock(TaskAuditLogger.class);
    private final TaskWorkflowService service = new TaskWorkflowService(
            taskMapper, mock(TaskLogMapper.class), mock(SubtaskMapper.class),
            support, mock(TimeLogService.class), mock(TaskCompletionService.class),
            audit, mock(NotificationEventService.class),
            mock(TaskWatchService.class), projectAccess,
            mock(ColumnTransitionService.class), mock(WorkspaceService.class),
            members, scopeLock);

    TaskWorkflowServiceTestFlowTest() {
        ReflectionTestUtils.setField(service, "versionTaskMapper", mock(VersionTaskMapper.class));
        ReflectionTestUtils.setField(service, "publications", mock(TaskPublicationService.class));
    }

    @Test
    void enteringTestingRecordsStartAndRequestTime() {
        Task task = new Task();

        service.applyTestTimestamps(task, Consts.COL_TEST, Consts.COL_TESTING);

        LocalDateTime now = LocalDateTime.now().withSecond(0).withNano(0);
        assertEquals(now, task.getTestStartedAt());
        assertEquals(now, task.getTestRequestedAt());
        assertNull(task.getTestFinishedAt());
    }

    @Test
    void enteringTestQueueOnlyMarksRequestTime() {
        Task task = new Task();

        service.applyTestTimestamps(task, Consts.COL_DOING, Consts.COL_TEST);

        assertEquals(LocalDateTime.now().withSecond(0).withNano(0), task.getTestRequestedAt());
        assertNull(task.getTestStartedAt());
    }

    @Test
    void leavingTestingRecordsFinishAndKeepsStart() {
        Task task = new Task();
        task.setTestStartedAt(LocalDateTime.of(2026, 11, 1, 9, 30));

        service.applyTestTimestamps(task, Consts.COL_TESTING, Consts.COL_DONE);

        assertEquals(LocalDateTime.of(2026, 11, 1, 9, 30), task.getTestStartedAt());
        assertEquals(LocalDateTime.now().withSecond(0).withNano(0), task.getTestFinishedAt());
    }

    @Test
    void returningToBacklogAlsoEndsTheRound() {
        Task task = new Task();
        task.setTestStartedAt(LocalDateTime.of(2026, 11, 1, 9, 30));

        service.applyTestTimestamps(task, Consts.COL_TESTING, Consts.COL_BACKLOG);

        assertEquals(LocalDateTime.now().withSecond(0).withNano(0), task.getTestFinishedAt());
    }

    @Test
    void requeueFromTestingKeepsOriginalRequestTime() {
        Task task = new Task();
        task.setTestRequestedAt(LocalDateTime.of(2026, 11, 1, 9, 0));
        task.setTestStartedAt(LocalDateTime.of(2026, 11, 1, 9, 30));

        service.applyTestTimestamps(task, Consts.COL_TESTING, Consts.COL_TEST);

        assertEquals(LocalDateTime.of(2026, 11, 1, 9, 0), task.getTestRequestedAt());
        assertEquals(LocalDateTime.now().withSecond(0).withNano(0), task.getTestFinishedAt());
    }

    @Test
    void reenteringTestingStartsANewRound() {
        Task task = new Task();
        task.setTestStartedAt(LocalDateTime.of(2026, 11, 1, 9, 30));
        task.setTestFinishedAt(LocalDateTime.of(2026, 11, 2, 10, 0));

        service.applyTestTimestamps(task, Consts.COL_DOING, Consts.COL_TESTING);

        LocalDateTime now = LocalDateTime.now().withSecond(0).withNano(0);
        assertEquals(now, task.getTestStartedAt());
        assertEquals(now, task.getTestRequestedAt());
        assertNull(task.getTestFinishedAt());
    }

    @Test
    void sortingInsideTestingDoesNotResetTheWindow() {
        Task task = new Task();
        task.setTestStartedAt(LocalDateTime.of(2026, 11, 1, 9, 30));

        service.applyTestTimestamps(task, Consts.COL_TESTING, Consts.COL_TESTING);

        assertEquals(LocalDateTime.of(2026, 11, 1, 9, 30), task.getTestStartedAt());
        assertNull(task.getTestFinishedAt());
    }

    @Test
    void unclaimedTestQueueStaysUnclaimedOnMoveIn() {
        Task task = new Task();

        boolean claimed = service.applyTestTransition(task, Consts.COL_DOING, Consts.COL_TEST,
                "w1", "u1", true);

        assertFalse(claimed);
        assertNull(task.getTestOwnerUserId());
    }

    @Test
    void enteringTestingClaimsTesterWhenUnclaimed() {
        WorkspaceMember member = new WorkspaceMember();
        member.setUserId("u1");
        member.setDisplayName("张三");
        when(members.selectMember("w1", "u1")).thenReturn(member);
        Task task = new Task();

        boolean claimed = service.applyTestTransition(task, Consts.COL_TEST, Consts.COL_TESTING,
                "w1", "u1", true);

        assertTrue(claimed);
        assertEquals("u1", task.getTestOwnerUserId());
        assertEquals("张三", task.getTestOwner());
    }

    @Test
    void existingTesterIsNotOverwritten() {
        Task task = new Task();
        task.setTestOwnerUserId("u2");
        task.setTestOwner("李四");

        boolean claimed = service.claimTestOwner(task, "w1", "u1");

        assertFalse(claimed);
        assertEquals("u2", task.getTestOwnerUserId());
    }

    @Test
    void claimTestFillsTesterAndStartTime() {
        Task task = new Task();
        task.setId("t1");
        task.setWorkspaceId("w1");
        task.setBoardColumn(Consts.COL_TESTING);
        when(support.require("w1", "t1")).thenReturn(task);
        when(scopeLock.lockTask("w1", "t1")).thenReturn(task);
        when(taskMapper.update(any(Task.class))).thenReturn(1);
        when(taskMapper.selectById("t1")).thenReturn(task);
        WorkspaceMember member = new WorkspaceMember();
        member.setUserId("u1");
        member.setDisplayName("张三");
        when(members.selectMember("w1", "u1")).thenReturn(member);

        service.claimTest("u1", "w1", "t1");

        assertEquals("u1", task.getTestOwnerUserId());
        assertEquals("张三", task.getTestOwner());
        LocalDateTime now = LocalDateTime.now().withSecond(0).withNano(0);
        assertEquals(now, task.getTestStartedAt());
        assertEquals(now, task.getTestRequestedAt());
        verify(projectAccess).assertWriteForUpdate("w1", "u1", null);
        verify(audit).log("u1", "w1", "t1", "update", "认领测试负责人，开始测试");
    }

    @Test
    void claimTestKeepsExistingStartTimeAndBackfillsRequestTime() {
        Task task = new Task();
        task.setId("t1");
        task.setWorkspaceId("w1");
        task.setBoardColumn(Consts.COL_TESTING);
        task.setTestStartedAt(LocalDateTime.of(2026, 11, 1, 9, 30));
        when(support.require("w1", "t1")).thenReturn(task);
        when(scopeLock.lockTask("w1", "t1")).thenReturn(task);
        when(taskMapper.update(any(Task.class))).thenReturn(1);
        when(taskMapper.selectById("t1")).thenReturn(task);

        service.claimTest("u1", "w1", "t1");

        assertEquals(LocalDateTime.of(2026, 11, 1, 9, 30), task.getTestStartedAt());
        assertNotNull(task.getTestRequestedAt());
    }

    @Test
    void claimTestRejectsWhenTesterAlreadyAssigned() {
        Task task = new Task();
        task.setId("t1");
        task.setWorkspaceId("w1");
        task.setBoardColumn(Consts.COL_TESTING);
        task.setTestOwnerUserId("u2");
        when(support.require("w1", "t1")).thenReturn(task);
        when(scopeLock.lockTask("w1", "t1")).thenReturn(task);

        AppException ex = org.junit.jupiter.api.Assertions.assertThrows(AppException.class,
                () -> service.claimTest("u1", "w1", "t1"));

        assertEquals(409, ex.getCode());
        verify(taskMapper, never()).update(any(Task.class));
    }

    @Test
    void claimTestRejectsOutsideTestingColumn() {
        Task task = new Task();
        task.setId("t1");
        task.setWorkspaceId("w1");
        task.setBoardColumn(Consts.COL_TEST);
        when(support.require("w1", "t1")).thenReturn(task);
        when(scopeLock.lockTask("w1", "t1")).thenReturn(task);

        AppException ex = org.junit.jupiter.api.Assertions.assertThrows(AppException.class,
                () -> service.claimTest("u1", "w1", "t1"));

        assertEquals(400, ex.getCode());
    }

    @Test
    void bulkMoveKeepsTaskUnclaimed() {
        Task task = new Task();
        TaskMoveRequest one = new TaskMoveRequest();
        one.setColumn(Consts.COL_TESTING);
        one.setAutoClaim(Boolean.FALSE);

        boolean claimed = service.applyTestTransition(task, Consts.COL_TEST, Consts.COL_TESTING,
                "w1", "u1", Boolean.TRUE.equals(one.getAutoClaim()));

        assertFalse(claimed);
        assertNull(task.getTestOwnerUserId());
        assertEquals(LocalDateTime.now().withSecond(0).withNano(0), task.getTestStartedAt());
    }
}
