package com.devstudio.kanban.service;

import com.devstudio.kanban.dto.TaskBucketRow;
import com.devstudio.kanban.dto.WorkSumRow;
import com.devstudio.kanban.entity.Task;
import com.devstudio.kanban.mapper.TaskCompletionRecordMapper;
import com.devstudio.kanban.mapper.TaskMapper;
import com.devstudio.kanban.mapper.TimeLogMapper;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.Arrays;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class MetricsServiceTest {

    private Task task(String due, String column) {
        Task t = new Task();
        t.setId("K" + due);
        t.setDueDate(due == null ? null : LocalDate.parse(due));
        t.setBoardColumn(column);
        return t;
    }

    @Test
    void overdueUsesSharedDueKind() {
        TaskMapper taskMapper = mock(TaskMapper.class);
        MetricsService m = new MetricsService(taskMapper, mock(TimeLogMapper.class),
                mock(TaskCompletionRecordMapper.class));
        LocalDate today = LocalDate.of(2026, 11, 1);
        List<Task> tasks = Arrays.asList(
                task("2026-10-30", "todo"),
                task("2026-11-01", "todo"),
                task("2026-10-20", "done"),
                task(null, "todo"));
        List<Task> over = m.overdue(tasks, today);
        assertEquals(1, over.size(), "已完成与无截止日期都不应算逾期");
        assertEquals("K2026-10-30", over.get(0).getId());
    }

    @Test
    void delegatesCompletionBucketsAndWork() {
        TaskMapper taskMapper = mock(TaskMapper.class);
        TimeLogMapper timeLogMapper = mock(TimeLogMapper.class);
        TaskCompletionRecordMapper completionMapper = mock(TaskCompletionRecordMapper.class);
        MetricsService m = new MetricsService(taskMapper, timeLogMapper, completionMapper);

        when(completionMapper.countByRange(eq("W1"), any(LocalDate.class), any(LocalDate.class))).thenReturn(7);
        assertEquals(7, m.completedCount("W1", LocalDate.of(2026, 10, 1), LocalDate.of(2026, 11, 1)));

        TaskBucketRow buckets = new TaskBucketRow();
        buckets.setBacklog(3);
        when(taskMapper.countBuckets(eq("W1"), any(LocalDate.class))).thenReturn(buckets);
        assertEquals(3, m.buckets("W1", LocalDate.now()).getBacklog());

        WorkSumRow work = new WorkSumRow();
        work.setTotalMine(120);
        when(timeLogMapper.sumWork(eq("W1"), eq("U1"), any(LocalDateTime.class), eq(null))).thenReturn(work);
        assertEquals(120, m.workMinutes("W1", "U1", LocalDateTime.now()).getTotalMine());
    }
}
