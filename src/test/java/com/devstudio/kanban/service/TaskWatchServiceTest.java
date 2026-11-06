package com.devstudio.kanban.service;

import com.devstudio.kanban.common.AppException;
import com.devstudio.kanban.entity.Task;
import com.devstudio.kanban.mapper.TaskMapper;
import com.devstudio.kanban.mapper.TaskWatchMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;
import java.util.Arrays;
import java.util.Collections;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class TaskWatchServiceTest {

    private static final String WS = "W1";
    private static final String TASK = "K1";
    private static final String ME = "U1";

    private final TaskWatchMapper watches = mock(TaskWatchMapper.class);
    private final TaskMapper tasks = mock(TaskMapper.class);
    private final NotificationEventService events = mock(NotificationEventService.class);
    private final TaskWatchService service = new TaskWatchService(watches, tasks,
            mock(ProjectAccessService.class), events);

    @BeforeEach
    void setUp() {
        Task t = new Task();
        t.setId(TASK);
        t.setWorkspaceId(WS);
        t.setTitle("Task");
        when(tasks.selectById(TASK)).thenReturn(t);
    }

    @Test
    void watchTurnsOnAndReturnsCurrentState() {
        when(watches.countMine(WS, TASK, ME)).thenReturn(1);
        when(watches.countByTask(WS, TASK)).thenReturn(2);

        Map<String, Object> res = service.watch(ME, WS, TASK);

        verify(watches).insertIgnore(WS, TASK, ME);
        assertEquals(Boolean.TRUE, res.get("watching"));
        assertEquals(2, res.get("count"));
    }

    @Test
    void unwatchTurnsOff() {
        when(watches.countMine(WS, TASK, ME)).thenReturn(0);
        when(watches.countByTask(WS, TASK)).thenReturn(1);

        Map<String, Object> res = service.unwatch(ME, WS, TASK);

        verify(watches).delete(WS, TASK, ME);
        assertEquals(Boolean.FALSE, res.get("watching"));
    }

    @Test
    void cannotWatchTaskInTrash() {
        Task trashed = new Task();
        trashed.setId(TASK);
        trashed.setWorkspaceId(WS);
        trashed.setDeletedAt(LocalDateTime.now());
        when(tasks.selectById(TASK)).thenReturn(trashed);

        AppException ex = assertThrows(AppException.class, () -> service.watch(ME, WS, TASK));

        assertEquals(400, ex.getCode());
        verify(watches, never()).insertIgnore(anyString(), anyString(), anyString());
    }

    @Test
    void notifyWatchersSkipsActorAndAlreadyNotifiedUsers() {
        when(watches.selectUserIdsByTask(WS, TASK)).thenReturn(Arrays.asList(ME, "U-owner", "U-watch"));

        service.notifyWatchers(WS, TASK, ME, UserNotificationPreferenceService.TASK_UPDATED,
                "任务更新", "detail", "R1", Collections.singletonList("U-owner"));

        verify(events, never()).notify(eq(ME), anyString(), anyString(), anyString(),
                anyString(), anyString(), anyString());
        verify(events, never()).notify(eq("U-owner"), anyString(), anyString(), anyString(),
                anyString(), anyString(), anyString());
        verify(events).notify(eq("U-watch"), eq(WS), eq(UserNotificationPreferenceService.TASK_UPDATED),
                eq("任务更新"), eq("detail"), eq(TASK), eq("R1"));
    }

    @Test
    void watcherReadFailureDoesNotBreakBusinessFlow() {
        when(watches.selectUserIdsByTask(WS, TASK)).thenThrow(new RuntimeException("table missing"));

        assertTrue(service.watcherIds(WS, TASK).isEmpty());
        service.notifyWatchers(WS, TASK, ME, UserNotificationPreferenceService.TASK_UPDATED,
                "任务更新", "detail", null, null);
        verify(events, never()).notify(anyString(), anyString(), anyString(), anyString(),
                anyString(), anyString(), anyString());
    }
}
