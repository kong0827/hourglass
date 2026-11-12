package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.dto.BoardResponse;
import com.hourglass.dto.NameCountRow;
import com.hourglass.dto.PageResult;
import com.hourglass.dto.ReviewHourLog;
import com.hourglass.dto.ReviewHourLogSummary;
import com.hourglass.dto.StatsResponse;
import com.hourglass.dto.TaskBucketRow;
import com.hourglass.dto.TaskDrillQuery;
import com.hourglass.dto.TaskDrillRow;
import com.hourglass.dto.WeekCountRow;
import com.hourglass.dto.WorkSumRow;
import com.hourglass.mapper.TaskMapper;
import com.hourglass.mapper.TimeLogMapper;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

@Service
public class StatsService {

    private static final int DRILL_MAX_LIMIT = 100;
    private static final Set<String> DRILL_KINDS = new HashSet<String>(Arrays.asList(
            "created", "completed", "category", "owner", "column", "priority"));

    private final TaskMapper taskMapper;
    private final TimeLogMapper timeLogMapper;
    /** IA-1：列计数与工时统一走 MetricsService，避免报表/回头看板各算一套 */
    private final MetricsService metrics;
    private final ProjectAccessService projectAccess;

    public StatsService(TaskMapper taskMapper, TimeLogMapper timeLogMapper,
                        MetricsService metrics, ProjectAccessService projectAccess) {
        this.taskMapper = taskMapper;
        this.timeLogMapper = timeLogMapper;
        this.metrics = metrics;
        this.projectAccess = projectAccess;
    }

    /** 近 N 周：每周新增/完成；窗口内完成按模块与负责人分布；当前积压与逾期（按空间隔离，工时按"我"统计） */
    public StatsResponse stats(String workspaceId, String userId, Integer weeks) {
        int w = weeks == null ? 8 : Math.max(4, Math.min(26, weeks));
        LocalDate today = LocalDate.now();
        LocalDate monday = today.minusDays(today.getDayOfWeek().getValue() - 1);
        LocalDate rangeStart = monday.minusWeeks(w - 1);
        /* 日期列比较统一用「上界 + 1 天」的开区间，避免 DATE/DATETIME 混用 */
        LocalDate before = today.plusDays(1);

        StatsResponse resp = new StatsResponse();
        String viewerId = projectAccess.viewerScope(workspaceId, userId);

        /* 周聚合：SQL UNION ALL + GROUP BY，移除了「周数 × 全部任务」的双重循环 */
        Map<String, int[]> byWeek = new HashMap<String, int[]>();
        for (WeekCountRow row : taskMapper.countCreatedCompletedByWeek(workspaceId, viewerId, rangeStart, before)) {
            if (row.getWeekStart() != null) {
                byWeek.put(row.getWeekStart().toString(),
                        new int[]{row.getCreated(), row.getCompleted()});
            }
        }
        for (int i = w - 1; i >= 0; i--) {
            LocalDate start = monday.minusWeeks(i);
            LocalDate end = start.plusDays(6);
            StatsResponse.WeekStat stat = new StatsResponse.WeekStat();
            stat.setStart(start.toString());
            stat.setEnd(end.toString());
            int[] c = byWeek.get(start.toString());
            stat.setCreated(c == null ? 0 : c[0]);
            stat.setCompleted(c == null ? 0 : c[1]);
            resp.getWeeks().add(stat);
        }

        for (NameCountRow row : taskMapper.countCompletedByCategory(workspaceId, viewerId, rangeStart, before)) {
            resp.getByCategory().add(new BoardResponse.NameCount(row.getName(), row.getCnt()));
        }
        for (NameCountRow row : taskMapper.countCompletedByOwner(workspaceId, viewerId, rangeStart, before)) {
            resp.getByOwner().add(new BoardResponse.NameCount(row.getName(), row.getCnt()));
        }

        TaskBucketRow buckets = metrics.buckets(workspaceId, viewerId, today);
        StatsResponse.Current current = new StatsResponse.Current();
        current.setBacklog(buckets.getBacklog());
        current.setDoing(buckets.getDoing());
        current.setDone(buckets.getDone());
        current.setOther(buckets.getOther());
        current.setOverdue(buckets.getOverdue());

        /* 工时：累计 / 本周 × 全空间 / 我，一次聚合 */
        WorkSumRow work = metrics.workMinutes(workspaceId, userId, monday.atStartOfDay(), viewerId);
        if (work != null) {
            current.setWorkMinutes(work.getTotalMine());
            current.setWorkMinutesWeek(work.getWeekMine());
            current.setWorkMinutesAll(work.getTotalAll());
            current.setWorkMinutesWeekAll(work.getWeekAll());
        }
        resp.setCurrent(current);
        return resp;
    }

