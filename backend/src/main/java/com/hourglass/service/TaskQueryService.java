package com.hourglass.service;

import com.hourglass.common.Consts;
import com.hourglass.common.TaskCalc;
import com.hourglass.common.Texts;
import com.hourglass.dto.BoardQuery;
import com.hourglass.dto.BoardResponse;
import com.hourglass.dto.CalendarResponse;
import com.hourglass.dto.GanttQuery;
import com.hourglass.dto.MyTaskWorkspace;
import com.hourglass.dto.MyTasksPage;
import com.hourglass.dto.MyTasksQuery;
import com.hourglass.dto.TaskListResponse;
import com.hourglass.entity.Attachment;
import com.hourglass.entity.BoardColumn;
import com.hourglass.entity.Category;
import com.hourglass.entity.Requirement;
import com.hourglass.entity.SubtaskAgg;
import com.hourglass.entity.TagTaskRow;
import com.hourglass.entity.Task;
import com.hourglass.entity.TaskCountAgg;
import com.hourglass.entity.TaskFacetRow;
import com.hourglass.entity.TaskLog;
import com.hourglass.entity.TimeAgg;
import com.hourglass.mapper.AttachmentMapper;
import com.hourglass.mapper.ProjectVersionMapper;
import com.hourglass.mapper.RequirementMapper;
import com.hourglass.mapper.SubtaskMapper;
import com.hourglass.mapper.TagMapper;
import com.hourglass.mapper.TaskLogMapper;
import com.hourglass.mapper.TaskMapper;
import com.hourglass.mapper.TimeLogMapper;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * BE-ARCH-1：任务查询侧（看板 / 列表 / 日历 / 我的任务 / 时间线 / 扩展字段）。
 *
 * <p>只读，不写库；写操作分别在 {@link TaskCommandService}、{@link TaskWorkflowService}、
 * {@link TaskTrashService}。互相之间没有依赖，避免拆分后又用服务调用绕回循环依赖。
 */
@Service
public class TaskQueryService {

    private static final String[] PRIORITIES = {"P0", "P1", "P2", "P3"};
    /** 工作项类型固定顺序（与任务表单下拉一致） */
    private static final String[] TASK_TYPES = {"task", "story", "bug", "epic"};
    private static final int LIST_LIMIT = 100;
    /** 我的任务分页上限（与 /api/tasks/list 的 100 上限一致） */
    public static final int MY_TASKS_MAX_LIMIT = 100;

    private final TaskMapper taskMapper;
    private final RequirementMapper reqMapper;
    private final ProjectVersionMapper projectVersionMapper;
    private final TaskLogMapper logMapper;
    private final SubtaskMapper subtaskMapper;
    private final TagMapper tagMapper;
    private final TimeLogMapper timeLogMapper;
    private final AttachmentMapper attachmentMapper;
    private final WorkspaceMetaCache metaCache;
    private final TaskSupport support;
    private final com.hourglass.mapper.VersionTaskMapper versionTaskMapper;
    private final ProjectAccessService projectAccess;
    private final ReleasePermissionService permissions;
    @org.springframework.beans.factory.annotation.Autowired
    private TaskPublicationService publications;

    public TaskQueryService(TaskMapper taskMapper, RequirementMapper reqMapper, ProjectVersionMapper projectVersionMapper,
                            TaskLogMapper logMapper,
                            SubtaskMapper subtaskMapper, TagMapper tagMapper, TimeLogMapper timeLogMapper,
                            AttachmentMapper attachmentMapper, WorkspaceMetaCache metaCache,
                            TaskSupport support, com.hourglass.mapper.VersionTaskMapper versionTaskMapper,
                            ProjectAccessService projectAccess, ReleasePermissionService permissions) {
        this.taskMapper = taskMapper;
        this.reqMapper = reqMapper;
        this.projectVersionMapper = projectVersionMapper;
        this.logMapper = logMapper;
        this.subtaskMapper = subtaskMapper;
        this.tagMapper = tagMapper;
        this.timeLogMapper = timeLogMapper;
        this.attachmentMapper = attachmentMapper;
        this.metaCache = metaCache;
        this.support = support;
        this.versionTaskMapper = versionTaskMapper;
        this.projectAccess = projectAccess;
        this.permissions = permissions;
    }

    /* ==================== 2026-10-16 评估报告改造新增查询 ==================== */

    /** 任务深链（O-3）：只在「我参与的空间」内查找；回收站中的任务也返回（前端据此提示"已被删除"） */
    public Task forDeepLink(String userId, String id) {
        Task t = taskMapper.selectByIdInMyWorkspaces(id, userId);
        if (t == null) {
            return null;
        }
        if (!projectAccess.canViewTask(t.getWorkspaceId(), userId, t)) {
            return null;
        }
        mergeTaskExtras(t.getWorkspaceId(), Collections.singletonList(t));
        return t;
    }

