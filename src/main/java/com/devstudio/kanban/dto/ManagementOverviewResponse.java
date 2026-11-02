package com.devstudio.kanban.dto;

import lombok.Data;

import java.util.ArrayList;
import java.util.List;

/** 管理总览响应。 */
@Data
public class ManagementOverviewResponse {

    private Summary summary = new Summary();
    private RiskCount risk = new RiskCount();
    private String dataStartDate;
    private List<TrendPoint> weeks = new ArrayList<TrendPoint>();
    private List<ManagementRiskRow> topRisks = new ArrayList<ManagementRiskRow>();
    private WorkloadSummary workload = new WorkloadSummary();

    @Data
    public static class Summary {
        private int projects;
        private int active;
        private int done;
        private int hold;
        private int highRisk;
        /** 进行中项目里已过截止日的项目数 */
        private int overdue;
        /** 全空间逾期任务数 */
        private int overdueTasks;
        private int completedThisWeek;
        private int completedPrevWeek;
        private int workMinutesThisWeek;
        private int workMinutesPrevWeek;
        private int members;
        private Integer dataQuality;
        private int statusIssues;
        private String topOverdueProject;
    }

    @Data
    public static class RiskCount {
        private int red;
        private int amber;
        private int green;
        private int unknown;
    }

    @Data
    public static class TrendPoint {
        private String weekStart;
        private int created;
        private int completed;
        private boolean completedAvailable;
    }

    @Data
    public static class WorkloadSummary {
        private int overloadedMembers;
        private int maxEstimatedPct;
        private int estimateCoverage;
        private String topEstimateProject;
    }
}
