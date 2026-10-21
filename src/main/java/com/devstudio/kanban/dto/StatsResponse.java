package com.devstudio.kanban.dto;

import lombok.Data;

import java.util.ArrayList;
import java.util.List;

@Data
public class StatsResponse {

    private List<WeekStat> weeks = new ArrayList<WeekStat>();
    private List<BoardResponse.NameCount> byCategory = new ArrayList<BoardResponse.NameCount>();
    private List<BoardResponse.NameCount> byOwner = new ArrayList<BoardResponse.NameCount>();
    private Current current = new Current();

    @Data
    public static class WeekStat {
        private String start;
        private String end;
        private int created;
        private int completed;
    }

    @Data
    public static class Current {
        private int backlog;
        private int doing;
        private int done;
        /** 自定义列中的任务数 */
        private int other;
        private int overdue;
        /** 累计工时（分钟，"我"在当前空间） */
        private int workMinutes;
        /** 本周工时（分钟，周一至今，"我"） */
        private int workMinutesWeek;
        /** N-5：本空间全员累计工时（分钟） */
        private int workMinutesAll;
        /** N-5：本空间全员本周工时（分钟） */
        private int workMinutesWeekAll;
    }
}