    /**
     * IA-3 / TOP-6：我的任务收件箱接入统一筛选（q / 优先级 / 模块 / 项目 / 标签 / 被阻塞），
     * 并按 offset/limit 分页下推 SQL。total / hasMore 基于独立 COUNT，不受本页条目数影响。
     */
    public MyTasksPage myTasksPage(String userId, String displayName, boolean openOnly,
                                   BoardQuery query, int offset, int limit) {
        MyTasksQuery pageQuery = new MyTasksQuery();
        pageQuery.setUserId(userId);
        pageQuery.setDisplayName(displayName);
        pageQuery.setOpenOnly(openOnly);
        pageQuery.setQ(Texts.trimToNull(query.getQ()));
        pageQuery.setPris(query.getPris());
        pageQuery.setCats(query.getCats());
        pageQuery.setReqs(query.getReqs());
        pageQuery.setTags(query.getTags());
        pageQuery.setTypes(query.getTypes());
        pageQuery.setVersions(query.getVersions());
        pageQuery.setColumns(query.getColumns());
        pageQuery.setCompletion(query.getCompletion());
        pageQuery.setBlocked(query.isBlocked());
        pageQuery.setDue(query.getDue());
        pageQuery.setFocus(query.isFocus());
        offset = Math.max(0, offset);
        limit = Math.max(1, Math.min(MY_TASKS_MAX_LIMIT, limit));
        pageQuery.setOffset(offset);
        pageQuery.setLimit(limit);

        int total = taskMapper.countMyTasks(pageQuery);
        List<Task> list = total <= offset ? new ArrayList<Task>() : taskMapper.selectMyTasks(pageQuery);
        if (!list.isEmpty()) {
            Map<String, List<Task>> byWs = new LinkedHashMap<String, List<Task>>();
            for (Task t : list) {
                List<Task> group = byWs.get(t.getWorkspaceId());
                if (group == null) {
                    group = new ArrayList<Task>();
                    byWs.put(t.getWorkspaceId(), group);
                }
                group.add(t);
            }
            for (Map.Entry<String, List<Task>> e : byWs.entrySet()) {
                mergeTaskExtras(e.getKey(), e.getValue());
            }
        }
        /* 跨空间收件箱：逐条下发 write/read，前端据此收敛完成/计时/改期等入口 */
        projectAccess.markWritable(userId, list);
        /* 仅按显示名匹配的条数：同一 WHERE 再叠加 owner_user_id IS NULL，覆盖全量而非本页 */
        pageQuery.setNameOnly(true);
        int nameOnly = taskMapper.countMyTasks(pageQuery);
        return new MyTasksPage(list, total, taskMapper.selectMyTaskWorkspaces(pageQuery), nameOnly);
    }

    /* ==================== 查询 ==================== */

    public BoardResponse board(String workspaceId, String userId, BoardQuery query) {
        LocalDate today = LocalDate.now();
        String viewerId = projectAccess.viewerScope(workspaceId, userId);
        List<BoardColumn> configCols = metaCache.columns(workspaceId);
        String fallbackCol = configCols.isEmpty() ? Consts.COL_BACKLOG : configCols.get(0).getId();
        List<String> openColumns = new ArrayList<String>();
        List<String> knownColumns = new ArrayList<String>();
        for (BoardColumn c : configCols) {
            openColumns.add(c.getId());
            knownColumns.add(c.getId());
        }
        knownColumns.add(Consts.COL_DONE);
        if (openColumns.isEmpty()) {
            openColumns.add(fallbackCol);
        }
        GanttQuery openQuery = GanttQuery.from(query, today, null, null, false);
        openQuery.setViewerId(viewerId);

        BoardResponse resp = new BoardResponse();
        for (BoardColumn c : configCols) {
            resp.getColumnDefs().add(new BoardResponse.ColumnDef(c.getId(), c.getName(), c.getColor(),
                    support.processingRule(workspaceId, c.getId()), false));
        }
        resp.getColumnDefs().add(new BoardResponse.ColumnDef(Consts.COL_DONE, "已完成", "#5f7a4a", "done", true));
        for (String col : openColumns) {
            resp.getColumns().put(col, openPage(workspaceId, viewerId, openQuery, query, col,
                    0, query.getOpenLimit(), col.equals(fallbackCol), knownColumns));
        }

        LocalDate monday = today.minusDays(today.getDayOfWeek().getValue() - 1);
        LocalDate sunday = monday.plusDays(6);
        boolean scopeAll = "all".equals(query.getDoneScope());
        GanttQuery doneQuery = GanttQuery.from(query, today, null, null, true);
        doneQuery.setViewerId(viewerId);
        int doneAll = taskMapper.countDoneAll(workspaceId, viewerId);
        int doneTotal = scopeAll ? doneAll : taskMapper.countDoneInScope(workspaceId, viewerId, monday, sunday);
        int doneMatched = hasFilters(query)
                ? taskMapper.countDoneMatched(workspaceId, doneQuery, scopeAll, monday, sunday)
                : doneTotal;
        List<Task> doneItems = doneMatched == 0 ? new ArrayList<Task>()
                : taskMapper.selectDonePage(workspaceId, doneQuery, scopeAll, monday, sunday, 0, query.getDoneLimit());
        mergeTaskExtras(workspaceId, doneItems);

        BoardResponse.ColumnData doneData = new BoardResponse.ColumnData();
        doneData.setAllTotal(doneAll);
        doneData.setMatched(doneMatched);
        doneData.setTotal(doneTotal);
        doneData.setItems(doneItems);
        doneData.setHasMore(doneMatched > query.getDoneLimit());
        resp.getColumns().put(Consts.COL_DONE, doneData);

        List<TaskFacetRow> facets = taskMapper.selectBoardFacets(workspaceId, viewerId);
        resp.setCounts(countDue(facets, today));
        resp.setMeta(buildMeta(workspaceId, facets, viewerId));
        return resp;
    }

