package com.devstudio.kanban.common;

import java.time.DayOfWeek;
import java.time.LocalDate;

/** 工作日口径：MVP 只跳周末，不建模法定节假日。 */
public final class WorkCalendar {

    private WorkCalendar() {
    }

    public static boolean isWorkday(LocalDate day) {
        if (day == null) {
            return false;
        }
        DayOfWeek w = day.getDayOfWeek();
        return w != DayOfWeek.SATURDAY && w != DayOfWeek.SUNDAY;
    }

    public static int workingDays(LocalDate from, LocalDate to) {
        if (from == null || to == null || to.isBefore(from)) {
            return 0;
        }
        int days = 0;
        for (LocalDate d = from; !d.isAfter(to); d = d.plusDays(1)) {
            if (isWorkday(d)) {
                days++;
            }
        }
        return days;
    }
}
