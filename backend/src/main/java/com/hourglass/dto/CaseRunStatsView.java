package com.hourglass.dto;

import lombok.Data;

import java.util.ArrayList;
import java.util.List;

/** 项目执行流水聚合：按执行人 / 环境 / 轮次的结果分布与通过率（口径同概览，跳过不计入分母）。 */
@Data
public class CaseRunStatsView {

    private int totalRuns;
    private List<Bucket> byExecutor = new ArrayList<Bucket>();
    private List<Bucket> byEnvironment = new ArrayList<Bucket>();
    private List<Bucket> byRound = new ArrayList<Bucket>();

    @Data
    public static class Bucket {
        private String key;
        private String label;
        private int total;
        private int passed;
        private int failed;
        private int blocked;
        private int skipped;
        /** 通过率 = passed / (passed+failed+blocked)，分母为 0 时为 0 */
        private double passRate;
    }
}