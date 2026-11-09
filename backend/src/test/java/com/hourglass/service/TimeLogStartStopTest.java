package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.entity.AppUser;
import com.hourglass.entity.Task;
import com.hourglass.entity.TimeLog;
import com.hourglass.mapper.TaskLogMapper;
import com.hourglass.mapper.TaskMapper;
import com.hourglass.mapper.TimeLogMapper;
import com.hourglass.mapper.UserMapper;
import com.hourglass.mapper.WorkspaceMapper;
import com.hourglass.mapper.WorkspaceMemberMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;

import java.time.LocalDateTime;
import java.util.Arrays;
import java.util.Collections;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class TimeLogStartStopTest {

    private static final String WS = "W1";
    private static final String TASK = "K1";
    private static final String ME = "U1";

    private final TimeLogMapper timeLogMapper = mock(TimeLogMapper.class);
    private final TaskMapper taskMapper = mock(TaskMapper.class);
    private final TaskLogMapper logMapper = mock(TaskLogMapper.class);
    private final WorkspaceMapper workspaceMapper = mock(WorkspaceMapper.class);
    private final UserMapper userMapper = mock(UserMapper.class);
    private final WorkspaceMemberMapper memberMapper = mock(WorkspaceMemberMapper.class);
    private final ProjectAccessService projectAccess = mock(ProjectAccessService.class);
    private final TaskCompletionService completionService = mock(TaskCompletionService.class);
    private final TaskSupport taskSupport = mock(TaskSupport.class);
    private final TimeLogService service = new TimeLogService(timeLogMapper, taskMapper, logMapper,
            workspaceMapper, userMapper, memberMapper, projectAccess, completionService, taskSupport);

    @BeforeEach
    void setUp() {
        Task task = new Task();
        task.setId(TASK);
        task.setWorkspaceId(WS);
        task.setReqId("R1");
        task.setTitle("任务");
        when(taskMapper.selectById(TASK)).thenReturn(task);
    }

    @Test
    void startLocksAccountBeforeCheckingAndInserting() {
        service.start(ME, WS, TASK);

        InOrder order = inOrder(userMapper, timeLogMapper);
        order.verify(userMapper).lockById(ME);
        order.verify(timeLogMapper).selectRunningByTaskAndUser(TASK, ME);
        order.verify(timeLogMapper).selectRunningAllByUser(ME);
        order.verify(timeLogMapper).insert(any(TimeLog.class));
    }

    @Test
    void startDoesNotInsertWhenAlreadyRunning() {
        when(timeLogMapper.selectRunningByTaskAndUser(TASK, ME)).thenReturn(running());

        service.start(ME, WS, TASK);

        verify(userMapper).lockById(ME);
        verify(timeLogMapper, never()).selectRunningAllByUser(ME);
        verify(timeLogMapper, never()).insert(any(TimeLog.class));
    }

    @Test
    void stopLocksAccountBeforeCheckingAndClosing() {
        when(timeLogMapper.selectRunningByTaskAndUser(TASK, ME)).thenReturn(running(), (TimeLog) null);

        service.stop(ME, WS, TASK);

        InOrder order = inOrder(userMapper, timeLogMapper);
        order.verify(userMapper).lockById(ME);
        order.verify(timeLogMapper).selectRunningByTaskAndUser(TASK, ME);
        order.verify(timeLogMapper).closeRunning(eq(TASK), eq(ME), anyInt());
    }

    @Test
    void startManualRejectsBlockedTask() {
        Task blocked = task(TASK, "doing");
        blocked.setBlocked(true);
        when(taskMapper.selectById(TASK)).thenReturn(blocked);
        when(taskSupport.canTime(WS, "doing")).thenReturn(true);

        AppException ex = assertThrows(AppException.class, () -> service.startManual(ME, WS, TASK));

        assertEquals(400, ex.getCode());
        verify(timeLogMapper, never()).insert(any(TimeLog.class));
    }

    @Test
    void resumeSkipsBlockedTasks() {
        when(taskSupport.canTime(WS, "doing")).thenReturn(true);
        when(timeLogMapper.selectRunningAllByUser(ME)).thenReturn(Collections.<TimeLog>emptyList());
        AppUser me = new AppUser();
        me.setId(ME);
        me.setDisplayName("我");
        when(userMapper.selectById(ME)).thenReturn(me);
        Task blocked = task("K1", "doing");
        blocked.setBlocked(true);
        Task next = task("K2", "doing");
        when(taskMapper.selectColumnTasks(WS, "doing")).thenReturn(Arrays.asList(blocked, next));
        when(taskMapper.selectById("K2")).thenReturn(next);
        when(projectAccess.canWrite(WS, ME, "R1")).thenReturn(true);

        Task resumed = service.resumeInColumn(ME, WS, "doing", null);

        assertSame(next, resumed, "接力必须跳过阻塞任务");
        verify(timeLogMapper, times(1)).insert(any(TimeLog.class));
    }

    private static Task task(String id, String column) {
        Task task = new Task();
        task.setId(id);
        task.setWorkspaceId(WS);
        task.setReqId("R1");
        task.setTitle(id);
        task.setBoardColumn(column);
        task.setOwnerUserId(ME);
        return task;
    }

    private static TimeLog running() {
        TimeLog running = new TimeLog();
        running.setId(1L);
        running.setTaskId(TASK);
        running.setWorkspaceId(WS);
        running.setUserId(ME);
        running.setStartedAt(LocalDateTime.now());
        return running;
    }
}
