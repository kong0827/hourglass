package com.hourglass.dto;

import com.hourglass.entity.Task;
import com.hourglass.entity.TaskDependency;
import lombok.Data;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 甘特图数据：任务分页 + 依赖 + 基线 + 未排期计数。
 * 依赖与基线只随第一页返回，后续分页请求不重复传输。
 */
@Data
public class GanttResponse {

    private List<Task> items = new ArrayList<Task>();
    /** 未排期任务（无开始也无截止），最多 200 条；与分页无关 */
    private List<Task> unscheduled = new ArrayList<Task>();
    private int total;
    private int offset;
    private int limit;
    private boolean hasMore;
    /** 未排期（无开始也无截止）任务数，用于底部抽屉文案 */
    private int unscheduledCount;
    private List<TaskDependency> deps = new ArrayList<TaskDependency>();
    private Map<String, BaselinePoint> baseline = new LinkedHashMap<String, BaselinePoint>();
    private LocalDateTime baselineAt;

    @Data
    public static class BaselinePoint {
        private LocalDate startDate;
        private LocalDate dueDate;
    }

    /** 单独查询 / 刷新基线时用（不携带任务列表） */
    @Data
    public static class BaselinePointMapHolder {
        private Map<String, BaselinePoint> baseline = new LinkedHashMap<String, BaselinePoint>();
        private LocalDateTime baselineAt;
    }
}