    /**
     * 趋势 / 分布 / 流程体检的下钻明细。kind 与上方聚合一一对应：
     * created、completed、category、owner 需要 from / before；column、priority 取当前快照。
     */
    public PageResult<TaskDrillRow> drillTasks(String workspaceId, String userId, String kind,
                                               String from, String before, String value,
                                               Integer offset, Integer limit) {
        String k = kind == null ? "" : kind.trim();
        if (!DRILL_KINDS.contains(k)) {
            throw AppException.badRequest("不支持的下钻口径");
        }
        TaskDrillQuery query = new TaskDrillQuery();
        query.setKind(k);
        query.setValue(value);
        if ("created".equals(k) || "completed".equals(k) || "category".equals(k) || "owner".equals(k)) {
            query.setFrom(parseDate(from, "from"));
            query.setBefore(parseDate(before, "before"));
            if (query.getFrom() == null || query.getBefore() == null) {
                throw AppException.badRequest("该口径需要 from / before 日期");
            }
        }
        if (("column".equals(k) || "priority".equals(k))
                && (value == null || value.trim().isEmpty())) {
            throw AppException.badRequest("该口径需要 value");
        }
        /* 未指定模块 / 负责人在聚合里显示为「空名」，GET 会丢掉空串，这里用 __unset__ 显式带上 */
        if (("category".equals(k) || "owner".equals(k))
                && (value == null || "__unset__".equals(value.trim()))) {
            query.setValue("");
        }

        int safeOffset = Math.max(0, offset == null ? 0 : offset);
        int safeLimit = limit == null || limit <= 0 ? DRILL_MAX_LIMIT : Math.min(limit, DRILL_MAX_LIMIT);
        String viewerId = projectAccess.viewerScope(workspaceId, userId);
        int total = taskMapper.countDrillTasks(workspaceId, viewerId, query);
        List<TaskDrillRow> items = total <= safeOffset
                ? new ArrayList<TaskDrillRow>()
                : taskMapper.selectDrillTasks(workspaceId, viewerId, query, safeOffset, safeLimit);
        return PageResult.of(items, total, safeOffset, safeLimit);
    }

    /**
     * 工时卡下钻：period=week 时与「本周工时」同口径（周一起），period=total 时是累计；
     * scope=mine 只看当前用户，all 看空间合计。行结构与周回顾的工时明细一致。
     */
    public Map<String, Object> hourLogs(String workspaceId, String userId, String scope, String period,
                                        Integer offset, Integer limit) {
        String p = period == null ? "week" : period.trim();
        if (!"week".equals(p) && !"total".equals(p)) {
            throw AppException.badRequest("不支持的时间范围");
        }
        boolean mine = "mine".equals(scope);
        LocalDate today = LocalDate.now();
        LocalDate monday = today.minusDays(today.getDayOfWeek().getValue() - 1);
        LocalDateTime from = "week".equals(p) ? monday.atStartOfDay() : null;
        LocalDateTime to = null;
        int safeOffset = Math.max(0, offset == null ? 0 : offset);
        int safeLimit = limit == null || limit <= 0 ? DRILL_MAX_LIMIT : Math.min(limit, DRILL_MAX_LIMIT);
        String viewerId = projectAccess.viewerScope(workspaceId, userId);
        String scopedUser = mine ? userId : null;

        ReviewHourLogSummary summary = timeLogMapper.summaryReviewHourLogs(
                workspaceId, viewerId, null, scopedUser, from, to);
        int total = summary == null ? 0 : summary.getTotal();
        List<ReviewHourLog> items = total <= safeOffset
                ? new ArrayList<ReviewHourLog>()
                : timeLogMapper.selectReviewHourLogs(workspaceId, viewerId, null, scopedUser,
                        from, to, safeOffset, safeLimit);

        Map<String, Object> page = new HashMap<String, Object>();
        page.put("total", total);
        page.put("totalMinutes", summary == null ? 0 : summary.getTotalMinutes());
        page.put("offset", safeOffset);
        page.put("limit", safeLimit);
        page.put("hasMore", safeOffset + items.size() < total);
        page.put("items", items);
        page.put("period", p);
        page.put("scope", mine ? "mine" : "all");
        return page;
    }

    private LocalDate parseDate(String value, String name) {
        if (value == null || value.trim().isEmpty()) {
            return null;
        }
        try {
            return LocalDate.parse(value.trim());
        } catch (DateTimeParseException ex) {
            throw AppException.badRequest(name + " 需为 yyyy-MM-dd");
        }
    }
}
