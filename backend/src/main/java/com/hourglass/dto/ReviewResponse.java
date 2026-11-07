package com.hourglass.dto;

import com.hourglass.entity.Task;
import lombok.Data;

import java.util.ArrayList;
import java.util.List;

@Data
public class ReviewResponse {

    private int weekOffset;
    /** yyyy-MM-dd */
    private String weekStart;
    private String weekEnd;
    /** 本周/上周/该周期 */
    private String label;
    private List<Task> completed = new ArrayList<Task>();
    private Stats stats = new Stats();
    /** N-5：成员贡献带工时（按人归属的 time_log 合计） */
    private List<MemberStat> members = new ArrayList<MemberStat>();
    private List<BoardResponse.NameCount> catDist = new ArrayList<BoardResponse.NameCount>();
    /** 推进中的工作：所有已填进度的任务，按进度降序 */
    private List<Task> progressTasks = new ArrayList<Task>();
    /**
     * O-10：进度已到 100% 但还没移入「已完成」列的任务。
     * 单独成组呈现，避免"进度 100% 却不计入完成指标"这种静默漏统计。
     */
    private List<Task> pendingDone = new ArrayList<Task>();
    private List<ReqProgress> reqDist = new ArrayList<ReqProgress>();
    private BoardResponse.Counts counts = new BoardResponse.Counts();
    private int openP0;
    private int doing;
    private int backlog;
    /** N-5：工时（本周期内 / 全空间累计） */
    private WorkMinutes workMinutes = new WorkMinutes();

    @Data
    public static class Stats {
        private int done;
        /** 完成项中设置了截止日期的数量（按期率的分母） */
        private int withDue;
        private int onTime;
        private int onTimeRate;
        private int members;
        /** 延期 = 有截止日期且逾期完成（无截止日期不计入） */
        private int late;
    }

    @Data
    public static class MemberStat {
        private String name;
        private int count;
        /** 该成员在本空间自本周期起点的工时（分钟） */
        private int minutes;
    }

    @Data
    public static class WorkMinutes {
        /** 本空间全员累计（分钟） */
        private int space;
        /** 我的累计（分钟） */
        private int mine;
        /** 本空间全员在本周期内的工时（分钟） */
        private int spaceWeek;
        /** 我在本周期内的工时（分钟）；IA-7：与 spaceWeek 成对展示 */
        private int mineWeek;
    }
}