    private BoardResponse.ColumnData openPage(String workspaceId, String viewerId, GanttQuery openQuery,
                                              BoardQuery query, String column, int offset, int limit,
                                              boolean fallback, List<String> knownColumns) {
        int safeOffset = Math.max(0, offset);
        int safeLimit = Math.max(1, Math.min(100, limit));
        int allTotal = taskMapper.countOpenColumn(workspaceId, viewerId, column, fallback, knownColumns);
        int matched = hasFilters(query)
                ? taskMapper.countOpenMatched(workspaceId, openQuery, column, fallback, knownColumns)
                : allTotal;
        List<Task> items = matched <= safeOffset ? new ArrayList<Task>()
                : taskMapper.selectOpenPage(workspaceId, openQuery, column, fallback, knownColumns,
                        safeOffset, safeLimit);
        mergeTaskExtras(workspaceId, items);

        BoardResponse.ColumnData data = new BoardResponse.ColumnData();
        data.setAllTotal(allTotal);
        data.setMatched(matched);
        data.setTotal(allTotal);
        data.setItems(items);
        data.setHasMore(safeOffset + items.size() < matched);
        return data;
    }

    /** 未完成列滚动加载：与首屏同一套筛选口径，筛选和分页均在 SQL 完成 */
    public BoardResponse.ColumnData columnPage(String workspaceId, String userId, BoardQuery query,
                                               String column, int offset, int limit) {
        String col = Texts.trimToNull(column);
        if (col == null) {
            return new BoardResponse.ColumnData();
        }
        if (Consts.COL_DONE.equals(col)) {
            return donePage(workspaceId, userId, query);
        }
        LocalDate today = LocalDate.now();
        String viewerId = projectAccess.viewerScope(workspaceId, userId);
        List<BoardColumn> configCols = metaCache.columns(workspaceId);
        String fallbackCol = configCols.isEmpty() ? Consts.COL_BACKLOG : configCols.get(0).getId();
        List<String> knownColumns = new ArrayList<String>();
        for (BoardColumn c : configCols) {
            knownColumns.add(c.getId());
        }
        knownColumns.add(Consts.COL_DONE);
        GanttQuery openQuery = GanttQuery.from(query, today, null, null, false);
        openQuery.setViewerId(viewerId);
        return openPage(workspaceId, viewerId, openQuery, query, col, offset, limit <= 0 ? 60 : limit,
                col.equals(fallbackCol), knownColumns);
    }

    public BoardResponse.ColumnData donePage(String workspaceId, String userId, BoardQuery query) {
        LocalDate today = LocalDate.now();
        String viewerId = projectAccess.viewerScope(workspaceId, userId);
        LocalDate monday = today.minusDays(today.getDayOfWeek().getValue() - 1);
        LocalDate sunday = monday.plusDays(6);
        boolean scopeAll = "all".equals(query.getDoneScope());
        GanttQuery doneQuery = GanttQuery.from(query, today, null, null, true);
        doneQuery.setViewerId(viewerId);
        int doneAll = taskMapper.countDoneAll(workspaceId, viewerId);
        int doneTotal = scopeAll ? doneAll : taskMapper.countDoneInScope(workspaceId, viewerId, monday, sunday);
        int doneMatched = hasFilters(query)
                ? taskMapper.countDoneMatched(workspaceId, doneQuery, scopeAll, monday, sunday)
                : doneTotal;
        List<Task> items = doneMatched <= query.getDoneOffset() ? new ArrayList<Task>()
                : taskMapper.selectDonePage(workspaceId, doneQuery, scopeAll, monday, sunday,
                        query.getDoneOffset(), query.getDoneLimit());
        mergeTaskExtras(workspaceId, items);

        BoardResponse.ColumnData data = new BoardResponse.ColumnData();
        data.setAllTotal(doneAll);
        data.setMatched(doneMatched);
        data.setTotal(doneTotal);
        data.setItems(items);
        data.setHasMore(doneMatched > query.getDoneOffset() + query.getDoneLimit());
        return data;
    }

    /** 列表视图：筛选与 LIMIT 下推 SQL（上限 100），sort: due/priority/updated/column */
    public TaskListResponse list(String workspaceId, String userId, BoardQuery query, String sort) {
        return list(workspaceId, userId, query, sort, 0, LIST_LIMIT);
    }

    public TaskListResponse list(String workspaceId, String userId, BoardQuery query, String sort,
                                 int offset, int limit) {
        return list(workspaceId, userId, query, sort, offset, limit, true);
    }

