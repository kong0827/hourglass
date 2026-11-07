package com.hourglass.dto;

import lombok.Data;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

/**
 * 全部项目的版本总览：首版 / 迭代工时对比、版本节奏与准时率。
 * 口径复用 {@link PhaseStatsResponse} 与 {@link VersionStatsResponse}，
 * 汇总里的准时率/偏差是「有数据的项目均值」，不是按任务加权。
 */
@Data
public class VersionOverviewResponse {

    private List<ProjectOverview> projects = new ArrayList<ProjectOverview>();
    private Totals totals = new Totals();

    @Data
    public static class ProjectOverview {
        private String reqId;
        private String reqName;
        /** 首版上线日；null = 尚未标记上线 */
        private LocalDate firstReleasedAt;

        private Integer versionCount;
        private Integer releasedCount;
        private Integer activeCount;
        private Integer plannedCount;

        /** 首版（MVP）阶段 */
        private Integer mvpWorkMinutes;
        private Integer mvpDoneTasks;
        private Integer mvpOnTimePct;
        private Integer mvpDeviationPct;

        /** 迭代阶段 */
        private Integer iterationWorkMinutes;
        private Integer iterationDoneTasks;
        private Integer iterationOnTimePct;
        private Integer iterationDeviationPct;

        private Integer totalWorkMinutes;

        /** 最近目标版本：按目标日期取最新，没有目标日期时取最后一个 */
        private String latestVersionName;
        private String latestVersionStatus;
        private LocalDate latestVersionTarget;
        private Integer latestVersionWorkMinutes;
        private Integer latestVersionOnTimePct;
        private Integer latestVersionDeviationPct;
    }

    @Data
    public static class Totals {
        private Integer projectCount;
        private Integer versionCount;
        private Integer releasedCount;
        private Integer activeCount;
        private Integer plannedCount;
        private Integer mvpWorkMinutes;
        private Integer iterationWorkMinutes;
        private Integer totalWorkMinutes;
        private Integer mvpDoneTasks;
        private Integer iterationDoneTasks;
        /** 项目均值：只统计有数据的项目（null 不计入） */
        private Integer mvpOnTimePct;
        private Integer iterationOnTimePct;
        private Integer mvpDeviationPct;
        private Integer iterationDeviationPct;
    }
}
