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

    /**
     * 缺陷回归状态随列流转自动推导（显式回归状态为唯一口径）：
     * 进入「待测试 / 测试中」= 开发已提交修复，记为待回归；
     * 进入「已完成」= 回归验证通过；
     * 从验证列或完成列退回「待处理 / 进行中」= 回归不通过，需要返工。
     * 列内移动或其它流转保持原值。
     */
    public static String regressionForTransition(String current, String from, String to) {
        String regression = current == null || current.trim().isEmpty() ? null : current.trim();
        if (to == null) {
            return regression;
        }
        boolean wasVerify = Consts.COL_TEST.equals(from) || Consts.COL_TESTING.equals(from);
        boolean isVerify = Consts.COL_TEST.equals(to) || Consts.COL_TESTING.equals(to);
        if (isVerify && !wasVerify) {
            return REGRESSION_PENDING;
        }
        if (Consts.COL_DONE.equals(to) && !Consts.COL_DONE.equals(from)) {
            return REGRESSION_PASSED;
        }
        if ((wasVerify || Consts.COL_DONE.equals(from))
                && (Consts.COL_BACKLOG.equals(to) || Consts.COL_DOING.equals(to))) {
            return REGRESSION_FAILED;
        }
        return regression;
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
