package com.devstudio.kanban.dto;

import lombok.Data;

import java.util.ArrayList;
import java.util.List;

/**
 * 流程体检报告：不预测、不猜，只把 task_log 里的真实痕迹算成人能看懂的几件事。
 *
 * <p>口径（与前端文案一一对应）：
 * <ul>
 *   <li><b>列停留</b>：任务进入某列到离开该列的时间。平均值/中位数只统计<b>已离开</b>的段；
 *       仍停在该列的段（ongoing）单独给，避免把"现在正卡着"混进历史均值里。</li>
 *   <li><b>已完成列不参与停留统计</b>：那是终点，停多久不代表流程效率。</li>
 *   <li><b>回退</b>：目标列在列顺序里比来源列更靠前，算一次回退（返工信号）。</li>
 *   <li><b>一次通过率</b>：时间窗内完成的任务中，窗内没有发生过回退的比例。</li>
 * </ul>
 * 所有时长单位都是<b>秒</b>，由前端格式化。
 */
@Data
public class FlowHealthResponse {

    private int rangeDays;
    private String since;
    private String generatedAt;
    private Coverage coverage = new Coverage();
    private List<ColumnStat> columns = new ArrayList<ColumnStat>();

    /** 停留占比最高的列（没有足够样本时为 null） */
    private String bottleneckId;
    private String bottleneckName;
    private double bottleneckShare;

    private Rework rework = new Rework();
    private List<PriorityStat> priority = new ArrayList<PriorityStat>();
    private ReqDocStat reqDocs = new ReqDocStat();
    private List<Insight> insights = new ArrayList<Insight>();

    /** 数据够不够、算什么不算什么，都得说清楚，否则用户会以为数字是假的 */
    @Data
    public static class Coverage {
        private int moveEvents;
        private int usableMoves;
        private int tasksTotal;
        private int tasksWithMoves;
        private int completedInRange;
        /** 给用户看的口径说明（数据不足时是引导，数据正常时是提醒） */
        private String note;
    }

    @Data
    public static class ColumnStat {
        private String id;
        private String name;
        private String color;
        /** 已离开该列的段数（参与均值计算） */
        private int segments;
        private long totalSeconds;
        private long avgSeconds;
        private long medianSeconds;
        private long p90Seconds;
        /** 该列累计停留占全部列累计停留的比例 */
        private double share;
        /** 当前仍停在该列的任务数 */
        private int ongoingCount;
        /** 当前在制任务里停留最久的秒数 */
        private long ongoingMaxSeconds;
        /** 当前在制任务的停留均值 */
        private long ongoingAvgSeconds;
        private boolean bottleneck;
    }

    @Data
    public static class Rework {
        private int totalMoves;
        private int backMoves;
        private double backRate;
        private int completedTasks;
        private int firstPassTasks;
        private double firstPassRate;
    }

    @Data
    public static class PriorityStat {
        private String priority;
        private int tasks;
        /** 平均跨列移动次数：优先级形同虚设时，P0 的移动次数不会比 P2 少 */
        private double avgMoves;
    }

    @Data
    public static class ReqDocStat {
        private int total;
        private int withTasks;
        private int noTask;
        /** 需求创建 → 首个任务创建的平均间隔（小时），没有样本时为 null */
        private Double avgLeadHours;
        private List<ReqDocLite> noTaskList = new ArrayList<ReqDocLite>();
    }

    @Data
    public static class ReqDocLite {
        private String id;
        private String title;
        /** 挂着多久了（天） */
        private long ageDays;
    }

    @Data
    public static class Insight {
        /** good / warn / info */
        private String level;
        private String title;
        private String text;

        public Insight() {
        }

        public Insight(String level, String title, String text) {
            this.level = level;
            this.title = title;
            this.text = text;
        }
    }
}
