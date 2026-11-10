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

    /** 需求筛选中的特殊值：未归类任务 */
    public static final String REQ_NONE = "__none";

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
