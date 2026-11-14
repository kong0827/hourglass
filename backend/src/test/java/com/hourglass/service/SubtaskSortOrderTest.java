package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.dto.SubtaskReorderRequest;
import com.hourglass.dto.SubtaskRequest;
import com.hourglass.entity.Subtask;
import com.hourglass.entity.Task;
import com.hourglass.entity.TaskLog;
import com.hourglass.mapper.SubtaskMapper;
import com.hourglass.mapper.TaskLogMapper;
import com.hourglass.mapper.TaskMapper;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 检查项排序：新建追加末尾、重排只接受当前清单的全排列、只读项目与回收站任务不可改序。 */
class SubtaskSortOrderTest {

    private static final String WS = "W1";
    private static final String USER = "U1";
    private static final String TASK = "T1";
    private static final String PROJ = "P1";

    private final SubtaskMapper subtasks = mock(SubtaskMapper.class);
    private final TaskMapper tasks = mock(TaskMapper.class);
    private final TaskLogMapper logs = mock(TaskLogMapper.class);
    private final ProjectAccessService access = mock(ProjectAccessService.class);
    private final SubtaskService service = new SubtaskService(subtasks, tasks, logs, access);

    private void givenTask() {
        Task t = new Task();
        t.setId(TASK);
        t.setWorkspaceId(WS);
        t.setReqId(PROJ);
        when(tasks.selectById(TASK)).thenReturn(t);
    }

    private void givenChecklist(Long... ids) {
        List<Subtask> list = new ArrayList<Subtask>();
        for (int i = 0; i < ids.length; i++) {
            list.add(subtask(ids[i], i));
        }
        when(subtasks.selectByTaskId(WS, TASK)).thenReturn(list);
    }

    private Subtask subtask(Long id, int order) {
        Subtask s = new Subtask();
        s.setId(id);
        s.setTaskId(TASK);
        s.setWorkspaceId(WS);
        s.setTitle("检查项 " + id);
        s.setDone(Boolean.FALSE);
        s.setSortOrder(order);
        return s;
    }

    private SubtaskReorderRequest reorder(Long... ids) {
        SubtaskReorderRequest req = new SubtaskReorderRequest();
        req.setIds(ids == null ? null : Arrays.asList(ids));
        return req;
    }

    private void assertNoWrite() {
        verify(subtasks, never()).updateSortOrder(anyString(), anyLong(), anyInt());
        verify(logs, never()).insert(any(TaskLog.class));
    }

    @Test
    void createAppendsAfterLastItem() {
        givenTask();
        when(subtasks.selectMaxSortOrder(WS, TASK)).thenReturn(2);
        when(subtasks.selectById(anyLong())).thenReturn(subtask(9L, 3));
        SubtaskRequest req = new SubtaskRequest();
        req.setTitle("补充灰度开关说明");

        service.create(USER, WS, TASK, req);

        ArgumentCaptor<Subtask> cap = ArgumentCaptor.forClass(Subtask.class);
        verify(subtasks).insert(cap.capture());
        assertEquals(Integer.valueOf(3), cap.getValue().getSortOrder());
        assertFalse(cap.getValue().getDone());
        verify(access).assertWrite(WS, USER, PROJ);
    }

    @Test
    void createOnEmptyChecklistStartsAtZero() {
        givenTask();
        when(subtasks.selectMaxSortOrder(WS, TASK)).thenReturn(-1);
        when(subtasks.selectById(anyLong())).thenReturn(subtask(9L, 0));
        SubtaskRequest req = new SubtaskRequest();
        req.setTitle("第一项");

        service.create(USER, WS, TASK, req);

        ArgumentCaptor<Subtask> cap = ArgumentCaptor.forClass(Subtask.class);
        verify(subtasks).insert(cap.capture());
        assertEquals(Integer.valueOf(0), cap.getValue().getSortOrder());
    }

    @Test
    void reorderRenumbersWholePermutationAndLogsOnce() {
        givenTask();
        givenChecklist(1L, 2L, 3L);

        service.reorder(USER, WS, TASK, reorder(3L, 1L, 2L));

        verify(subtasks).updateSortOrder(WS, 3L, 0);
        verify(subtasks).updateSortOrder(WS, 1L, 1);
        verify(subtasks).updateSortOrder(WS, 2L, 2);
        verify(access).assertWrite(WS, USER, PROJ);
        ArgumentCaptor<TaskLog> cap = ArgumentCaptor.forClass(TaskLog.class);
        verify(logs).insert(cap.capture());
        assertEquals("调整检查项顺序", cap.getValue().getDetail());
        assertEquals(TASK, cap.getValue().getTaskId());
    }

