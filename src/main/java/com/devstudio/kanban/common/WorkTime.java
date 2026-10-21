package com.devstudio.kanban.common;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.function.ToIntFunction;

/**
 * 工时口径：一段计时折算成多少**有效分钟**。
 *
 * <p>规则（2026-10-20 按用户要求定）：
 * <ol>
 *   <li>周末（周六 / 周日）整段不计 —— 忘停表跨过周末也不会把 48 小时算成工时；</li>
 *   <li>每人每天最多计入 8 小时，并且要扣掉当天**已经记录过**的工时
 *       （跨任务、跨空间都算，因为"一天 8 小时"是人的属性，不是某个空间的属性）。</li>
 * </ol>
 *
 * <p>抽成纯函数（不依赖 mapper / Spring），便于单测与复用。
 */
public final class WorkTime {

    /** 每人每天最多计入的工时（分钟） */
    public static final int MAX_MINUTES_PER_DAY = 8 * 60;

    private WorkTime() {
    }

    public static boolean isWorkday(LocalDate day) {
        DayOfWeek w = day.getDayOfWeek();
        return w != DayOfWeek.SATURDAY && w != DayOfWeek.SUNDAY;
    }

    /**
     * @param start         计时开始时间
     * @param end           计时结束时间（运行中就是 now）
     * @param usedMinutesOn 查询"某天已记录的工时（分钟）"，可为 null（表示不扣减）
     * @return 有效分钟数；整段都在周末、或时间区间非法时返回 0
     */
    public static int effectiveMinutes(LocalDateTime start, LocalDateTime end, ToIntFunction<LocalDate> usedMinutesOn) {
        if (start == null || end == null || !end.isAfter(start)) {
            return 0;
        }
        int total = 0;
        LocalDate day = start.toLocalDate();
        LocalDate lastDay = end.toLocalDate();
        while (!day.isAfter(lastDay)) {
            if (isWorkday(day)) {
                LocalDateTime segStart = day.equals(start.toLocalDate()) ? start : day.atStartOfDay();
                LocalDateTime segEnd = day.equals(lastDay) ? end : day.plusDays(1).atStartOfDay();
                long minutes = ChronoUnit.MINUTES.between(segStart, segEnd);
                if (minutes > 0) {
                    int used = usedMinutesOn == null ? 0 : usedMinutesOn.applyAsInt(day);
                    int quota = Math.max(0, MAX_MINUTES_PER_DAY - used);
                    total += (int) Math.min(minutes, quota);
                }
            }
            day = day.plusDays(1);
        }
        return total;
    }

    /** 便捷版：不扣减当天已记录的工时 */
    public static int effectiveMinutes(LocalDateTime start, LocalDateTime end) {
        return effectiveMinutes(start, end, null);
    }
}
