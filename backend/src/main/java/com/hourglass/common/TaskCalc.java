package com.hourglass.common;

import com.hourglass.dto.BoardResponse;
import com.hourglass.entity.Task;

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

    /** @return none/done/ended/over/today/soon/ok */
    public static String dueKind(Task t, LocalDate today) {
        return dueKind(t.getBoardColumn(), t.getProcessingRule(), t.getDueDate(), today);
    }

    /** 窄列投影（看板 meta / counts）复用同一口径 */
    public static String dueKind(String boardColumn, LocalDate dueDate, LocalDate today) {
        return dueKind(boardColumn, null, dueDate, today);
    }

    /** 带处理规则的到期判断：ended 列不计执行逾期 */
    public static String dueKind(String boardColumn, String processingRule, LocalDate dueDate, LocalDate today) {
        if (dueDate == null) {
            return "none";
        }
        if (Consts.COL_DONE.equals(boardColumn) || "ended".equals(processingRule)) {
            return Consts.COL_DONE.equals(boardColumn) ? "done" : "ended";
        }
        long days = ChronoUnit.DAYS.between(today, dueDate);
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

    /**
     * 统计分桶：按列的处理规则而不是硬编码列 ID 归类（组合 / 项目驾驶舱 / 周回顾 / 前端项目页同一口径）。
     * 待处理列与「等待接续」列 → backlog；「执行结束」列 → ended（不计未完成）；已完成 → done；
     * 其余（含进行中与未配置规则的自定义列，后端默认 normal）→ doing。
     */
    public static String statusBucket(String boardColumn, String processingRule) {
        if (Consts.COL_DONE.equals(boardColumn)) {
            return "done";
        }
        if (Consts.COL_BACKLOG.equals(boardColumn) || "waiting".equals(processingRule)) {
            return "backlog";
        }
        if ("ended".equals(processingRule)) {
            return "ended";
        }
        return "doing";
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
