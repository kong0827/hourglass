package com.hourglass.dto;

import lombok.Data;

import java.util.ArrayList;
import java.util.List;

/**
 * 估时准确度与超支预警。
 *
 * <p>为什么不用 start_date 算工期：开始日期是"什么时候接到的"，不是"什么时候动手"。
 * 任务可能今天建、下周才开工，拿 [开始, 完成] 算出来的时长混着等待时间，完全不能当效率指标。
 * 只有「预估 vs 计时实际」这一对是可比的 —— 实际值来自 time_log，已经按工作时段折算、跳过周末、每天封顶。
 */
@Data
public class EstimateStats {

    private int tasksTotal;
    /** 填了预估的任务数（没填的没法比，先把它显出来） */
    private int tasksWithEstimate;
    /** 已完成且有预估，参与系数计算的样本数 */
    private int sampleCount;
    /** 已完成、填了预估，但从没开过计时 —— 不进样本，界面上要说明，否则用户会疑惑"我明明完成了" */
    private int noTimeCount;

    /** Σ实际 / Σ预估（样本少时比"平均比值"稳，小任务不会把系数带偏） */
    private Double overallFactor;
    /** 每个任务 实际/预估 的中位数，代表"典型偏差" */
    private Double medianFactor;

    /** 实际/预估 < 0.85 的任务数（高估了） */
    private int underCount;
    /** 0.85 ~ 1.15 之间（估得准） */
    private int accurateCount;
    /** > 1.15（低估了，实际比预估多） */
    private int overCount;

    private List<CatFactor> byCategory = new ArrayList<CatFactor>();
    /** 进行中、已用掉预估 80% 以上的任务，按消耗比例降序 */
    private List<RiskTask> atRisk = new ArrayList<RiskTask>();
    /** 已完成但超预估的任务，复盘用 */
    private List<RiskTask> overrun = new ArrayList<RiskTask>();

    private String suggestion;
    private String note;

    @Data
    public static class CatFactor {
        private String category;
        private int sampleCount;
        private int estimateTotal;
        private int actualTotal;
        private Double factor;
    }

    @Data
    public static class RiskTask {
        private String id;
        private String title;
        private String category;
        private String column;
        private int estimateMinutes;
        private int actualMinutes;
        /** 实际/预估 */
        private double ratio;
        /** danger（已超）/ warn（接近） */
        private String level;
    }
}
