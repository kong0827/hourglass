package com.hourglass.common;

import com.hourglass.entity.Task;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;

import static org.junit.jupiter.api.Assertions.assertEquals;

class TaskCalcTest {

    private static Task task(String col, Integer progress, LocalDate due) {
        Task t = new Task();
        t.setBoardColumn(col);
        t.setProgress(progress);
        t.setDueDate(due);
        return t;
    }

    @Test
    void progressIsForcedTo100OnlyInDone() {
        assertEquals(100, TaskCalc.progressOf(task(Consts.COL_DONE, 10, null)));
        assertEquals(40, TaskCalc.progressOf(task(Consts.COL_DOING, 40, null)));
        assertEquals(0, TaskCalc.progressOf(task(Consts.COL_BACKLOG, null, null)));
    }

    @Test
    void dueKindBoundaries() {
        LocalDate today = LocalDate.of(2026, 10, 31);
        assertEquals("none", TaskCalc.dueKind(task(Consts.COL_DOING, 0, null), today));
        assertEquals("done", TaskCalc.dueKind(task(Consts.COL_DONE, 100, today.minusDays(5)), today));
        assertEquals("over", TaskCalc.dueKind(task(Consts.COL_DOING, 0, today.minusDays(1)), today));
        assertEquals("today", TaskCalc.dueKind(task(Consts.COL_DOING, 0, today), today));
        assertEquals("soon", TaskCalc.dueKind(task(Consts.COL_DOING, 0, today.plusDays(3)), today));
        assertEquals("ok", TaskCalc.dueKind(task(Consts.COL_DOING, 0, today.plusDays(4)), today));
    }
}