    @Test
    void reorderRejectsMissingItem() {
        givenTask();
        givenChecklist(1L, 2L, 3L);

        AppException ex = assertThrows(AppException.class, () -> service.reorder(USER, WS, TASK, reorder(1L, 2L)));
        assertEquals(400, ex.getCode());
        assertEquals("排序清单与当前检查项不一致，请刷新后重试", ex.getMessage());
        assertNoWrite();
    }

    @Test
    void reorderRejectsDuplicateId() {
        givenTask();
        givenChecklist(1L, 2L, 3L);

        assertEquals(400, assertThrows(AppException.class,
                () -> service.reorder(USER, WS, TASK, reorder(1L, 1L, 2L))).getCode());
        assertNoWrite();
    }

    @Test
    void reorderRejectsIdFromAnotherTask() {
        givenTask();
        givenChecklist(1L, 2L, 3L);

        assertEquals(400, assertThrows(AppException.class,
                () -> service.reorder(USER, WS, TASK, reorder(1L, 2L, 99L))).getCode());
        assertNoWrite();
    }

    @Test
    void reorderRejectsEmptyAndNullList() {
        givenTask();
        givenChecklist(1L, 2L, 3L);

        assertEquals(400, assertThrows(AppException.class,
                () -> service.reorder(USER, WS, TASK, reorder())).getCode());
        assertEquals(400, assertThrows(AppException.class,
                () -> service.reorder(USER, WS, TASK, null)).getCode());
        assertEquals(400, assertThrows(AppException.class,
                () -> service.reorder(USER, WS, TASK, reorder((Long[]) null))).getCode());
        assertNoWrite();
    }

    @Test
    void reorderRejectsReadOnlyProject() {
        givenTask();
        givenChecklist(1L, 2L, 3L);
        doThrow(new AppException(403, "你对该项目只有查看权限")).when(access).assertWrite(WS, USER, PROJ);

        assertEquals(403, assertThrows(AppException.class,
                () -> service.reorder(USER, WS, TASK, reorder(3L, 2L, 1L))).getCode());
        assertNoWrite();
    }

    @Test
    void reorderRejectsTaskInRecycleBin() {
        Task t = new Task();
        t.setId(TASK);
        t.setWorkspaceId(WS);
        t.setReqId(PROJ);
        t.setDeletedAt(LocalDateTime.now());
        when(tasks.selectById(TASK)).thenReturn(t);

        assertEquals(404, assertThrows(AppException.class,
                () -> service.reorder(USER, WS, TASK, reorder(1L))).getCode());
        assertNoWrite();
    }

    @Test
    void updateDoneDoesNotTouchSortOrder() {
        givenTask();
        Subtask s = subtask(2L, 1);
        when(subtasks.selectById(2L)).thenReturn(s);
        SubtaskRequest req = new SubtaskRequest();
        req.setDone(Boolean.TRUE);

        service.update(USER, WS, 2L, req);

        ArgumentCaptor<Subtask> cap = ArgumentCaptor.forClass(Subtask.class);
        verify(subtasks).update(cap.capture());
        assertEquals(Integer.valueOf(1), cap.getValue().getSortOrder());
        assertEquals(Boolean.TRUE, cap.getValue().getDone());
        verify(subtasks, never()).updateSortOrder(anyString(), anyLong(), anyInt());
    }

    @Test
    void listKeepsMapperOrderAndPages() {
        givenTask();
        when(subtasks.countByTaskId(WS, TASK)).thenReturn(3);
        when(subtasks.selectPageByTaskId(WS, TASK, 0, 100))
                .thenReturn(Arrays.asList(subtask(3L, 0), subtask(1L, 1), subtask(2L, 2)));

        List<Subtask> items = service.list(WS, USER, TASK, 0, 100).getItems();

        assertEquals(Arrays.asList(3L, 1L, 2L),
                Arrays.asList(items.get(0).getId(), items.get(1).getId(), items.get(2).getId()));
        verify(access).assertViewTask(anyString(), anyString(), any(Task.class));
    }

    @Test
    void reorderOnEmptyChecklistIsNoOp() {
        givenTask();
        when(subtasks.selectByTaskId(WS, TASK)).thenReturn(Collections.<Subtask>emptyList());

        service.reorder(USER, WS, TASK, reorder());

        assertNoWrite();
    }

    @Test
    void reorderWithUnchangedOrderDoesNotWriteOrLog() {
        givenTask();
        givenChecklist(1L, 2L, 3L);

        List<Subtask> returned = service.reorder(USER, WS, TASK, reorder(1L, 2L, 3L));

        assertEquals(3, returned.size());
        assertNoWrite();
    }
}