    public TaskListResponse list(String workspaceId, String userId, BoardQuery query, String sort,
                                 int offset, int limit, boolean includeDone) {
        LocalDate today = LocalDate.now();
        GanttQuery gq = GanttQuery.from(query, today, null, null, includeDone);
        gq.setViewerId(projectAccess.viewerScope(workspaceId, userId));
        String s = "due".equals(sort) || "priority".equals(sort) || "updated".equals(sort) ? sort : "column";
        int safeOffset = Math.max(0, offset);
        int safeLimit = limit <= 0 ? LIST_LIMIT : Math.min(limit, LIST_LIMIT);
        int total = taskMapper.countTaskList(workspaceId, gq);
        List<Task> items = total <= safeOffset || total == 0 ? new ArrayList<Task>()
                : taskMapper.selectTaskList(workspaceId, gq, columnOrder(workspaceId), s, safeLimit, safeOffset);
        mergeTaskExtras(workspaceId, items);

        TaskListResponse resp = new TaskListResponse();
        resp.setTotal(total);
        resp.setOffset(safeOffset);
        resp.setLimit(safeLimit);
        resp.setItems(items);
        resp.setHasMore(safeOffset + items.size() < total);
        return resp;
    }

    /** 列表「影响版本」列：按本页任务 id 批量取 version_task 绑定（不绑定 = 待规划） */
    private void mergeVersionInfo(String workspaceId, List<Task> tasks) {
        if (tasks == null || tasks.isEmpty()) {
            return;
        }
        versionTaskMapper.enrichTasks(workspaceId, tasks);
    }

    /* ---- 甘特图（V1.4）：复用看板的扩展字段与筛选口径，避免两套语义 ---- */

    /** 全量任务 + 子任务/工时/标签/评论等扩展字段（甘特图数据源 / 公开分享不做可见范围过滤） */
    public List<Task> allWithExtras(String workspaceId) {
        return allWithExtras(workspaceId, null);
    }

    public List<Task> allWithExtras(String workspaceId, String viewerId) {
        List<Task> all = viewerId == null
                ? taskMapper.selectAll(workspaceId)
                : taskMapper.selectAllVisible(workspaceId, viewerId);
        /* selectAll 含回收站；公开分享/甘特数据源不能把软删除任务带出去 */
        List<Task> active = new ArrayList<Task>(all.size());
        for (Task t : all) {
            if (t.getDeletedAt() == null) {
                active.add(t);
            }
        }
        mergeTaskExtras(workspaceId, active);
        return active;
    }

    /** 甘特图分页后的扩展字段：只按本页 id 批量查，避免全空间聚合 */
    public void mergeGanttExtras(String workspaceId, List<Task> tasks) {
        if (tasks == null || tasks.isEmpty()) {
            return;
        }
        versionTaskMapper.enrichTasks(workspaceId, tasks);
        publications.enrichTasks(workspaceId, tasks);
        List<String> ids = new ArrayList<String>();
        for (Task t : tasks) {
            ids.add(t.getId());
        }
        Map<String, List<String>> tagMap = new HashMap<String, List<String>>();
        for (TagTaskRow row : tagMapper.selectByTaskIds(workspaceId, ids)) {
            List<String> list = tagMap.get(row.getTaskId());
            if (list == null) {
                list = new ArrayList<String>();
                tagMap.put(row.getTaskId(), list);
            }
            list.add(row.getName());
        }
        Map<String, SubtaskAgg> subMap = new HashMap<String, SubtaskAgg>();
        for (SubtaskAgg agg : subtaskMapper.countByTaskIds(workspaceId, ids)) {
            subMap.put(agg.getTaskId(), agg);
        }
        Map<String, Integer> minuteMap = new HashMap<String, Integer>();
        for (TimeAgg agg : timeLogMapper.sumByTaskIds(workspaceId, ids)) {
            minuteMap.put(agg.getTaskId(), agg.getTotalMinutes());
        }
        Map<String, Integer> commentMap = new HashMap<String, Integer>();
        for (TaskCountAgg agg : taskMapper.countCommentsByTaskIds(workspaceId, ids)) {
            commentMap.put(agg.getTaskId(), agg.getCnt());
        }
        Map<String, Integer> attachmentMap = new HashMap<String, Integer>();
        for (Attachment a : attachmentMapper.selectByTaskIds(workspaceId, ids)) {
            String tid = a.getTargetId();
            Integer n = attachmentMap.get(tid);
            attachmentMap.put(tid, n == null ? 1 : n + 1);
        }
        Map<String, String> reqNameMap = new HashMap<String, String>();
        Set<String> reqIds = new HashSet<String>();
        for (Task t : tasks) {
            if (t.getReqId() != null) {
                reqIds.add(t.getReqId());
            }
        }
        if (!reqIds.isEmpty()) {
            for (Requirement r : reqMapper.selectNamesByIds(workspaceId, new ArrayList<String>(reqIds))) {
                reqNameMap.put(r.getId(), r.getName());
            }
        }
        for (Task t : tasks) {
            SubtaskAgg sub = subMap.get(t.getId());
            t.setSubtaskTotal(sub == null || sub.getTotal() == null ? 0 : sub.getTotal());
            t.setSubtaskDone(sub == null || sub.getDone() == null ? 0 : sub.getDone());
            Integer minutes = minuteMap.get(t.getId());
            t.setTotalMinutes(minutes == null ? 0 : minutes);
            List<String> tags = tagMap.get(t.getId());
            t.setTags(tags == null ? new ArrayList<String>() : tags);
            Integer cc = commentMap.get(t.getId());
            t.setCommentCount(cc == null ? 0 : cc);
            Integer ac = attachmentMap.get(t.getId());
            t.setAttachmentCount(ac == null ? 0 : ac);
            if (t.getReqId() != null) {
                t.setSearchExtra(reqNameMap.get(t.getReqId()));
            }
        }
    }

