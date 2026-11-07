package com.hourglass.common;

import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/** 缺陷专属字段的取值范围；前端标签与后端校验共用同一套码值。 */
public final class DefectMeta {

    public static final String SEVERITY_BLOCKER = "blocker";
    public static final String SEVERITY_CRITICAL = "critical";
    public static final String SEVERITY_MAJOR = "major";
    public static final String SEVERITY_MINOR = "minor";

    public static final String REGRESSION_PENDING = "pending";
    public static final String REGRESSION_PASSED = "passed";
    public static final String REGRESSION_FAILED = "failed";

    public static final List<String> SEVERITIES = Collections.unmodifiableList(Arrays.asList(
            SEVERITY_BLOCKER, SEVERITY_CRITICAL, SEVERITY_MAJOR, SEVERITY_MINOR));

    public static final List<String> REGRESSION_STATUSES = Collections.unmodifiableList(Arrays.asList(
            REGRESSION_PENDING, REGRESSION_PASSED, REGRESSION_FAILED));

    private static final Set<String> SEVERITY_SET = Collections.unmodifiableSet(new LinkedHashSet<String>(SEVERITIES));
    private static final Set<String> REGRESSION_SET = Collections.unmodifiableSet(new LinkedHashSet<String>(REGRESSION_STATUSES));

    private DefectMeta() {
    }

    public static boolean isSeverity(String value) {
        return value != null && SEVERITY_SET.contains(value);
    }

    public static boolean isRegressionStatus(String value) {
        return value != null && REGRESSION_SET.contains(value);
    }

    public static String severityLabel(String value) {
        if (SEVERITY_BLOCKER.equals(value)) {
            return "阻断";
        }
        if (SEVERITY_CRITICAL.equals(value)) {
            return "严重";
        }
        if (SEVERITY_MAJOR.equals(value)) {
            return "一般";
        }
        if (SEVERITY_MINOR.equals(value)) {
            return "轻微";
        }
        return "未定级";
    }
}
