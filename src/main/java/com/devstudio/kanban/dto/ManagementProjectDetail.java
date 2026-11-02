package com.devstudio.kanban.dto;

import com.devstudio.kanban.entity.Task;
import lombok.Data;

import java.util.ArrayList;
import java.util.List;

/** 项目详情：项目事实 + 任务证据 + 风险 + 工时 + 趋势。 */
@Data
public class ManagementProjectDetail {

    private ManagementProjectRow project;
    private List<Task> tasks = new ArrayList<Task>();
    private List<ManagementRiskRow> risks = new ArrayList<ManagementRiskRow>();
    private List<HourRow> hours = new ArrayList<HourRow>();
    private List<ManagementOverviewResponse.TrendPoint> trend = new ArrayList<ManagementOverviewResponse.TrendPoint>();

    @Data
    public static class HourRow {
        private String userId;
        private String name;
        private Integer estimateMinutes;
        private Integer actualMinutes;
    }
}
