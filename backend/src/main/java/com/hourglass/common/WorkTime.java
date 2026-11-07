package com.hourglass.common;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.function.ToIntFunction;

/**
 * 工时口径：一段计时折算成多少**有效分钟**。
 *
 * <p>规则：
 * <ol>
 *   <li><b>只计工作时段内的时长</b>：默认每天 09:00–18:00（每个账号可自己调，见 {@code app_user.work_start_hour / work_end_hour}）。
 *       这一条解决的是"忘停表过夜"：以前按自然日 00:00 切段，凌晨一过就开始重新计；
 *       现在 00:00–09:00 与 18:00 之后都不计入。</li>
 *   <li>周末（周六 / 周日）整段不计；</li>
 *   <li>每人每天最多计入 8 小时，并且要扣掉当天**已经记录过**的工时
 *       （跨任务、跨空间都算，因为"一天 8 小时"是人的属性，不是某个空间的属性）。</li>
 * </ol>
 *
 * <p>抽成纯函数（不依赖 mapper / Spring），便于单测与复用。
 */
public final class WorkTime {

    /** 每人每天最多计入的工时（分钟）默认值；每账号可通过 app_user.work_max_hours 调整 */
    public static final int MAX_MINUTES_PER_DAY = 8 * 60;
    /** 每天上限（小时）默认值 */
    public static final int MAX_HOURS_PER_DAY = 8;

    /** 默认工作时段：09:00–18:00 */
    public static final int DEFAULT_START_HOUR = 9;
    public static final int DEFAULT_END_HOUR = 18;

    private WorkTime() {
    }

    public static boolean isWorkday(LocalDate day) {
        DayOfWeek w = day.getDayOfWeek();
        return w != DayOfWeek.SATURDAY && w != DayOfWeek.SUNDAY;
    }

    /**
     * 兼容旧签名：按默认工作时段 09:00–18:00。
     *
     * @param start         计时开始时间
     * @param end           计时结束时间（运行中就是 now）
     * @param usedMinutesOn 查询"某天已记录的工时（分钟）"，可为 null（表示不扣减）
     */
    public static int effectiveMinutes(LocalDateTime start, LocalDateTime end, ToIntFunction<LocalDate> usedMinutesOn) {
        return effectiveMinutes(start, end, DEFAULT_START_HOUR, DEFAULT_END_HOUR, usedMinutesOn);
    }

    /** 便捷版：默认工作时段、不扣减当天已记录的工时 */
    public static int effectiveMinutes(LocalDateTime start, LocalDateTime end) {
        return effectiveMinutes(start, end, DEFAULT_START_HOUR, DEFAULT_END_HOUR, null);
    }

    /**
     * @param startHour     每天几点开始计入（0-23，越界回落到 9）
     * @param endHour       每天几点之后不再计入（1-24，24 表示到当天 24:00；越界或早于开始时间回落到 18）
     * @param usedMinutesOn 查询"某天已记录的工时（分钟）"，可为 null（表示不扣减）
     * @return 有效分钟数；整段都在周末/工作时段之外、或时间区间非法时返回 0
     */
    public static int effectiveMinutes(LocalDateTime start, LocalDateTime end, int startHour, int endHour,
                                       ToIntFunction<LocalDate> usedMinutesOn) {
        return effectiveMinutes(start, end, startHour, endHour, MAX_MINUTES_PER_DAY, usedMinutesOn);
    }

    /**
     * 完整版：工作时段 + 每天上限都可配（每个账号自己设）。
     *
     * @param maxMinutesPerDay 每天最多计入的分钟数（1-24 小时，越界回落到 8 小时）
     */
    public static int effectiveMinutes(LocalDateTime start, LocalDateTime end, int startHour, int endHour,
                                       int maxMinutesPerDay, ToIntFunction<LocalDate> usedMinutesOn) {
        if (start == null || end == null || !end.isAfter(start)) {
            return 0;
        }
        int sh = normalizeStartHour(startHour);
        int eh = normalizeEndHour(endHour, sh);
        int cap = normalizeMaxMinutes(maxMinutesPerDay);
        int total = 0;
        LocalDate day = start.toLocalDate();
        LocalDate lastDay = end.toLocalDate();
        while (!day.isAfter(lastDay)) {
            if (isWorkday(day)) {
                LocalDateTime winStart = day.atTime(sh, 0);
                LocalDateTime winEnd = eh >= 24 ? day.plusDays(1).atStartOfDay() : day.atTime(eh, 0);
                /* 只取「计时区间 ∩ 当天工作时段」 */
                LocalDateTime segStart = start.isAfter(winStart) ? start : winStart;
                LocalDateTime segEnd = end.isBefore(winEnd) ? end : winEnd;
                long minutes = ChronoUnit.MINUTES.between(segStart, segEnd);
                if (minutes > 0) {
                    int used = usedMinutesOn == null ? 0 : Math.max(0, usedMinutesOn.applyAsInt(day));
                    int quota = Math.max(0, cap - used);
                    total += (int) Math.min(minutes, quota);
                }
            }
            day = day.plusDays(1);
        }
        return total;
    }

    /** 开始小时：0-23，越界回落到默认 9 */
    public static int normalizeStartHour(int hour) {
        return (hour < 0 || hour > 23) ? DEFAULT_START_HOUR : hour;
    }

    /**
     * 结束小时：1-24，必须晚于开始小时；越界或早于开始小时回落到默认 18。
     * 24 表示"到当天 24:00"（适合晚上还要干活的人）。
     */
    public static int normalizeEndHour(int hour, int startHour) {
        if (hour < 1 || hour > 24) {
            return DEFAULT_END_HOUR;
        }
        return hour <= startHour ? DEFAULT_END_HOUR : hour;
    }

    /** 每天上限（小时）：1-24，越界回落到默认 8 小时 */
    public static int normalizeMaxHours(int hours) {
        return (hours < 1 || hours > 24) ? MAX_HOURS_PER_DAY : hours;
    }

    /** 每天上限（分钟）：0-1440，越界回落 480 */
    public static int normalizeMaxMinutes(int minutes) {
        return (minutes < 0 || minutes > 24 * 60) ? MAX_MINUTES_PER_DAY : minutes;
    }
}
