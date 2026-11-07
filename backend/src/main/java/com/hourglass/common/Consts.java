package com.hourglass.common;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

public final class Consts {

    public static final String COL_BACKLOG = "backlog";
    public static final String COL_DOING = "doing";
    public static final String COL_DONE = "done";

    /** 需求筛选中的特殊值：未归类任务 */
    public static final String REQ_NONE = "__none";

    public static final Map<String, String> COLUMN_NAMES;

    static {
        Map<String, String> names = new LinkedHashMap<String, String>();
        names.put(COL_BACKLOG, "待处理");
        names.put(COL_DOING, "进行中");
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