    public com.hourglass.dto.PageResult<TaskLog> logs(
            String workspaceId, String userId, String taskId, int offset, int limit) {
        /* 回收站任务的日志保留可读（与评论一致），因此显式 INCLUDE，而不是沿用"排除已删除"的默认 */
        Task t = support.requireIncludingDeleted(workspaceId, taskId);
        projectAccess.assertViewTask(workspaceId, userId, t);
        int safeOffset = Math.max(0, offset);
        int safeLimit = Math.max(1, Math.min(100, limit));
        int total = logMapper.countByTaskId(workspaceId, taskId);
        List<TaskLog> items = total <= safeOffset ? new ArrayList<TaskLog>()
                : logMapper.selectByTaskId(workspaceId, taskId, safeOffset, safeLimit);
        return com.hourglass.dto.PageResult.of(items, total, safeOffset, safeLimit);
    }

    /** 日历视图：与指定月份有交集的全部任务（默认当月）。
     *  区间口径：[start_date, due_date]；没填开始日期（或数据异常）时退化为"只占截止日那一格"，
     *  与升级前的行为一致。IA-4：支持与看板/列表相同的筛选（负责人、优先级、模块、项目、标签、关键词）。 */
    public CalendarResponse calendar(String workspaceId, String userId, Integer year, Integer month) {
        return calendar(workspaceId, userId, year, month, new BoardQuery());
    }

    public CalendarResponse calendar(String workspaceId, String userId, Integer year, Integer month,
                                     BoardQuery query) {
        LocalDate today = LocalDate.now();
        int y = year == null ? today.getYear() : year;
        int m = month == null ? today.getMonthValue() : month;
        if (m < 1 || m > 12) {
            throw com.hourglass.common.AppException.badRequest("月份不合法：" + m);
        }
        LocalDate first = LocalDate.of(y, m, 1);
        LocalDate last = first.withDayOfMonth(first.lengthOfMonth());
        String viewerId = projectAccess.viewerScope(workspaceId, userId);
        /* SQL 先把区间收敛到 due_date（走 idx_ws_due）；「提前完成收敛到完成日」的精确判定仍在这里，口径不变 */
        List<Task> tasks = new ArrayList<Task>();
        for (Task t : taskMapper.selectCalendar(workspaceId, viewerId, first, last)) {
            LocalDate end = t.getDueDate();
            if (end == null) {
                // 没有截止日期的任务进「本月未排期」区，不占日历格
                continue;
            }
            /* 提前完成：实际结束日收敛到完成日 —— 已完成的任务不该在之后的日期里继续占格 */
            if (Consts.COL_DONE.equals(t.getBoardColumn()) && t.getCompletedAt() != null
                    && t.getCompletedAt().isBefore(end)) {
                end = t.getCompletedAt();
            }
            LocalDate begin = t.getStartDate();
            if (begin == null || begin.isAfter(end)) {
                begin = end;
            }
            if (end.isBefore(first) || begin.isAfter(last)) {
                continue;   // 区间与本月没有交集
            }
            tasks.add(t);
        }
        /* 筛选要读项目名/标签等扩展字段：先补齐再按统一 match 过滤（月份已由 SQL 收窄，量可控） */
        mergeTaskExtras(workspaceId, tasks);
        if (query != null) {
            List<Task> filtered = new ArrayList<Task>(tasks.size());
            for (Task t : tasks) {
                if (match(t, query, today)) {
                    filtered.add(t);
                }
            }
            tasks = filtered;
        }
        CalendarResponse resp = new CalendarResponse();
        resp.setYear(y);
        resp.setMonth(m);
        resp.setTasks(tasks);
        return resp;
    }

    public List<BoardColumn> boardColumns(String workspaceId) {
        return metaCache.columns(workspaceId);
    }

    /* ==================== 内部方法 ==================== */

