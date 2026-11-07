package com.hourglass.common;

import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/** 测试用例执行结果的码值；前端标签与后端校验共用同一套。 */
public final class CaseMeta {

    public static final String STATUS_PASSED = "passed";
    public static final String STATUS_FAILED = "failed";
    public static final String STATUS_BLOCKED = "blocked";

    public static final List<String> RUN_STATUSES = Collections.unmodifiableList(Arrays.asList(
            STATUS_PASSED, STATUS_FAILED, STATUS_BLOCKED));

    private static final Set<String> STATUS_SET = Collections.unmodifiableSet(new LinkedHashSet<String>(RUN_STATUSES));

    private CaseMeta() {
    }

    public static boolean isRunStatus(String value) {
        return value != null && STATUS_SET.contains(value);
    }

    public static String statusLabel(String value) {
        if (STATUS_PASSED.equals(value)) {
            return "通过";
        }
        if (STATUS_FAILED.equals(value)) {
            return "失败";
        }
        if (STATUS_BLOCKED.equals(value)) {
            return "阻塞";
        }
        return value;
    }
}
