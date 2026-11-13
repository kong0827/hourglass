package com.hourglass.dto;

import com.hourglass.entity.Task;
import lombok.Data;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

/**
 * 工作项「列状态工作页」响应。
 *
 * <p>已完成列可能长期累积：明细只下发单页（≤100），统计全部在 SQL 聚合完成；
 * range=all 时明细查全部历史，指标固定收敛到近 90 天（metricRange 告知前端）。
 */
@Data
public class TaskWorkpageResponse {

    private String column;
    private String columnName;
    private String columnColor;
    private boolean done;
    /** 当前列是否累计逾期；已结束列（处理规则 ended）与已完成列为 false */
    private boolean overdueEnabled;
    /** week / month / quarter / all */
    private String range;
    /** 指标实际使用的时间窗：range=all 时为 quarter */
    private String metricRange;
    /** 当前列当前时间窗的条数（不受筛选影响） */
    private int rangeTotal;
    /** 叠加筛选后的条数 */
    private int matched;
    private boolean hasMore;
    private List<ColumnTab> columns = new ArrayList<ColumnTab>();
    /** 仅首屏（offset=0）计算；追加页返回默认值，前端沿用首屏结果 */
    private Metrics metrics = new Metrics();
    private List<Task> items = new ArrayList<Task>();

    @Data
    public static class ColumnTab {
        private String id;
        private String name;
        private String color;
        private boolean done;
        /** 当前时间窗内的条数（未完成列 = 列总数） */
        private int count;
        /** 已完成列的全量历史条数，供提示「共 N 条」 */
        private Integer allTotal;

        public ColumnTab(String id, String name, String color, boolean done, int count, Integer allTotal) {
            this.id = id;
            this.name = name;
            this.color = color;
            this.done = done;
            this.count = count;
            this.allTotal = allTotal;
        }
    }

    @Data
    public static class Metrics {
        private int count;
        private int overdue;
        private int blocked;
        private int high;
        private int noDue;
        private int lateCompleted;
        private int withDue;
        private int onTime;
        private long estimateMinutes;
        private long loggedMinutes;
        private Double avgAgeDays;
        private LocalDate lastCompletedAt;
    }
}