    /** 附属数据（子任务/工时/标签/评论数/项目名/附件名）只按本次可见任务 id 批量查询 */
    void mergeTaskExtras(String workspaceId, List<Task> tasks) {
        if (tasks == null || tasks.isEmpty()) {
            return;
        }
        versionTaskMapper.enrichTasks(workspaceId, tasks);
        publications.enrichTasks(workspaceId, tasks);
        List<String> ids = new ArrayList<String>(tasks.size());
        Set<String> reqIds = new HashSet<String>();
        for (Task t : tasks) {
            ids.add(t.getId());
            if (t.getReqId() != null) {
                reqIds.add(t.getReqId());
            }
        }
        Map<String, SubtaskAgg> subMap = new HashMap<String, SubtaskAgg>();
        for (SubtaskAgg agg : subtaskMapper.countByTaskIds(workspaceId, ids)) {
            subMap.put(agg.getTaskId(), agg);
        }
        Map<String, Integer> minuteMap = new HashMap<String, Integer>();
        for (TimeAgg agg : timeLogMapper.sumByTaskIds(workspaceId, ids)) {
            minuteMap.put(agg.getTaskId(), agg.getTotalMinutes());
        }
        Map<String, List<String>> tagMap = new HashMap<String, List<String>>();
        for (TagTaskRow row : tagMapper.selectByTaskIds(workspaceId, ids)) {
            List<String> list = tagMap.get(row.getTaskId());
            if (list == null) {
                list = new ArrayList<String>();
                tagMap.put(row.getTaskId(), list);
            }
            list.add(row.getName());
        }
        /* 评论数（看板角标 / 抽屉计数） */
        Map<String, Integer> commentMap = new HashMap<String, Integer>();
        for (TaskCountAgg agg : taskMapper.countCommentsByTaskIds(workspaceId, ids)) {
            commentMap.put(agg.getTaskId(), agg.getCnt());
        }
        /* O-8：搜索范围扩到「项目名 / 模块名 / 附件文件名」，拼成扩展检索文本（不落库）。
           项目名只查任务里出现的 id；附件只查可见任务，不再整空间加载。 */
        Map<String, String> reqNameMap = new HashMap<String, String>();
        if (!reqIds.isEmpty()) {
            for (Requirement r : reqMapper.selectNamesByIds(workspaceId, new ArrayList<String>(reqIds))) {
                reqNameMap.put(r.getId(), r.getName());
            }
        }
        Map<String, String> catNameMap = new HashMap<String, String>();
        for (Category c : metaCache.categories(workspaceId)) {
            catNameMap.put(c.getId(), c.getName());
        }
        Map<String, StringBuilder> attachMap = new HashMap<String, StringBuilder>();
        Map<String, Integer> attachCounts = new HashMap<String, Integer>();
        for (Attachment a : attachmentMapper.selectByTaskIds(workspaceId, ids)) {
            StringBuilder sb = attachMap.get(a.getTargetId());
            if (sb == null) {
                sb = new StringBuilder();
                attachMap.put(a.getTargetId(), sb);
            }
            Integer ac = attachCounts.get(a.getTargetId());
            attachCounts.put(a.getTargetId(), ac == null ? 1 : ac + 1);
            if (a.getFilename() != null) {
                sb.append(' ').append(a.getFilename());
            }
        }
        for (Task t : tasks) {
            SubtaskAgg agg = subMap.get(t.getId());
            t.setSubtaskTotal(agg == null || agg.getTotal() == null ? 0 : agg.getTotal());
            t.setSubtaskDone(agg == null || agg.getDone() == null ? 0 : agg.getDone());
            Integer minutes = minuteMap.get(t.getId());
            t.setTotalMinutes(minutes == null ? 0 : minutes);
            List<String> tags = tagMap.get(t.getId());
            t.setTags(tags == null ? new ArrayList<String>() : tags);
            Integer cc = commentMap.get(t.getId());
            t.setCommentCount(cc == null ? 0 : cc);
            Integer ac = attachCounts.get(t.getId());
            t.setAttachmentCount(ac == null ? 0 : ac);
            StringBuilder extra = new StringBuilder();
            if (t.getReqId() != null) {
                String rn = reqNameMap.get(t.getReqId());
                if (rn != null) {
                    extra.append(rn).append(' ');
                }
                /* 项目名随任务下发：跨空间「我的任务」按项目分组/展示用 */
                t.setReqName(rn);
            }
            String catName = catNameMap.get(t.getCategoryId());
            if (catName != null) {
                extra.append(catName).append(' ');
            }
            StringBuilder ab = attachMap.get(t.getId());
            if (ab != null) {
                extra.append(ab);
            }
            t.setSearchExtra(extra.toString());
        }
    }

    /** 已完成列是否带筛选：无筛选时直接复用 doneScope 的计数，不再多查一次 */
    private boolean hasFilters(BoardQuery query) {
        return query.getQ() != null
                || !query.getOwners().isEmpty()
                || !query.getPris().isEmpty()
                || !query.getCats().isEmpty()
                || !query.getReqs().isEmpty()
                || !query.getTags().isEmpty()
                || !query.getTypes().isEmpty()
                || !query.getVersions().isEmpty()
                || !query.getColumns().isEmpty()
                || query.getCompletion() != null
                || query.getDue() != null
                || query.isFocus()
                || query.isBlocked()
                || query.isNoDue();
    }

    private List<Task> filter(List<Task> tasks, BoardQuery query, LocalDate today) {
        List<Task> out = new ArrayList<Task>();
        for (Task t : tasks) {
            if (match(t, query, today)) {
                out.add(t);
            }
        }
        return out;
    }

