package com.hourglass.common;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

public final class Consts {

    public static final String COL_BACKLOG = "backlog";
    public static final String COL_DOING = "doing";
    /** 提测后的等待测试队列：不自动计时，但仍计入逾期 */
    public static final String COL_TEST = "test";
    /** 测试执行中：进入即记录开始测试时间，可自动计时 */
    public static final String COL_TESTING = "testing";
    public static final String COL_DONE = "done";
    /** 已完成列在列定义 / 工作页 tab 上的固定色（与看板一致） */
    public static final String COL_DONE_COLOR = "#5f7a4a";
    /** 列配置缺色时的中性兜底（与前端次要文字色一致） */
    public static final String COLUMN_FALLBACK_COLOR = "#667085";

    /** 需求筛选中的特殊值：未归类任务 */
    public static final String REQ_NONE = "__none";

    /* 列状态工作页：已完成列的时间窗。默认本周，只有 all 才查全量历史明细 */
    public static final String RANGE_WEEK = "week";
    public static final String RANGE_MONTH = "month";
    public static final String RANGE_QUARTER = "quarter";
    public static final String RANGE_ALL = "all";
    /** 「近 90 天」= 今天往前 90 个自然日（含今天） */
    public static final int RANGE_QUARTER_DAYS = 90;
    /** 工作页明细单次上限，与 /api/tasks/list 的 100 上限一致 */
    public static final int WORKPAGE_MAX_LIMIT = 100;

    public static final Map<String, String> COLUMN_NAMES;

    static {
        Map<String, String> names = new LinkedHashMap<String, String>();
        names.put(COL_BACKLOG, "待处理");
        names.put(COL_DOING, "进行中");
        names.put(COL_TEST, "待测试");
        names.put(COL_TESTING, "测试中");
        names.put(COL_DONE, "已完成");
        COLUMN_NAMES = Collections.unmodifiableMap(names);
    }

    private Consts() {
    }

    public static String columnName(String column) {
        String name = COLUMN_NAMES.get(column);
        return name == null ? column : name;
    }
}
