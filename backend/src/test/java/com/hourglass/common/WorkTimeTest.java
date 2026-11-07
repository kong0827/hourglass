package com.hourglass.common;

import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;
import java.util.function.ToIntFunction;

import static org.junit.jupiter.api.Assertions.assertEquals;

/** 工作时段口径：09:00-18:00 默认，窗口外与周末不计，跨夜不涨，单日封顶 */
class WorkTimeTest {

    private static LocalDateTime t(int day, int h, int m) {
        return LocalDateTime.of(2026, 10, day, h, m); // 2026-10-05 是周一
    }

    @Test
    void workWindowAndCaps() {
        assertEquals(120, WorkTime.effectiveMinutes(t(5, 10, 0), t(5, 12, 0)));
        assertEquals(30, WorkTime.effectiveMinutes(t(5, 7, 0), t(5, 9, 30)));
        assertEquals(0, WorkTime.effectiveMinutes(t(5, 19, 0), t(5, 21, 0)));
        assertEquals(60, WorkTime.effectiveMinutes(t(5, 18, 0), t(6, 10, 0)));
        assertEquals(0, WorkTime.effectiveMinutes(t(5, 22, 0), t(6, 8, 0)));
        assertEquals(0, WorkTime.effectiveMinutes(t(10, 10, 0), t(10, 12, 0))); // 周六
        assertEquals(60, WorkTime.effectiveMinutes(t(9, 18, 0), t(12, 10, 0))); // 周五晚→周一早
        assertEquals(480, WorkTime.effectiveMinutes(t(5, 9, 0), t(5, 18, 0)));  // 单日封顶 8h
    }

    @Test
    void customWindowAndOverrides() {
        assertEquals(60, WorkTime.effectiveMinutes(t(5, 8, 0), t(5, 9, 0), 8, 20, null));
        assertEquals(180, WorkTime.effectiveMinutes(t(5, 20, 0), t(5, 23, 0), 9, 24, null));
        assertEquals(480, WorkTime.effectiveMinutes(t(5, 9, 0), t(5, 18, 0), 9, 5, null));
        ToIntFunction<java.time.LocalDate> used = d -> 300;
        assertEquals(180, WorkTime.effectiveMinutes(t(5, 9, 0), t(5, 18, 0), 9, 18, used));
        assertEquals(0, WorkTime.effectiveMinutes(t(5, 12, 0), t(5, 10, 0)));
        assertEquals(240, WorkTime.effectiveMinutes(t(5, 9, 0), t(5, 18, 0), 9, 18, 240, null));
        assertEquals(720, WorkTime.effectiveMinutes(t(5, 9, 0), t(5, 22, 0), 9, 24, 720, null));
        assertEquals(480, WorkTime.effectiveMinutes(t(5, 9, 0), t(5, 18, 0), 9, 18, 99 * 60, null));
        assertEquals(60, WorkTime.effectiveMinutes(t(5, 18, 0), t(6, 10, 0), 9, 18, 12 * 60, null));
    }
}
