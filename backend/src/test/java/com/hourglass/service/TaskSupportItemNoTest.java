package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.entity.Task;
import com.hourglass.mapper.TaskMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DuplicateKeyException;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 工作项编号取号口径（sql/82）：项目内 MAX+1、撞唯一键重试、换项目重新取号。 */
class TaskSupportItemNoTest {

    private static final String WS = "W1";
    private static final String NUMBER_CLASH =
            "Duplicate entry 'W1-P-7' for key 'task.uk_task_item_no'";

    private TaskMapper tasks;

    @BeforeEach
    void setUp() {
        tasks = mock(TaskMapper.class);
    }

    @Test
    void createTakesTheNextNumberInItsProject() {
        when(tasks.selectNextItemNo(WS, "P")).thenReturn(7);

        Task t = task("T1", "P");
        TaskSupport.insertWithNo(tasks, t);

        assertEquals(Integer.valueOf(7), t.getItemNo());
        verify(tasks).insert(t);
    }

    @Test
    void tasksWithoutProjectShareOneNumberBucket() {
        when(tasks.selectNextItemNo(WS, null)).thenReturn(4);

        Task t = task("T1", null);
        TaskSupport.insertWithNo(tasks, t);

        assertEquals(Integer.valueOf(4), t.getItemNo());
    }

    @Test
    void concurrentNumberClashRecomputesAndRetries() {
        when(tasks.selectNextItemNo(WS, "P")).thenReturn(7, 8);
        doThrow(new DuplicateKeyException(NUMBER_CLASH)).doReturn(1).when(tasks).insert(any(Task.class));

        Task t = task("T1", "P");
        TaskSupport.insertWithNo(tasks, t);

        assertEquals(Integer.valueOf(8), t.getItemNo());
        verify(tasks, times(2)).insert(t);
    }

    @Test
    void clientIdClashIsNotDisguisedAsNumberConflict() {
        when(tasks.selectNextItemNo(WS, "P")).thenReturn(7);
        doThrow(new DuplicateKeyException("Duplicate entry 'T1' for key 'task.PRIMARY'"))
                .when(tasks).insert(any(Task.class));

        assertThrows(DuplicateKeyException.class, () -> TaskSupport.insertWithNo(tasks, task("T1", "P")));
        verify(tasks, times(1)).insert(any(Task.class));
    }

    @Test
    void exhaustedRetriesAskTheUserToRetry() {
        when(tasks.selectNextItemNo(WS, "P")).thenReturn(7);
        doThrow(new DuplicateKeyException(NUMBER_CLASH)).when(tasks).insert(any(Task.class));

        AppException e = assertThrows(AppException.class, () -> TaskSupport.insertWithNo(tasks, task("T1", "P")));

        assertEquals(400, e.getCode());
        verify(tasks, times(3)).insert(any(Task.class));
    }

    @Test
    void movingProjectRenumbersAndKeepsTheAffectedRowCountForCas() {
        when(tasks.selectNextItemNo(WS, "P2")).thenReturn(3);
        when(tasks.update(any(Task.class))).thenReturn(1);

        Task t = task("T1", "P2");
        t.setItemNo(9);

        assertEquals(1, TaskSupport.updateWithNo(tasks, t));
        assertEquals(Integer.valueOf(3), t.getItemNo());
    }

    @Test
    void moveClashRetriesWithoutLosingTheCasRowCount() {
        when(tasks.selectNextItemNo(WS, "P2")).thenReturn(3, 4);
        doThrow(new DuplicateKeyException(NUMBER_CLASH)).doReturn(1).when(tasks).update(any(Task.class));

        Task t = task("T1", "P2");

        assertEquals(1, TaskSupport.updateWithNo(tasks, t));
        assertEquals(Integer.valueOf(4), t.getItemNo());
        verify(tasks, times(2)).update(t);
    }

    private Task task(String id, String reqId) {
        Task t = new Task();
        t.setId(id);
        t.setWorkspaceId(WS);
        t.setReqId(reqId);
        t.setTitle("工作项");
        return t;
    }
}