    private boolean match(Task t, BoardQuery query, LocalDate today) {
        if (query.getQ() != null) {
            String q = query.getQ().toLowerCase(Locale.ROOT);
            /* O-8：搜索范围从「标题/描述/备注」扩到 项目名 / 模块 / 标签 / 附件文件名（searchExtra 在 mergeTaskExtras 里拼好） */
            if (!contains(t.getTitle(), q) && !contains(t.getDescription(), q) && !contains(t.getNote(), q)
                    && !contains(t.getSearchExtra(), q)
                    && !tagContains(t, q)) {
                return false;
            }
        }
        if (!query.getOwners().isEmpty() && !query.getOwners().contains(t.getOwner())) {
            return false;
        }
        if (!query.getPris().isEmpty() && !query.getPris().contains(t.getPriority())) {
            return false;
        }
        if (!query.getCats().isEmpty() && !query.getCats().contains(t.getCategoryId())) {
            return false;
        }
        if (!query.getReqs().isEmpty()) {
            boolean hit = false;
            for (String value : query.getReqs()) {
                if (Consts.REQ_NONE.equals(value) ? t.getReqId() == null : value.equals(t.getReqId())) {
                    hit = true;
                    break;
                }
            }
            if (!hit) {
                return false;
            }
        }
        if (!query.getTags().isEmpty()) {
            boolean hit = false;
            List<String> taskTags = t.getTags() == null ? Collections.<String>emptyList() : t.getTags();
            for (String tag : query.getTags()) {
                if (taskTags.contains(tag)) {
                    hit = true;
                    break;
                }
            }
            if (!hit) {
                return false;
            }
        }
        if (!query.getTypes().isEmpty() && !query.getTypes().contains(t.getItemType())) {
            return false;
        }
        if (!query.getVersions().isEmpty()) {
            boolean hit = false;
            for (String value : query.getVersions()) {
                if (Consts.REQ_NONE.equals(value) ? t.getVersionIds().isEmpty() : t.getVersionIds().contains(value)) {
                    hit = true;
                    break;
                }
            }
            if (!hit) {
                return false;
            }
        }
        if (!query.getColumns().isEmpty() && !query.getColumns().contains(t.getBoardColumn())) {
            return false;
        }
        boolean isDone = Consts.COL_DONE.equals(t.getBoardColumn());
        if ("open".equals(query.getCompletion()) && isDone) {
            return false;
        }
        if ("done".equals(query.getCompletion()) && !isDone) {
            return false;
        }
        if (query.getDue() != null) {
            String rule = support.processingRule(t.getWorkspaceId(), t.getBoardColumn());
            String kind = TaskCalc.dueKind(t.getBoardColumn(), rule, t.getDueDate(), today);
            if ("soon".equals(query.getDue())) {
                if (!"soon".equals(kind) && !"today".equals(kind)) {
                    return false;
                }
            } else if (!query.getDue().equals(kind)) {
                return false;
            }
        }
        if (query.isFocus()) {
            String rule = support.processingRule(t.getWorkspaceId(), t.getBoardColumn());
            String kind = TaskCalc.dueKind(t.getBoardColumn(), rule, t.getDueDate(), today);
            boolean hit = "over".equals(kind) || "today".equals(kind)
                    || (Consts.COL_DOING.equals(t.getBoardColumn()) && "P0".equals(t.getPriority()));
            if (!hit) {
                return false;
            }
        }
        /* N-4：仅看被阻塞 */
        if (query.isBlocked() && !Boolean.TRUE.equals(t.getBlocked())) {
            return false;
        }
        /* O-25：仅看没有截止日期的任务（日历「本月未排期」用） */
        if (query.isNoDue() && t.getDueDate() != null) {
            return false;
        }
        return true;
    }

    private boolean tagContains(Task t, String lowerCaseKeyword) {
        List<String> tags = t.getTags();
        if (tags == null) {
            return false;
        }
        for (String tag : tags) {
            if (tag != null && tag.toLowerCase(Locale.ROOT).contains(lowerCaseKeyword)) {
                return true;
            }
        }
        return false;
    }

    private boolean contains(String value, String lowerCaseKeyword) {
        return value != null && value.toLowerCase(Locale.ROOT).contains(lowerCaseKeyword);
    }

    /** 到期计数：与 TaskCalc.countDue 同一口径，只是数据来自窄列投影 */
    private BoardResponse.Counts countDue(List<TaskFacetRow> facets, LocalDate today) {
        BoardResponse.Counts counts = new BoardResponse.Counts();
        for (TaskFacetRow r : facets) {
            String kind = TaskCalc.dueKind(r.getBoardColumn(), r.getProcessingRule(), r.getDueDate(), today);
            if ("over".equals(kind)) {
                counts.setOver(counts.getOver() + 1);
            } else if ("today".equals(kind)) {
                counts.setToday(counts.getToday() + 1);
            } else if ("soon".equals(kind)) {
                counts.setSoon(counts.getSoon() + 1);
            }
        }
        return counts;
    }

