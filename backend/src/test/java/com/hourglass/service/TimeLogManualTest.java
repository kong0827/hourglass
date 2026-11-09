package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.dto.PageResult;
import com.hourglass.entity.AppUser;
import com.hourglass.entity.Task;
import com.hourglass.entity.TaskLog;
import com.hourglass.entity.TimeLog;
import com.hourglass.entity.WorkspaceMember;
import com.hourglass.mapper.TaskLogMapper;
import com.hourglass.mapper.TaskMapper;
import com.hourglass.mapper.TimeLogMapper;
import com.hourglass.mapper.UserMapper;
import com.hourglass.mapper.WorkspaceMapper;
import com.hourglass.mapper.WorkspaceMemberMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.ArgumentCaptor;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class TimeLogManualTest {

    private static final String WS = "W1";
    private static final String TASK = "K1";
    private static final String REQ = "R1";
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

    private static Task task() {
        Task t = new Task();
        t.setId(TASK);
        t.setWorkspaceId(WS);
        t.setReqId(REQ);
        t.setTitle("任务");
        return t;
    }

    private static TimeLog manualLog(long id, String userId, String origin) {
        TimeLog tl = new TimeLog();
        tl.setId(id);
        tl.setTaskId(TASK);
        tl.setWorkspaceId(WS);
        tl.setUserId(userId);
        tl.setStartedAt(LocalDateTime.of(2026, 11, 5, 12, 0));
        tl.setEndedAt(LocalDateTime.of(2026, 11, 5, 12, 0));
        tl.setMinutes(90);
        tl.setOrigin(origin);
        return tl;
    }

    @BeforeEach
    void setUp() {
        when(taskMapper.selectById(TASK)).thenReturn(task());
    }

    @Test
    void addManualForSelfWritesManualRecordAtNoonAndReturnsStatus() {
        Map<String, Object> res = service.addManual(ME, WS, TASK, null,
                LocalDate.of(2026, 11, 5), 90, "联调支持");

        ArgumentCaptor<TimeLog> saved = ArgumentCaptor.forClass(TimeLog.class);
        verify(timeLogMapper).insertCompleted(saved.capture());
        TimeLog tl = saved.getValue();
        assertEquals(WS, tl.getWorkspaceId());
        assertEquals(TASK, tl.getTaskId());
        assertEquals(ME, tl.getUserId());
        assertEquals("manual", tl.getOrigin());
        assertEquals("联调支持", tl.getNote());
        assertEquals(90, tl.getMinutes());
        assertEquals(LocalDateTime.of(2026, 11, 5, 12, 0), tl.getStartedAt());
        assertEquals(tl.getStartedAt(), tl.getEndedAt());
        verify(projectAccess).assertWrite(WS, ME, REQ);
        verify(logMapper).insert(any(TaskLog.class));
        assertEquals(Boolean.FALSE, res.get("running"));
        assertEquals(0, res.get("totalMinutes"));
    }

    @Test
    void addManualForAnotherMemberIsAllowedForProjectWriter() {
        when(memberMapper.selectMember(WS, "U2")).thenReturn(new WorkspaceMember());

        service.addManual(ME, WS, TASK, "U2", LocalDate.of(2026, 11, 4), 30, null);

        ArgumentCaptor<TimeLog> saved = ArgumentCaptor.forClass(TimeLog.class);
        verify(timeLogMapper).insertCompleted(saved.capture());
        assertEquals("U2", saved.getValue().getUserId());
        assertEquals(30, saved.getValue().getMinutes());
        assertNull(saved.getValue().getNote());
    }

    @Test
    void addManualRejectsNonMemberTarget() {
        AppException ex = assertThrows(AppException.class, () -> service.addManual(ME, WS, TASK,
                "U-nobody", LocalDate.of(2026, 11, 5), 30, null));

        assertEquals(400, ex.getCode());
        verify(timeLogMapper, never()).insertCompleted(any(TimeLog.class));
    }

    @Test
    void addManualRejectsFutureDate() {
        AppException ex = assertThrows(AppException.class, () -> service.addManual(ME, WS, TASK,
                null, LocalDate.now().plusDays(1), 30, null));

        assertEquals(400, ex.getCode());
        verify(timeLogMapper, never()).insertCompleted(any(TimeLog.class));
    }

    @ParameterizedTest
    @ValueSource(ints = {0, 1441})
    void addManualRejectsMinutesOutOfRange(int minutes) {
        AppException ex = assertThrows(AppException.class, () -> service.addManual(ME, WS, TASK,
                null, LocalDate.of(2026, 11, 5), minutes, null));

        assertEquals(400, ex.getCode());
        verify(timeLogMapper, never()).insertCompleted(any(TimeLog.class));
    }

    @Test
    void addManualRequiresWritePermission() {
        doThrow(AppException.badRequest("无权限")).when(projectAccess).assertWrite(WS, ME, REQ);

        AppException ex = assertThrows(AppException.class, () -> service.addManual(ME, WS, TASK,
                null, LocalDate.of(2026, 11, 5), 30, null));

        assertEquals(400, ex.getCode());
        verify(timeLogMapper, never()).insertCompleted(any(TimeLog.class));
    }

    @Test
    void deleteRecordRemovesManualRecordAndLogs() {
        when(timeLogMapper.selectById(99L)).thenReturn(manualLog(99L, "U2", "manual"));

        service.deleteRecord(ME, WS, TASK, 99L);

        verify(timeLogMapper).deleteById(99L, WS);
        verify(logMapper).insert(any(TaskLog.class));
    }

    @Test
    void deleteRecordRemovesTimerRecordAndLogs() {
        when(timeLogMapper.selectById(99L)).thenReturn(manualLog(99L, "U2", "timer"));

        service.deleteRecord(ME, WS, TASK, 99L);

        verify(timeLogMapper).deleteById(99L, WS);
        verify(logMapper).insert(any(TaskLog.class));
    }

    @Test
    void deleteRecordRejectsRunningTimer() {
        TimeLog running = manualLog(99L, ME, "timer");
        running.setEndedAt(null);
        when(timeLogMapper.selectById(99L)).thenReturn(running);

        AppException ex = assertThrows(AppException.class, () -> service.deleteRecord(ME, WS, TASK, 99L));

        assertEquals(400, ex.getCode());
        verify(timeLogMapper, never()).deleteById(any(Long.class), eq(WS));
    }

    @Test
    void deleteRecordRefreshesCompletionSnapshotOfCompletedTask() {
        Task done = task();
        done.setCompletedAt(LocalDate.of(2026, 11, 5));
        when(taskMapper.selectById(TASK)).thenReturn(done);
        when(timeLogMapper.selectById(99L)).thenReturn(manualLog(99L, ME, "timer"));

        service.deleteRecord(ME, WS, TASK, 99L);

        verify(completionService).refreshWork(done);
    }

    @Test
    void deleteRecordLeavesSnapshotOfOpenTaskUntouched() {
        when(timeLogMapper.selectById(99L)).thenReturn(manualLog(99L, ME, "timer"));

        service.deleteRecord(ME, WS, TASK, 99L);

        verify(completionService, never()).refreshWork(any(Task.class));
    }

    @Test
    void addManualRefreshesCompletionSnapshotOfCompletedTask() {
        Task done = task();
        done.setCompletedAt(LocalDate.of(2026, 11, 5));
        when(taskMapper.selectById(TASK)).thenReturn(done);

        service.addManual(ME, WS, TASK, null, LocalDate.of(2026, 11, 6), 240, "修正");

        verify(completionService).refreshWork(done);
    }

    @Test
    void deleteRecordRejectsRecordOfAnotherWorkspace() {
        TimeLog foreign = manualLog(99L, "U2", "manual");
        foreign.setWorkspaceId("W-other");
        when(timeLogMapper.selectById(99L)).thenReturn(foreign);

        AppException ex = assertThrows(AppException.class, () -> service.deleteRecord(ME, WS, TASK, 99L));

        assertEquals(404, ex.getCode());
        verify(timeLogMapper, never()).deleteById(any(Long.class), eq(WS));
    }

    @Test
    void deleteRecordRejectsRecordOfAnotherTask() {
        when(timeLogMapper.selectById(99L)).thenReturn(manualLog(99L, "U2", "manual"));

        AppException ex = assertThrows(AppException.class, () -> service.deleteRecord(ME, WS, "K-other", 99L));

        assertEquals(404, ex.getCode());
        verify(timeLogMapper, never()).deleteById(any(Long.class), eq(WS));
    }

    @Test
    void recordsMapsFieldsAndFallsBackToTimerForLegacyOrigin() {
        TimeLog manual = manualLog(1L, "U2", "manual");
        manual.setNote("加班");
        TimeLog legacy = manualLog(2L, ME, null);
        when(timeLogMapper.countRecordsByTask(WS, TASK)).thenReturn(2);
        when(timeLogMapper.selectRecordsByTask(WS, TASK, 0, 100)).thenReturn(Arrays.asList(manual, legacy));
        AppUser u2 = new AppUser();
        u2.setId("U2");
        u2.setUsername("u2");
        u2.setDisplayName("小李");
        when(userMapper.selectByIds(Arrays.asList("U2", ME))).thenReturn(Collections.singletonList(u2));

        PageResult<Map<String, Object>> page = service.records(WS, TASK, ME, 0, 100);
        List<Map<String, Object>> list = page.getItems();

        verify(projectAccess).assertViewTask(WS, ME, taskMapper.selectById(TASK));
        assertEquals(2, page.getTotal());
        assertEquals(2, list.size());
        Map<String, Object> first = list.get(0);
        assertEquals(1L, first.get("id"));
        assertEquals("U2", first.get("userId"));
        assertEquals("小李", first.get("userName"));
        assertEquals("manual", first.get("origin"));
        assertEquals(90, first.get("minutes"));
        assertEquals("2026-11-05", first.get("date"));
        assertEquals("2026-11-05T12:00", first.get("startedAt"));
        assertEquals("2026-11-05T12:00", first.get("endedAt"));
        assertEquals("加班", first.get("note"));
        assertEquals(Boolean.FALSE, first.get("mine"));
        Map<String, Object> second = list.get(1);
        assertEquals("timer", second.get("origin"));
        assertTrue((Boolean) second.get("mine"));
        assertNull(second.get("note"));
    }
}
