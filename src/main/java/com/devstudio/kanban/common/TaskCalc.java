package com.devstudio.kanban.common;

import com.devstudio.kanban.dto.BoardResponse;
import com.devstudio.kanban.entity.Task;

import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.List;

/**
 * 任务派生计算：与旧版前端保持一致的进度 / 截止状态 / 逾期计数规则
 */
public final class TaskCalc {

    private TaskCalc() {
    }

    public static int progressOf(Task t) {
        if (Consts.COL_DONE.equals(t.getBoardColumn())) {
            return 100;
        }
        return t.getProgress() == null ? 0 : t.getProgress();
    }

    /** @return none/done/over/today/soon/ok */
    public static String dueKind(Task t, LocalDate today) {
        if (t.getDueDate() == null) {
            return "none";
        }
        if (Consts.COL_DONE.equals(t.getBoardColumn())) {
            return "done";
        }
        long days = ChronoUnit.DAYS.between(today, t.getDueDate());
        if (days < 0) {
            return "over";
        }
        if (days == 0) {
            return "today";
        }
        if (days <= 3) {
            return "soon";
        }
        return "ok";
    }

    public static BoardResponse.Counts countDue(List<Task> tasks, LocalDate today) {
        BoardResponse.Counts counts = new BoardResponse.Counts();
        for (Task t : tasks) {
            String kind = dueKind(t, today);
            if ("over".equals(kind)) {
                counts.setOver(counts.getOver() + 1);
            } else if ("today".equals(kind)) {
                counts.setToday(counts.getToday() + 1);
            } else if ("soon".equals(kind)) {
                counts.setSoon(counts.getSoon() + 1);
            }
        }
        return counts;
    }
}