    private BoardResponse.Meta buildMeta(String workspaceId, List<TaskFacetRow> facets, String viewerId) {
        BoardResponse.Meta meta = new BoardResponse.Meta();
        Map<String, TaskFacetRow> byId = new HashMap<String, TaskFacetRow>();
        for (TaskFacetRow facet : facets) byId.put(facet.getId(), facet);
        List<String> ids = new ArrayList<String>(byId.keySet());
        Collections.sort(ids);
        for (int from = 0; from < ids.size(); from += 500) {
            for (com.hourglass.dto.TaskVersionBinding row : versionTaskMapper.selectVersionRowsByTaskIds(
                    workspaceId, ids.subList(from, Math.min(from + 500, ids.size())))) {
                byId.get(row.getTaskId()).getVersionIds().add(row.getVersionId());
            }
        }
        Set<String> hiddenReqs = viewerId == null ? Collections.<String>emptySet()
                : projectAccess.hiddenProjectIds(workspaceId, viewerId);

        Map<String, Integer> ownerCount = new LinkedHashMap<String, Integer>();
        Map<String, Integer> priCount = new LinkedHashMap<String, Integer>();
        Map<String, Integer> catCount = new LinkedHashMap<String, Integer>();
        Map<String, Integer> typeCount = new LinkedHashMap<String, Integer>();
        Map<String, Integer> columnCount = new LinkedHashMap<String, Integer>();
        for (BoardColumn c : metaCache.columns(workspaceId)) {
            columnCount.put(c.getId(), 0);
        }
        columnCount.put(Consts.COL_DONE, 0);
        for (String p : PRIORITIES) {
            priCount.put(p, 0);
        }
        for (String tp : TASK_TYPES) {
            typeCount.put(tp, 0);
        }
        List<Category> cats = metaCache.categories(workspaceId);
        Map<String, String> catNameById = new HashMap<String, String>();
        for (Category c : cats) {
            catCount.put(c.getId(), 0);
            catNameById.put(c.getId(), c.getName());
        }
        int unassigned = 0;
        Map<String, Integer> versionCount = new LinkedHashMap<String, Integer>();
        for (TaskFacetRow t : facets) {
            ownerCount.merge(t.getOwner(), 1, Integer::sum);
            if (priCount.containsKey(t.getPriority())) {
                priCount.merge(t.getPriority(), 1, Integer::sum);
            }
            if (catCount.containsKey(t.getCategoryId())) {
                catCount.merge(t.getCategoryId(), 1, Integer::sum);
            }
            if (typeCount.containsKey(t.getItemType())) {
                typeCount.merge(t.getItemType(), 1, Integer::sum);
            }
            if (t.getBoardColumn() != null && columnCount.containsKey(t.getBoardColumn())) {
                columnCount.merge(t.getBoardColumn(), 1, Integer::sum);
            }
            if (t.getReqId() == null) {
                unassigned++;
            }
            for (String versionId : t.getVersionIds()) {
                versionCount.merge(versionId, 1, Integer::sum);
            }
        }
        for (Map.Entry<String, Integer> e : ownerCount.entrySet()) {
            meta.getOwners().add(new BoardResponse.NameCount(e.getKey(), e.getValue()));
        }
        for (Map.Entry<String, Integer> e : priCount.entrySet()) {
            meta.getPris().add(new BoardResponse.NameCount(e.getKey(), e.getValue()));
        }
        for (Map.Entry<String, Integer> e : catCount.entrySet()) {
            meta.getCats().add(new BoardResponse.CatCount(e.getKey(), catNameById.get(e.getKey()), e.getValue()));
        }
        for (Map.Entry<String, Integer> e : typeCount.entrySet()) {
            meta.getTypes().add(new BoardResponse.NameCount(e.getKey(), e.getValue()));
        }
        for (Map.Entry<String, Integer> e : columnCount.entrySet()) {
            meta.getColumns().add(new BoardResponse.NameCount(e.getKey(), e.getValue()));
        }
        meta.setTags(metaCache.tags(workspaceId, viewerId));

        Map<String, Integer> reqCount = new LinkedHashMap<String, Integer>();
        for (TaskFacetRow t : facets) {
            if (t.getReqId() != null) {
                reqCount.merge(t.getReqId(), 1, Integer::sum);
            }
        }
        List<Requirement> reqs = reqMapper.selectAll(workspaceId);
        Map<String, String> reqName = new HashMap<String, String>();
        for (Requirement r : reqs) {
            reqName.put(r.getId(), r.getName());
        }
        for (Requirement r : reqs) {
            if (hiddenReqs.contains(r.getId())) {
                continue;
            }
            BoardResponse.ReqCount rc = new BoardResponse.ReqCount();
            rc.setId(r.getId());
            rc.setName(r.getName());
            rc.setStatus(r.getStatus());
            Integer count = reqCount.get(r.getId());
            rc.setCount(count == null ? 0 : count);
            meta.getReqs().add(rc);
        }
        int versionUnassigned = 0;
        for (TaskFacetRow t : facets) {
            if (t.getVersionIds().isEmpty()) {
                versionUnassigned++;
            }
        }
        for (com.hourglass.entity.ProjectVersion v : projectVersionMapper.selectByWorkspace(workspaceId)) {
            if (hiddenReqs.contains(v.getReqId())) {
                continue;
            }
            Integer count = versionCount.get(v.getId());
            meta.getVersions().add(new BoardResponse.VersionCount(v.getId(), v.getName(),
                    reqName.get(v.getReqId()), v.getStatus(), count == null ? 0 : count));
        }
        meta.setUnassigned(unassigned);
        meta.setVersionUnassigned(versionUnassigned);
        return meta;
    }

    /** 列表按列排序时的列顺序（与看板列配置一致，已完成最后） */
    private List<String> columnOrder(String workspaceId) {
        return new ArrayList<String>(columnIndexMap(workspaceId).keySet());
    }

    /** 列 id → 列顺序（配置列按 sortOrder，系统「已完成」恒在最后）；单次请求只读一次缓存 */
    Map<String, Integer> columnIndexMap(String workspaceId) {
        Map<String, Integer> index = new LinkedHashMap<String, Integer>();
        int i = 0;
        for (BoardColumn c : metaCache.columns(workspaceId)) {
            index.put(c.getId(), i++);
        }
        index.put(Consts.COL_DONE, i);
        return index;
    }
}
