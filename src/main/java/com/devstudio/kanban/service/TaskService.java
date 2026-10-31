package com.devstudio.kanban.service;

import com.devstudio.kanban.common.AppException;
import com.devstudio.kanban.common.Consts;
import com.devstudio.kanban.common.Ids;
import com.devstudio.kanban.common.TaskCalc;
import com.devstudio.kanban.common.Texts;
import com.devstudio.kanban.dto.BoardQuery;
import com.devstudio.kanban.dto.BoardResponse;
import com.devstudio.kanban.dto.CalendarResponse;
import com.devstudio.kanban.dto.TaskBulkMoveRequest;
import com.devstudio.kanban.dto.TaskListResponse;
import com.devstudio.kanban.dto.TaskMoveRequest;
import com.devstudio.kanban.dto.TaskSaveRequest;
import com.devstudio.kanban.entity.AppUser;
import com.devstudio.kanban.entity.Attachment;
import com.devstudio.kanban.entity.BoardColumn;
import com.devstudio.kanban.entity.Category;
import com.devstudio.kanban.entity.DevBranch;
import com.devstudio.kanban.entity.Requirement;
import com.devstudio.kanban.entity.RequirementDoc;
import com.devstudio.kanban.entity.Subtask;
import com.devstudio.kanban.entity.SubtaskAgg;
import com.devstudio.kanban.entity.Tag;
import com.devstudio.kanban.entity.TagTaskRow;
import com.devstudio.kanban.entity.Task;
import com.devstudio.kanban.entity.TaskCountAgg;
import com.devstudio.kanban.entity.TaskLog;
import com.devstudio.kanban.entity.TimeAgg;
import com.devstudio.kanban.mapper.AppNotificationMapper;
import com.devstudio.kanban.mapper.AttachmentMapper;
import com.devstudio.kanban.mapper.BoardColumnMapper;
import com.devstudio.kanban.mapper.CategoryMapper;
import com.devstudio.kanban.mapper.DevBranchMapper;
import com.devstudio.kanban.mapper.RequirementDocMapper;
import com.devstudio.kanban.mapper.RequirementMapper;
import com.devstudio.kanban.mapper.SubtaskMapper;
import com.devstudio.kanban.mapper.TagMapper;
import com.devstudio.kanban.mapper.TaskCommentMapper;
import com.devstudio.kanban.mapper.TaskBaselineMapper;
import com.devstudio.kanban.mapper.TaskDependencyMapper;
import com.devstudio.kanban.mapper.TaskLogMapper;
import com.devstudio.kanban.mapper.TaskMapper;
import com.devstudio.kanban.mapper.TimeLogMapper;
import com.devstudio.kanban.mapper.UserMapper;
import com.devstudio.kanban.mapper.WorkspaceMemberMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

@Service
public class TaskService {

    private static final String[] PRIORITIES = {"P0", "P1", "P2", "P3"};
    private static final int LIST_LIMIT = 500;
    /** 列内排序的稀疏步长：插入时取中值，只有间隔用完才整列重排 */
    private static final int SORT_STEP = 1024;

    private final TaskMapper taskMapper;
    private final RequirementMapper reqMapper;
    private final TaskLogMapper logMapper;
    private final SubtaskMapper subtaskMapper;
    private final TagMapper tagMapper;
    private final TimeLogMapper timeLogMapper;
    private final BoardColumnMapper boardColumnMapper;
    private final CategoryMapper categoryMapper;
    private final AttachmentService attachmentService;
    private final UserMapper userMapper;
    private final AttachmentMapper attachmentMapper;
    private final TaskCommentMapper commentMapper;
    private final AppNotificationMapper appNotificationMapper;
    /** 计时口径（有效工时 / 关闭计时）统一收在 TimeLogService，这里只负责在移列时触发 */
    private final TimeLogService timeLogService;
    /** 任务完成快照（「任务清单」视图的数据源） */
    private final TaskCompletionService completionService;
    /** 关联需求校验用（需求必须属于任务所选的项目） */
    private final RequirementDocMapper requirementDocMapper;
    /** 关联分支校验用（分支必须属于同一空间） */
    private final DevBranchMapper devBranchMapper;
    /** 甘特图依赖：任务彻底删除时一起清 */
    private final TaskDependencyMapper dependencyMapper;
    /** 甘特图基线：任务彻底删除时一起清 */
    private final TaskBaselineMapper baselineMapper;
    /** 负责人必须是空间成员 */
    private final WorkspaceMemberMapper memberMapper;

    public TaskService(TaskMapper taskMapper, RequirementMapper reqMapper, TaskLogMapper logMapper,
                       SubtaskMapper subtaskMapper, TagMapper tagMapper, TimeLogMapper timeLogMapper,
                       BoardColumnMapper boardColumnMapper, CategoryMapper categoryMapper,
                       AttachmentService attachmentService, UserMapper userMapper,
                       AttachmentMapper attachmentMapper,
                       TaskCommentMapper commentMapper,
                       AppNotificationMapper appNotificationMapper,
                       TimeLogService timeLogService,
                       TaskCompletionService completionService,
                       RequirementDocMapper requirementDocMapper,
                       DevBranchMapper devBranchMapper,
                       TaskDependencyMapper dependencyMapper,
                       TaskBaselineMapper baselineMapper,
                       WorkspaceMemberMapper memberMapper) {
        this.taskMapper = taskMapper;
        this.reqMapper = reqMapper;
        this.logMapper = logMapper;
        this.subtaskMapper = subtaskMapper;
        this.tagMapper = tagMapper;
        this.timeLogMapper = timeLogMapper;
        this.boardColumnMapper = boardColumnMapper;
        this.categoryMapper = categoryMapper;
        this.attachmentService = attachmentService;
        this.userMapper = userMapper;
        this.attachmentMapper = attachmentMapper;
        this.commentMapper = commentMapper;
        this.appNotificationMapper = appNotificationMapper;
        this.timeLogService = timeLogService;
        this.completionService = completionService;
        this.requirementDocMapper = requirementDocMapper;
        this.devBranchMapper = devBranchMapper;
        this.dependencyMapper = dependencyMapper;
        this.baselineMapper = baselineMapper;
        this.memberMapper = memberMapper;
    }

    /* ==================== 2026-10-16 评估报告改造新增查询 ==================== */

    /** 任务深链（O-3）：只在「我参与的空间」内查找；回收站中的任务也返回（前端据此提示"已被删除"） */
    public Task forDeepLink(String userId, String id) {
        Task t = taskMapper.selectByIdInMyWorkspaces(id, userId);
        if (t == null) {
            return null;
        }
        if (t.getDeletedAt() == null) {
            mergeTaskExtras(t.getWorkspaceId(), Collections.singletonList(t));
        }
        return t;
    }

    /** 跨空间「我的任务」（N-3） */
    public List<Task> myTasks(String userId, String displayName, boolean openOnly) {
        List<Task> list = taskMapper.selectMyTasks(userId, displayName, openOnly);
        if (list.isEmpty()) {
            return list;
        }
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
        return list;
    }

    /* ==================== 查询 ==================== */

    public BoardResponse board(String workspaceId, BoardQuery query) {
        LocalDate today = LocalDate.now();
        List<Task> all = taskMapper.selectAll(workspaceId);
        mergeTaskExtras(workspaceId, all);

        List<BoardColumn> configCols = boardColumnMapper.selectAll(workspaceId);
        Map<String, List<Task>> byCol = new LinkedHashMap<String, List<Task>>();
        for (BoardColumn c : configCols) {
            byCol.put(c.getId(), new ArrayList<Task>());
        }
        byCol.put(Consts.COL_DONE, new ArrayList<Task>());
        String fallbackCol = configCols.isEmpty() ? Consts.COL_BACKLOG : configCols.get(0).getId();
        /* 第九轮审查 #3：兜底列必须在 byCol 里真实存在。
           否则 configCols 为空（手工改库/异常恢复）时 byCol.get(fallbackCol) 返回 null，
           未完成任务会被静默丢弃，响应里只剩「已完成」一列。 */
        if (!byCol.containsKey(fallbackCol)) {
            byCol.put(fallbackCol, new ArrayList<Task>());
        }
        for (Task t : all) {
            List<Task> list = byCol.get(t.getBoardColumn());
            if (list == null) {
                list = byCol.get(fallbackCol);
            }
            if (list != null) {
                list.add(t);
            }
        }

        BoardResponse resp = new BoardResponse();
        for (BoardColumn c : configCols) {
            resp.getColumnDefs().add(new BoardResponse.ColumnDef(c.getId(), c.getName(), c.getColor(), false));
        }
        resp.getColumnDefs().add(new BoardResponse.ColumnDef(Consts.COL_DONE, "已完成", "#5f7a4a", true));

        for (Map.Entry<String, List<Task>> entry : byCol.entrySet()) {
            String col = entry.getKey();
            List<Task> colTasks = entry.getValue();
            List<Task> scope = Consts.COL_DONE.equals(col) ? inDoneScope(colTasks, query, today) : colTasks;
            List<Task> matched = filter(scope, query, today);

            BoardResponse.ColumnData data = new BoardResponse.ColumnData();
            data.setAllTotal(colTasks.size());
            data.setMatched(matched.size());
            data.setTotal(scope.size());
            if (Consts.COL_DONE.equals(col)) {
                data.setItems(page(matched, 0, query.getDoneLimit()));
                data.setHasMore(matched.size() > query.getDoneLimit());
            } else {
                data.setItems(matched);
            }
            resp.getColumns().put(col, data);
        }
        resp.setCounts(TaskCalc.countDue(all, today));
        resp.setMeta(buildMeta(workspaceId, all));
        return resp;
    }

    public BoardResponse.ColumnData donePage(String workspaceId, BoardQuery query) {
        LocalDate today = LocalDate.now();
        List<Task> all = taskMapper.selectAll(workspaceId);
        mergeTaskExtras(workspaceId, all);
        List<Task> doneAll = new ArrayList<Task>();
        for (Task t : all) {
            if (Consts.COL_DONE.equals(t.getBoardColumn())) {
                doneAll.add(t);
            }
        }
        List<Task> scope = inDoneScope(doneAll, query, today);
        List<Task> matched = filter(scope, query, today);

        BoardResponse.ColumnData data = new BoardResponse.ColumnData();
        data.setAllTotal(doneAll.size());
        data.setMatched(matched.size());
        data.setTotal(scope.size());
        data.setItems(page(matched, query.getDoneOffset(), query.getDoneLimit()));
        data.setHasMore(matched.size() > query.getDoneOffset() + query.getDoneLimit());
        return data;
    }

    /** 列表视图：筛选后的全量任务（上限 500），sort: due/priority/updated/column */
    public TaskListResponse list(String workspaceId, BoardQuery query, String sort) {
        LocalDate today = LocalDate.now();
        List<Task> all = taskMapper.selectAll(workspaceId);
        mergeTaskExtras(workspaceId, all);
        List<Task> matched = filter(all, query, today);
        final Map<String, Integer> colIndex = columnIndexMap(workspaceId);
        Comparator<Task> cmp;
        String s = sort == null ? "column" : sort;
        if ("due".equals(s)) {
            cmp = new Comparator<Task>() {
                @Override
                public int compare(Task a, Task b) {
                    if (a.getDueDate() == null && b.getDueDate() == null) return 0;
                    if (a.getDueDate() == null) return 1;
                    if (b.getDueDate() == null) return -1;
                    return a.getDueDate().compareTo(b.getDueDate());
                }
            };
        } else if ("priority".equals(s)) {
            cmp = new Comparator<Task>() {
                @Override
                public int compare(Task a, Task b) {
                    return Integer.compare(priIndex(a.getPriority()), priIndex(b.getPriority()));
                }
            };
        } else if ("updated".equals(s)) {
            cmp = new Comparator<Task>() {
                @Override
                public int compare(Task a, Task b) {
                    LocalDateTime ta = a.getUpdatedAt() == null ? LocalDateTime.MIN : a.getUpdatedAt();
                    LocalDateTime tb = b.getUpdatedAt() == null ? LocalDateTime.MIN : b.getUpdatedAt();
                    return tb.compareTo(ta);
                }
            };
        } else {
            cmp = new Comparator<Task>() {
                @Override
                public int compare(Task a, Task b) {
                    int ca = colIndex.containsKey(a.getBoardColumn()) ? colIndex.get(a.getBoardColumn()) : 999;
                    int cb = colIndex.containsKey(b.getBoardColumn()) ? colIndex.get(b.getBoardColumn()) : 999;
                    if (ca != cb) return Integer.compare(ca, cb);
                    int sa = a.getSortOrder() == null ? 0 : a.getSortOrder();
                    int sb = b.getSortOrder() == null ? 0 : b.getSortOrder();
                    return Integer.compare(sa, sb);
                }
            };
        }
        Collections.sort(matched, cmp);
        TaskListResponse resp = new TaskListResponse();
        resp.setTotal(matched.size());
        resp.setItems(matched.size() > LIST_LIMIT ? new ArrayList<Task>(matched.subList(0, LIST_LIMIT)) : matched);
        return resp;
    }

    /* ---- 甘特图（V1.4）：复用看板的扩展字段与筛选口径，避免两套语义 ---- */

    /** 全量任务 + 子任务/工时/标签/评论等扩展字段（甘特图数据源） */
    public List<Task> allWithExtras(String workspaceId) {
        List<Task> all = taskMapper.selectAll(workspaceId);
        mergeTaskExtras(workspaceId, all);
        return all;
    }

    /** 甘特图分页后的扩展字段：只按本页 id 批量查，避免全空间聚合 */
    public void mergeGanttExtras(String workspaceId, List<Task> tasks) {
        if (tasks == null || tasks.isEmpty()) {
            return;
        }
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
        Map<String, String> reqNameMap = new HashMap<String, String>();
        for (Requirement r : reqMapper.selectAll(workspaceId)) {
            reqNameMap.put(r.getId(), r.getName());
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
            if (t.getReqId() != null) {
                t.setSearchExtra(reqNameMap.get(t.getReqId()));
            }
        }
    }

    public List<TaskLog> logs(String workspaceId, String taskId) {
        requireOwned(workspaceId, taskId);
        return logMapper.selectByTaskId(workspaceId, taskId);
    }

    /** 日历视图：与指定月份有交集的全部任务（默认当月）。
     *  区间口径：[start_date, due_date]；没填开始日期（或数据异常）时退化为"只占截止日那一格"，
     *  与升级前的行为一致。 */
    public CalendarResponse calendar(String workspaceId, Integer year, Integer month) {
        LocalDate today = LocalDate.now();
        int y = year == null ? today.getYear() : year;
        int m = month == null ? today.getMonthValue() : month;
        if (m < 1 || m > 12) {
            throw AppException.badRequest("月份不合法：" + m);
        }
        LocalDate first = LocalDate.of(y, m, 1);
        LocalDate last = first.withDayOfMonth(first.lengthOfMonth());
        List<Task> tasks = new ArrayList<Task>();
        for (Task t : taskMapper.selectAll(workspaceId)) {
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
        CalendarResponse resp = new CalendarResponse();
        resp.setYear(y);
        resp.setMonth(m);
        mergeTaskExtras(workspaceId, tasks);
        resp.setTasks(tasks);
        return resp;
    }

    public List<Task> trash(String workspaceId) {
        return taskMapper.selectDeleted(workspaceId);
    }

    /* ==================== 变更 ==================== */

    @Transactional
    public Task create(String userId, String workspaceId, TaskSaveRequest req) {
        String rawId = Texts.trimToNull(req.getId());
        /* CFG 是配置审计日志的保留伪任务 ID，客户端不能占用 */
        if ("CFG".equalsIgnoreCase(rawId)) {
            throw AppException.badRequest("任务ID不可使用保留字：" + rawId);
        }
        String id = Ids.sanitize(rawId);
        if (id == null) {
            id = Ids.gen("K");
        } else if (taskMapper.selectById(id) != null) {
            throw new AppException(409, "任务ID已存在：" + id);
        } else if (taskMapper.countChildRefs(workspaceId, id) > 0) {
            // 覆盖导入会保留附件/日志等子记录但删除任务行，这类 ID 视为占用，防止旧记录误挂到新任务
            throw new AppException(409, "该ID仍关联历史附件/日志/工时记录（覆盖导入保留的旧数据），不能复用：" + id);
        } else if (completionService.hasSnapshot(workspaceId, id)) {
            /* 彻底删除后完成快照仍保留在任务清单里，复用 ID 会让新任务继承旧历史 */
            throw new AppException(409, "该ID的历史完成快照仍保留（任务清单），不能复用：" + id);
        }

        Task t = new Task();
        t.setId(id);
        t.setWorkspaceId(workspaceId);
        applyRequest(userId, workspaceId, t, req, null);
        t.setRecurType(Texts.trimToNull(req.getRecurType()));
        t.setRemindSent(Boolean.FALSE);
        t.setSortOrder(taskMapper.maxSortOrder(workspaceId, t.getBoardColumn()) + SORT_STEP);
        if (Consts.COL_DONE.equals(t.getBoardColumn())) {
            t.setCompletedAt(req.getCompletedAt() != null ? req.getCompletedAt() : LocalDate.now());
        }
        taskMapper.insert(t);
        saveTags(workspaceId, id, req.getTags());
        /* 直接建成已完成（含备份恢复）也要补完成快照，否则完成统计里查不到这条任务 */
        if (Consts.COL_DONE.equals(t.getBoardColumn())) {
            completionService.archive(t);
        }

        int subCount = 0;
        if (req.getSubtasks() != null) {
            for (TaskSaveRequest.SubtaskItem item : req.getSubtasks()) {
                if (item == null) {
                    continue;
                }
                String subTitle = Texts.trimToNull(item.getTitle());
                if (subTitle == null) {
                    continue;
                }
                Subtask s = new Subtask();
                s.setTaskId(id);
                s.setWorkspaceId(workspaceId);
                s.setTitle(Texts.cut(subTitle, 60));
                s.setDone(item.getDone() != null && item.getDone());
                subtaskMapper.insert(s);
                subCount++;
            }
        }
        log(userId, workspaceId, id, "create", subCount > 0
                ? ("恢复任务「" + t.getTitle() + "」（含 " + subCount + " 项子任务）")
                : ("创建任务「" + t.getTitle() + "」"));
        return taskMapper.selectById(id);
    }

    @Transactional
    public Task update(String userId, String workspaceId, String id, TaskSaveRequest req) {
        Task old = taskMapper.selectById(id);
        if (old == null || !workspaceId.equals(old.getWorkspaceId()) || old.getDeletedAt() != null) {
            throw AppException.notFound("任务不存在：" + id);
        }

        Task t = new Task();
        t.setId(id);
        t.setWorkspaceId(workspaceId);
        applyRequest(userId, workspaceId, t, req, old.getOwnerUserId());
        /* 旧客户端 / 快捷编辑没传里程碑时保留原值，避免被默认值清掉 */
        if (req.getIsMilestone() == null) {
            t.setIsMilestone(old.getIsMilestone());
            if (Boolean.TRUE.equals(old.getIsMilestone())) {
                LocalDate day = t.getStartDate() != null ? t.getStartDate() : t.getDueDate();
                if (day != null) {
                    t.setStartDate(day);
                    t.setDueDate(day);
                }
            }
        }
        t.setRecurType(old.getRecurType());
        if (req.getRecurType() != null) {
            t.setRecurType(Texts.trimToNull(req.getRecurType()));
        }
        t.setRecurNextId(old.getRecurNextId());
        boolean remindChanged = !sameMinute(old.getRemindAt(), req.getRemindAt());
        t.setRemindAt(req.getRemindAt());
        t.setRemindSent(remindChanged || old.getRemindSent() == null ? Boolean.FALSE : old.getRemindSent());

        List<String> oldTags = tagNames(workspaceId, id);
        boolean movedToDone = !old.getBoardColumn().equals(t.getBoardColumn())
                && Consts.COL_DONE.equals(t.getBoardColumn());
        /* 从已完成列移走 = 取消完成：归档记录要一起撤掉 */
        boolean leftDone = !old.getBoardColumn().equals(t.getBoardColumn())
                && Consts.COL_DONE.equals(old.getBoardColumn());
        if (!old.getBoardColumn().equals(t.getBoardColumn())) {
            t.setSortOrder(taskMapper.maxSortOrder(workspaceId, t.getBoardColumn()) + SORT_STEP);
            if (movedToDone) {
                t.setCompletedAt(LocalDate.now());
                timeLogService.closeRunningForTask(workspaceId, id, userId, "任务已完成");
                /* 抽屉里改成已完成也接力：进行中不该出现"谁都没在计时"的空档 */
                timeLogService.resumeInColumn(userId, workspaceId, old.getBoardColumn(), id);
            } else {
                t.setCompletedAt(null);
                if (Consts.COL_BACKLOG.equals(t.getBoardColumn())) {
                    /* 抽屉里把列改成「待处理」：工时保留，计时停掉 */
                    timeLogService.closeRunningForTask(workspaceId, id, userId, "移回待处理");
                }
            }
        } else {
            t.setSortOrder(old.getSortOrder());
            t.setCompletedAt(old.getCompletedAt());
        }
        boolean columnChanged = !old.getBoardColumn().equals(t.getBoardColumn());
        List<String> changes = diffParts(workspaceId, old, t, oldTags, req.getTags());
        taskMapper.update(t);
        // 先落最终标签，再派生下一次任务：保证循环任务的后续任务继承本次保存后的标签
        saveTags(workspaceId, id, req.getTags());
        if (movedToDone) {
            completionService.archive(t);
        } else if (leftDone) {
            completionService.remove(workspaceId, id);
        }
        if (movedToDone) {
            maybeGenerateNext(userId, workspaceId, t, old.getBoardColumn());
        }
        /* 抽屉里改列也是“移动”：流程体检只读 action=move 的日志，
           只记 update 会让这些移动在停留时长/返工率里凭空消失。 */
        if (columnChanged) {
            log(userId, workspaceId, id, "move",
                    "从「" + columnName(workspaceId, old.getBoardColumn()) + "」移动到「" + columnName(workspaceId, t.getBoardColumn()) + "」",
                    old.getBoardColumn(), t.getBoardColumn());
        }
        if (!columnChanged || !changes.isEmpty()) {
            String detail = changes.isEmpty()
                    ? "更新任务「" + t.getTitle() + "」（无字段变化）"
                    : Texts.cut("更新任务「" + t.getTitle() + "」：" + String.join("；", changes), 250);
            log(userId, workspaceId, id, "update", detail);
        }
        Task result = taskMapper.selectById(id);
        result.setTags(tagNames(workspaceId, id));
        return result;
    }

    /** 取前后两项之间的中值；返回 -1 表示间隔不够，需要整列重排 */
    private int sparseOrder(Task prev, Task next) {
        Integer p = prev == null ? null : prev.getSortOrder();
        Integer n = next == null ? null : next.getSortOrder();
        if (p == null && n == null) {
            return 0;
        }
        if (p == null) {
            return n > SORT_STEP ? n - SORT_STEP : -1;
        }
        if (n == null) {
            return p + SORT_STEP;
        }
        return n - p > 1 ? p + (n - p) / 2 : -1;
    }

    @Transactional
    public Map<String, Object> move(String userId, String workspaceId, String id, TaskMoveRequest req) {
        Task task = taskMapper.selectById(id);
        if (task == null || !workspaceId.equals(task.getWorkspaceId()) || task.getDeletedAt() != null) {
            throw AppException.notFound("任务不存在：" + id);
        }
        String from = task.getBoardColumn();
        String to = req.getColumn();
        validateColumn(workspaceId, to);

        List<Task> target = new ArrayList<Task>();
        for (Task t : taskMapper.selectColumnTasks(workspaceId, to)) {
            if (!t.getId().equals(id)) {
                target.add(t);
            }
        }
        int position = target.size();
        String beforeId = Texts.trimToNull(req.getBeforeId());
        if (beforeId != null) {
            for (int i = 0; i < target.size(); i++) {
                if (target.get(i).getId().equals(beforeId)) {
                    position = i;
                    break;
                }
            }
        }
        /* 稀疏编号：只改被拖动的一条；只有前后间隔用完时才重排整列 */
        Task prev = position > 0 ? target.get(position - 1) : null;
        Task next = position < target.size() ? target.get(position) : null;
        int sparse = sparseOrder(prev, next);

        task.setBoardColumn(to);
        String generatedDue = null;
        boolean autoTimerStarted = false;
        Task resumed = null;
        if (!from.equals(to)) {
            if (Consts.COL_DONE.equals(to)) {
                task.setCompletedAt(LocalDate.now());
                /* 拖到已完成：把这个任务上所有人的计时都停掉（口径：每天 8 小时、跳过周末） */
                timeLogService.closeRunningForTask(workspaceId, id, userId, "任务已完成");
                /* 接力：「进行中」不该出现"这一列谁都没在计时"的空档 —— 自动接上同列的下一个任务。
                   批量移动/整理数据时 autoResume=false，避免突然开表。 */
                boolean wantResume = req.getAutoResume() == null || req.getAutoResume();
                if (wantResume) {
                    resumed = timeLogService.resumeInColumn(userId, workspaceId, from, id);
                }
                generatedDue = maybeGenerateNext(userId, workspaceId, task, from);
            } else {
                task.setCompletedAt(null);
                if (Consts.COL_BACKLOG.equals(to)) {
                    /* 回退到待处理：已记录的工时保留，但不再继续计时（待处理的任务不该有在跑的计时） */
                    timeLogService.closeRunningForTask(workspaceId, id, userId, "移回待处理");
                } else {
                    /* 拖进「进行中」（或任何非待处理、非已完成的列）= 开工，自动开始计时。
                       若本人已有别的任务在计时，start() 会先把它停掉 —— 个人同一时刻只计一个任务。
                       autoTimer=false 时跳过（"取消完成"这类回退操作不该顺手开表）。 */
                    boolean wantAuto = req.getAutoTimer() == null || req.getAutoTimer();
                    if (wantAuto) {
                        Map<String, Object> work = timeLogService.start(userId, workspaceId, id);
                        autoTimerStarted = Boolean.TRUE.equals(work.get("running"));
                    }
                }
            }
        }
        target.add(position, task);
        if(sparse >= 0){
            task.setSortOrder(sparse);
        }else{
            /* 间隔用完：整列按 1024 重新编号（含被拖动的任务） */
            for (int i = 0; i < target.size(); i++) {
                Task t = target.get(i);
                int order = i * SORT_STEP;
                t.setSortOrder(order);
                if (!t.getId().equals(id)) {
                    taskMapper.updateSortOrder(t.getId(), order);
                }
            }
        }
        taskMapper.update(task);

        /* 「任务清单」归档：完成时落快照，取消完成时删掉（重复完成会重新生成） */
        if (!from.equals(to)) {
            if (Consts.COL_DONE.equals(to)) {
                completionService.archive(task);
            } else if (Consts.COL_DONE.equals(from)) {
                completionService.remove(workspaceId, id);
            }
        }

        String detail = from.equals(to)
                ? "「" + columnName(workspaceId, to) + "」列内顺序调整"
                : "从「" + columnName(workspaceId, from) + "」移动到「" + columnName(workspaceId, to) + "」";
        /* 列内排序（from==to）不算流程事件，不写 from/to，免得把"停留"切成碎段 */
        log(userId, workspaceId, id, "move", detail,
                from.equals(to) ? null : from, from.equals(to) ? null : to);

        Map<String, Object> res = new LinkedHashMap<String, Object>();
        res.put("task", taskMapper.selectById(id));
        res.put("from", from);
        res.put("to", to);
        res.put("generatedDue", generatedDue);
        /* 拖进「进行中」会自动开始计时，前端据此给一条提示，避免"拖了没反应" */
        res.put("autoTimerStarted", autoTimerStarted);
        /* 完成后接力上的下一个任务（有的话），前端会提示"已接着开始「X」" */
        res.put("autoTimerTask", resumed == null ? null : resumed.getTitle());
        return res;
    }

    /**
     * 批量改列：逐个走 move 语义（移动日志、完成归档、循环派生都一致）。
     * 批量操作不自动开始计时、不接力计时；任一项失败整批回滚，避免“一半成功”的中间态。
     */
    @Transactional
    public Map<String, Object> bulkMove(String userId, String workspaceId, TaskBulkMoveRequest req) {
        validateColumn(workspaceId, req.getColumn());
        Set<String> seen = new HashSet<String>();
        int moved = 0;
        for (String id : req.getIds()) {
            String taskId = Texts.trimToNull(id);
            if (taskId == null || !seen.add(taskId)) {
                continue;
            }
            TaskMoveRequest one = new TaskMoveRequest();
            one.setColumn(req.getColumn());
            one.setAutoTimer(req.getAutoTimer() != null && req.getAutoTimer());
            one.setAutoResume(req.getAutoResume() != null && req.getAutoResume());
            move(userId, workspaceId, taskId, one);
            moved++;
        }
        Map<String, Object> res = new LinkedHashMap<String, Object>();
        res.put("moved", moved);
        res.put("column", req.getColumn());
        return res;
    }

    /**
     * 取消完成：回到「完成前所在列」，而不是固定回「进行中」。
     * 优先用最近一次移入 done 的移动日志；列已被删除/找不到时依次回退到 doing、第一个非完成列、backlog。
     */
    @Transactional
    public Map<String, Object> reopen(String userId, String workspaceId, String id) {
        Task task = taskMapper.selectById(id);
        if (task == null || !workspaceId.equals(task.getWorkspaceId()) || task.getDeletedAt() != null) {
            throw AppException.notFound("任务不存在：" + id);
        }
        if (!Consts.COL_DONE.equals(task.getBoardColumn())) {
            throw AppException.badRequest("任务不在已完成列，无需取消完成");
        }
        String target = logMapper.selectLastDoneFromColumn(workspaceId, id);
        if (target != null && (Consts.COL_DONE.equals(target) || !columnExists(workspaceId, target))) {
            target = null;
        }
        if (target == null) {
            target = columnExists(workspaceId, Consts.COL_DOING) ? Consts.COL_DOING : firstOpenColumn(workspaceId);
        }
        TaskMoveRequest req = new TaskMoveRequest();
        req.setColumn(target);
        req.setAutoTimer(false);
        req.setAutoResume(false);
        return move(userId, workspaceId, id, req);
    }

    private boolean columnExists(String workspaceId, String column) {
        if (column == null) {
            return false;
        }
        if (Consts.COL_BACKLOG.equals(column) || Consts.COL_DOING.equals(column) || Consts.COL_DONE.equals(column)) {
            return true;
        }
        return boardColumnMapper.selectById(workspaceId, column) != null;
    }

    private String firstOpenColumn(String workspaceId) {
        for (BoardColumn c : boardColumnMapper.selectAll(workspaceId)) {
            if (!Consts.COL_DONE.equals(c.getId())) {
                return c.getId();
            }
        }
        return Consts.COL_BACKLOG;
    }

    /** 软删除：进回收站，30 天后由定时任务清理 */
    @Transactional
    public void delete(String userId, String workspaceId, String id) {
        Task t = taskMapper.selectById(id);
        if (t == null || !workspaceId.equals(t.getWorkspaceId()) || t.getDeletedAt() != null) {
            throw AppException.notFound("任务不存在：" + id);
        }
        taskMapper.softDelete(id);
        timeLogService.closeRunningForTask(workspaceId, id, userId, "任务已移入回收站");
        log(userId, workspaceId, id, "delete", "移入回收站「" + t.getTitle() + "」（30 天后自动清理）");
    }

    @Transactional
    public void restore(String userId, String workspaceId, String id) {
        Task t = taskMapper.selectById(id);
        if (t == null || !workspaceId.equals(t.getWorkspaceId()) || t.getDeletedAt() == null) {
            throw AppException.notFound("回收站中没有该任务：" + id);
        }
        taskMapper.restore(id);
        /* O-26：把"刚删就撤销"和"从回收站恢复"在时间线上区分开，让"这条任务为什么又回来了"可解释 */
        boolean undo = t.getDeletedAt() != null
                && ChronoUnit.SECONDS.between(t.getDeletedAt(), LocalDateTime.now()) <= 120;
        log(userId, workspaceId, id, "restore", undo
                ? "撤销删除：「" + t.getTitle() + "」回到看板"
                : "从回收站恢复「" + t.getTitle() + "」");
    }

    @Transactional
    public void purge(String workspaceId, String id) {
        Task t = taskMapper.selectById(id);
        if (t == null || !workspaceId.equals(t.getWorkspaceId()) || t.getDeletedAt() == null) {
            throw AppException.notFound("回收站中没有该任务：" + id);
        }
        deleteChildren(t);
        taskMapper.deleteById(id);
    }

    /** 定时任务调用：清理超过保留期的回收站任务（跨空间），返回清理条数 */
    @Transactional
    public int purgeExpired(LocalDateTime cutoff) {
        List<Task> tasks = taskMapper.selectPurgeable(cutoff);
        for (Task t : tasks) {
            deleteChildren(t);
            taskMapper.deleteById(t.getId());
        }
        return tasks.size();
    }

    /* ==================== 列 ==================== */

    public List<BoardColumn> boardColumns(String workspaceId) {
        return boardColumnMapper.selectAll(workspaceId);
    }

    /* ==================== 内部方法 ==================== */

    private Task requireOwned(String workspaceId, String taskId) {
        Task t = taskMapper.selectById(taskId);
        if (t == null || !workspaceId.equals(t.getWorkspaceId())) {
            throw AppException.notFound("任务不存在：" + taskId);
        }
        return t;
    }

    private void deleteChildren(Task t) {
        subtaskMapper.deleteByTaskId(t.getWorkspaceId(), t.getId());
        tagMapper.deleteTaskTags(t.getWorkspaceId(), t.getId());
        timeLogMapper.deleteByTaskId(t.getWorkspaceId(), t.getId());
        attachmentService.deleteByTask(t.getWorkspaceId(), t.getId());
        logMapper.deleteByTaskId(t.getWorkspaceId(), t.getId());
        /* 完成快照不随任务删除：任务清单是历史快照，彻底删除后仍保留；
           ID 复用由 create() 里的 hasSnapshot 检查拦住。 */
        /* 第九轮审查 #1/#2：评论与应用内通知必须跟着任务一起清。
           漏清的后果不只是"孤儿数据无限增长"——TaskMapper.countChildRefs 把 task_comment
           计入，已彻底删除的任务 ID 会因此被永久锁死（既不能新建同 ID，同 ID 还原时
           旧评论还会挂到新任务上，把上一个任务的讨论显示给新任务）。 */
        commentMapper.deleteByTaskId(t.getWorkspaceId(), t.getId());
        appNotificationMapper.deleteByTaskId(t.getWorkspaceId(), t.getId());
        // 任务行即将消失、ID 可被复用：清掉上游循环派生关联，避免之后误认到无关的新任务
        taskMapper.clearRecurNext(t.getId());
        /* 甘特图：依赖与基线跟着任务一起清理，避免 ID 复用后把旧关系挂到新任务上 */
        dependencyMapper.deleteByTask(t.getWorkspaceId(), t.getId());
        baselineMapper.deleteByTask(t.getWorkspaceId(), t.getId());
    }

    /* 计时相关的计算（有效工时 / 关闭计时）已统一收在 TimeLogService，这里不再各留一套口径 */

    /** 提醒时间按分钟比较：前端 datetime-local 不带秒，避免编辑其他字段时误重置提醒状态 */
    private boolean sameMinute(LocalDateTime a, LocalDateTime b) {
        if (a == null && b == null) {
            return true;
        }
        if (a == null || b == null) {
            return false;
        }
        return a.truncatedTo(ChronoUnit.MINUTES).equals(b.truncatedTo(ChronoUnit.MINUTES));
    }

    /** 完成时生成下一次循环任务，返回新生成的截止日期（不循环或复用已有后续任务返回 null） */
    private String maybeGenerateNext(String userId, String workspaceId, Task doneTask, String fromColumn) {
        if (doneTask.getRecurType() == null || Consts.COL_DONE.equals(fromColumn)) {
            return null;
        }
        // 重新打开后再次完成：本任务已派生过下一次且它仍有效 → 复用，不重复生成
        String linkedId = doneTask.getRecurNextId();
        if (linkedId != null) {
            Task linked = taskMapper.selectById(linkedId);
            // 只认同一空间的目标：彻底删除已清除关联，但历史遗留关联或 ID 复用可能跨空间命中，一律视为失效
            if (linked != null && workspaceId.equals(linked.getWorkspaceId())) {
                log(userId, workspaceId, doneTask.getId(), "update", "重复完成：沿用已生成的下一次任务");
                return null;
            }
        }
        LocalDate today = LocalDate.now();
        // 提前/按期完成保持原周期；逾期完成则从今天顺延，避免生成"出生即逾期"的下一次
        LocalDate base = (doneTask.getDueDate() != null && !doneTask.getDueDate().isBefore(today))
                ? doneTask.getDueDate() : today;
        LocalDate next;
        if ("daily".equals(doneTask.getRecurType())) {
            next = base.plusDays(1);
        } else if ("weekly".equals(doneTask.getRecurType())) {
            next = base.plusWeeks(1);
        } else if ("monthly".equals(doneTask.getRecurType())) {
            next = base.plusMonths(1);
        } else {
            return null;
        }
        List<BoardColumn> cols = boardColumnMapper.selectAll(workspaceId);
        String firstCol = cols.isEmpty() ? Consts.COL_BACKLOG : cols.get(0).getId();

        Task nt = new Task();
        nt.setId(Ids.gen("K"));
        nt.setWorkspaceId(workspaceId);
        nt.setTitle(doneTask.getTitle());
        nt.setDescription(doneTask.getDescription());
        nt.setPriority(doneTask.getPriority());
        nt.setOwner(doneTask.getOwner());
        /* N-2 / N-1：下一次循环任务继承身份绑定与提醒对象 */
        nt.setOwnerUserId(doneTask.getOwnerUserId());
        nt.setRemindTarget(doneTask.getRemindTarget());
        nt.setCategory(doneTask.getCategory());
        nt.setBoardColumn(firstCol);
        nt.setDueDate(next);
        nt.setReqId(doneTask.getReqId());
        /* 循环任务的下一次落在同一需求下 */
        nt.setReqDocId(doneTask.getReqDocId());
        /* 长期任务（如每周回归）通常还在同一条分支上，一起继承 */
        nt.setBranchId(doneTask.getBranchId());
        nt.setProgress(0);
        nt.setRecurType(doneTask.getRecurType());
        nt.setEstimateMinutes(doneTask.getEstimateMinutes());
        nt.setIsMilestone(doneTask.getIsMilestone());
        if (Boolean.TRUE.equals(doneTask.getIsMilestone())) {
            nt.setStartDate(next);
        }
        nt.setRemindSent(Boolean.FALSE);
        nt.setSortOrder(taskMapper.maxSortOrder(workspaceId, firstCol) + SORT_STEP);
        taskMapper.insert(nt);
        // 关联写入是并发完成的唯一裁决点：条件更新只允许第一个成功，落败方回删刚插入的任务（此刻尚无子任务/标签/日志）
        if (taskMapper.setRecurNext(doneTask.getId(), nt.getId()) == 0) {
            taskMapper.deleteById(nt.getId());
            log(userId, workspaceId, doneTask.getId(), "update", "检测到并发完成：沿用另一端已生成的下一次任务");
            return null;
        }

        for (Subtask s : subtaskMapper.selectByTaskId(workspaceId, doneTask.getId())) {
            Subtask ns = new Subtask();
            ns.setTaskId(nt.getId());
            ns.setWorkspaceId(workspaceId);
            ns.setTitle(s.getTitle());
            ns.setDone(Boolean.FALSE);
            subtaskMapper.insert(ns);
        }
        saveTags(workspaceId, nt.getId(), tagNames(workspaceId, doneTask.getId()));

        log(userId, workspaceId, nt.getId(), "create", "由循环任务生成「" + nt.getTitle() + "」（截止 " + next + "）");
        log(userId, workspaceId, doneTask.getId(), "update", "完成后生成下次任务「" + nt.getTitle() + "」（截止 " + next + "）");
        return next.toString();
    }

    private void applyRequest(String userId, String workspaceId, Task t, TaskSaveRequest req,
                              String oldOwnerUserId) {
        t.setTitle(req.getTitle().trim());
        t.setDescription(Texts.trimToNull(req.getDescription()));
        t.setPriority(req.getPriority() == null ? "P2" : req.getPriority());
        String owner = Texts.trimToNull(req.getOwner());
        if (owner != null) {
            // 负责人拼接进筛选参数（逗号分隔），不允许含逗号
            owner = owner.replace(',', ' ').replace('，', ' ').trim();
        }
        /* N-2 身份绑定：给了账号ID就以账号为准，并用其当前显示名补齐文本；
           只给文本（含"非成员"历史值）时不绑定账号，保持向后兼容。 */
        String ownerUserId = Texts.trimToNull(req.getOwnerUserId());
        if (ownerUserId != null) {
            AppUser ou = userMapper.selectById(ownerUserId);
            if (ou == null) {
                throw AppException.badRequest("负责人账号不存在：" + ownerUserId);
            }
            if (memberMapper.selectMember(workspaceId, ownerUserId) == null
                    && !ownerUserId.equals(oldOwnerUserId)) {
                /* 成员已离开空间的历史任务允许原样保存，但不能再把任务新指派给非成员 */
                throw AppException.badRequest("负责人不是该空间成员：" + ownerUserId);
            }
            t.setOwnerUserId(ownerUserId);
            if (owner == null || owner.isEmpty()) {
                owner = ou.getDisplayName();
            }
        } else {
            t.setOwnerUserId(null);
        }
        t.setOwner(owner == null || owner.isEmpty() ? defaultOwner(userId) : Texts.cut(owner, 32));
        String category = Texts.trimToNull(req.getCategory());
        if (category != null) {
            if (categoryMapper.selectByName(workspaceId, category) == null) {
                throw AppException.badRequest("分类不存在：" + category);
            }
            t.setCategory(category);
        } else {
            t.setCategory(defaultCategory(workspaceId));
        }
        t.setBoardColumn(req.getBoardColumn() == null ? Consts.COL_BACKLOG : req.getBoardColumn());
        validateColumn(workspaceId, t.getBoardColumn());
        /* 开始日期：日历按 [startDate, dueDate] 区间逐日展示；为空则只在截止日出现 */
        if (req.getStartDate() != null && req.getDueDate() != null
                && req.getStartDate().isAfter(req.getDueDate())) {
            throw AppException.badRequest("开始日期不能晚于截止日期");
        }
        t.setStartDate(req.getStartDate());
        t.setDueDate(req.getDueDate());
        /* 里程碑是单日节点：只给了一端就补另一端；两端都给时以开始日为准 */
        if (Boolean.TRUE.equals(req.getIsMilestone())) {
            LocalDate milestoneDay = t.getStartDate() != null ? t.getStartDate() : t.getDueDate();
            if (milestoneDay != null) {
                t.setStartDate(milestoneDay);
                t.setDueDate(milestoneDay);
            }
        }
        String reqId = Texts.trimToNull(req.getReqId());
        if (reqId != null) {
            Requirement r = reqMapper.selectById(reqId);
            if (r == null || !workspaceId.equals(r.getWorkspaceId())) {
                throw AppException.badRequest("所属项目不存在：" + reqId);
            }
        }
        t.setReqId(reqId);
        /* 关联需求：必须存在、同空间、且属于任务所选的那个项目。
           项目为空 / 换了项目时，旧需求自动失效（前端也会在切项目时清空下拉）。 */
        String reqDocId = Texts.trimToNull(req.getReqDocId());
        if (reqDocId != null) {
            if (reqId == null) {
                throw AppException.badRequest("请先选择所属项目，再关联需求");
            }
            RequirementDoc doc = requirementDocMapper.selectById(reqDocId);
            if (doc == null || !workspaceId.equals(doc.getWorkspaceId()) || !reqId.equals(doc.getReqId())) {
                throw AppException.badRequest("所选需求不属于该项目");
            }
        }
        t.setReqDocId(reqDocId);
        /* 关联分支：空间级分支池，只校验存在性与同空间（分支不绑项目，换项目不影响关联） */
        String branchId = Texts.trimToNull(req.getBranchId());
        if (branchId != null) {
            DevBranch br = devBranchMapper.selectById(branchId);
            if (br == null || !workspaceId.equals(br.getWorkspaceId())) {
                throw AppException.badRequest("所选分支不存在：" + branchId);
            }
        }
        t.setBranchId(branchId);
        t.setProgress(req.getProgress() == null ? 0 : Math.max(0, Math.min(100, req.getProgress())));
        t.setIsMilestone(Boolean.TRUE.equals(req.getIsMilestone()));
        /* 预估耗时：0 与空等价，都表示"没估过"，不要存 0 去污染系数计算 */
        Integer est = req.getEstimateMinutes();
        t.setEstimateMinutes(est == null || est <= 0 ? null : est);
        t.setNote(Texts.trimToNull(req.getNote()));
        t.setRemindAt(req.getRemindAt());
        /* N-1：提醒谁（默认仅负责人；未知值归一，避免脏数据进入通知链路） */
        String remindTarget = Texts.trimToNull(req.getRemindTarget());
        t.setRemindTarget("owner+admin".equals(remindTarget) ? "owner+admin" : "owner");
        /* N-4：阻塞 / 卡点（取消阻塞时一并清空原因与依赖） */
        boolean blocked = Boolean.TRUE.equals(req.getBlocked());
        String reason = Texts.trimToNull(req.getBlockedReason());
        t.setBlocked(blocked);
        t.setBlockedReason(blocked && reason != null ? Texts.cut(reason, 120) : null);
        String blockedBy = blocked ? Texts.trimToNull(req.getBlockedByTaskId()) : null;
        if (blockedBy != null) {
            /* 前置任务只认同空间、未删除的有效任务；失效引用静默清空，避免历史任务被锁死无法保存 */
            Task pre = taskMapper.selectById(blockedBy);
            if (blockedBy.equals(t.getId()) || pre == null
                    || !workspaceId.equals(pre.getWorkspaceId()) || pre.getDeletedAt() != null) {
                blockedBy = null;
            }
        }
        t.setBlockedByTaskId(blockedBy);
    }

    private String defaultOwner(String userId) {
        AppUser u = userMapper.selectById(userId);
        return u == null || Texts.trimToNull(u.getDisplayName()) == null ? "我" : u.getDisplayName();
    }

    private String defaultCategory(String workspaceId) {
        List<Category> list = categoryMapper.selectByWorkspace(workspaceId);
        return list.isEmpty() ? "" : list.get(0).getName();
    }

    private void validateColumn(String workspaceId, String column) {
        if (Consts.COL_DONE.equals(column)) {
            return;
        }
        if (boardColumnMapper.selectById(workspaceId, column) == null) {
            throw AppException.badRequest("看板列不存在：" + column);
        }
    }

    private void saveTags(String workspaceId, String taskId, List<String> names) {
        tagMapper.deleteTaskTags(workspaceId, taskId);
        if (names == null) {
            return;
        }
        Set<String> seen = new HashSet<String>();
        int count = 0;
        for (String raw : names) {
            String name = Texts.trimToNull(raw);
            if (name == null) {
                continue;
            }
            // 标签名不允许含逗号（前端用逗号分隔），替换为空格
            name = name.replace(',', ' ').replace('，', ' ').trim();
            if (name.isEmpty()) {
                continue;
            }
            name = Texts.cut(name, 16);
            if (!seen.add(name)) {
                continue;
            }
            if (++count > 8) {
                break;
            }
            Tag tag = tagMapper.selectByName(workspaceId, name);
            if (tag == null) {
                tag = new Tag();
                tag.setId(Ids.gen("T"));
                tag.setWorkspaceId(workspaceId);
                tag.setName(name);
                try {
                    tagMapper.insert(tag);
                } catch (Exception e) {
                    tag = tagMapper.selectByName(workspaceId, name);
                }
                if (tag == null) {
                    continue;
                }
            }
            tagMapper.insertTaskTag(taskId, tag.getId(), workspaceId);
        }
    }

    private List<String> tagNames(String workspaceId, String taskId) {
        List<String> names = new ArrayList<String>();
        List<TagTaskRow> rows = tagMapper.selectByTaskIds(workspaceId, Collections.singletonList(taskId));
        for (TagTaskRow row : rows) {
            names.add(row.getName());
        }
        return names;
    }

    private void mergeTaskExtras(String workspaceId, List<Task> tasks) {
        if (tasks.isEmpty()) {
            return;
        }
        Map<String, SubtaskAgg> subMap = new HashMap<String, SubtaskAgg>();
        for (SubtaskAgg agg : subtaskMapper.countByTask(workspaceId)) {
            subMap.put(agg.getTaskId(), agg);
        }
        Map<String, Integer> minuteMap = new HashMap<String, Integer>();
        for (TimeAgg agg : timeLogMapper.sumByTaskByWorkspace(workspaceId)) {
            minuteMap.put(agg.getTaskId(), agg.getTotalMinutes());
        }
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
        /* 评论数（看板角标 / 抽屉计数） */
        Map<String, Integer> commentMap = new HashMap<String, Integer>();
        for (TaskCountAgg agg : taskMapper.countCommentsByTask(workspaceId)) {
            commentMap.put(agg.getTaskId(), agg.getCnt());
        }
        /* O-8：搜索范围扩到「项目名 / 附件文件名」，拼成扩展检索文本（不落库） */
        Map<String, String> reqNameMap = new HashMap<String, String>();
        for (Requirement r : reqMapper.selectAll(workspaceId)) {
            reqNameMap.put(r.getId(), r.getName());
        }
        Map<String, StringBuilder> attachMap = new HashMap<String, StringBuilder>();
        for (Attachment a : attachmentMapper.selectAllByWorkspace(workspaceId)) {
            StringBuilder sb = attachMap.get(a.getTaskId());
            if (sb == null) {
                sb = new StringBuilder();
                attachMap.put(a.getTaskId(), sb);
            }
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
            StringBuilder extra = new StringBuilder();
            if (t.getReqId() != null) {
                String rn = reqNameMap.get(t.getReqId());
                if (rn != null) {
                    extra.append(rn).append(' ');
                }
            }
            StringBuilder ab = attachMap.get(t.getId());
            if (ab != null) {
                extra.append(ab);
            }
            t.setSearchExtra(extra.toString());
        }
    }

    private List<Task> inDoneScope(List<Task> doneTasks, BoardQuery query, LocalDate today) {
        if ("all".equals(query.getDoneScope())) {
            return new ArrayList<Task>(doneTasks);
        }
        LocalDate monday = today.minusDays(today.getDayOfWeek().getValue() - 1);
        LocalDate sunday = monday.plusDays(6);
        List<Task> list = new ArrayList<Task>();
        for (Task t : doneTasks) {
            LocalDate completed = t.getCompletedAt();
            if (completed == null || (!completed.isBefore(monday) && !completed.isAfter(sunday))) {
                list.add(t);
            }
        }
        return list;
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
            /* O-8：搜索范围从「标题/描述/备注」扩到 项目名 / 分类 / 标签 / 附件文件名（searchExtra 在 mergeTaskExtras 里拼好） */
            if (!contains(t.getTitle(), q) && !contains(t.getDescription(), q) && !contains(t.getNote(), q)
                    && !contains(t.getCategory(), q) && !contains(t.getSearchExtra(), q)
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
        if (!query.getCats().isEmpty() && !query.getCats().contains(t.getCategory())) {
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
        if (query.getDue() != null) {
            String kind = TaskCalc.dueKind(t, today);
            if ("soon".equals(query.getDue())) {
                if (!"soon".equals(kind) && !"today".equals(kind)) {
                    return false;
                }
            } else if (!query.getDue().equals(kind)) {
                return false;
            }
        }
        if (query.isFocus()) {
            String kind = TaskCalc.dueKind(t, today);
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

    private List<Task> page(List<Task> list, int offset, int limit) {
        if (offset >= list.size()) {
            return new ArrayList<Task>();
        }
        int end = Math.min(list.size(), offset + limit);
        return new ArrayList<Task>(list.subList(offset, end));
    }

    private BoardResponse.Meta buildMeta(String workspaceId, List<Task> all) {
        BoardResponse.Meta meta = new BoardResponse.Meta();

        Map<String, Integer> ownerCount = new LinkedHashMap<String, Integer>();
        Map<String, Integer> priCount = new LinkedHashMap<String, Integer>();
        Map<String, Integer> catCount = new LinkedHashMap<String, Integer>();
        for (String p : PRIORITIES) {
            priCount.put(p, 0);
        }
        List<Category> cats = categoryMapper.selectByWorkspace(workspaceId);
        for (Category c : cats) {
            catCount.put(c.getName(), 0);
        }
        int unassigned = 0;
        for (Task t : all) {
            ownerCount.merge(t.getOwner(), 1, Integer::sum);
            if (priCount.containsKey(t.getPriority())) {
                priCount.merge(t.getPriority(), 1, Integer::sum);
            }
            if (catCount.containsKey(t.getCategory())) {
                catCount.merge(t.getCategory(), 1, Integer::sum);
            }
            if (t.getReqId() == null) {
                unassigned++;
            }
        }
        for (Map.Entry<String, Integer> e : ownerCount.entrySet()) {
            meta.getOwners().add(new BoardResponse.NameCount(e.getKey(), e.getValue()));
        }
        for (Map.Entry<String, Integer> e : priCount.entrySet()) {
            meta.getPris().add(new BoardResponse.NameCount(e.getKey(), e.getValue()));
        }
        for (Map.Entry<String, Integer> e : catCount.entrySet()) {
            meta.getCats().add(new BoardResponse.NameCount(e.getKey(), e.getValue()));
        }
        meta.setTags(tagMapper.selectAllWithCount(workspaceId));

        Map<String, Integer> reqCount = new LinkedHashMap<String, Integer>();
        for (Task t : all) {
            if (t.getReqId() != null) {
                reqCount.merge(t.getReqId(), 1, Integer::sum);
            }
        }
        for (Requirement r : reqMapper.selectAll(workspaceId)) {
            BoardResponse.ReqCount rc = new BoardResponse.ReqCount();
            rc.setId(r.getId());
            rc.setName(r.getName());
            rc.setStatus(r.getStatus());
            Integer count = reqCount.get(r.getId());
            rc.setCount(count == null ? 0 : count);
            meta.getReqs().add(rc);
        }
        meta.setUnassigned(unassigned);
        return meta;
    }

    private List<String> diffParts(String workspaceId, Task old, Task t, List<String> oldTags, List<String> newTags) {
        List<String> parts = new ArrayList<String>();
        if (!Objects.equals(old.getTitle(), t.getTitle())) {
            parts.add("标题");
        }
        if (!Objects.equals(old.getDescription(), t.getDescription())) {
            parts.add("描述");
        }
        if (!Objects.equals(old.getPriority(), t.getPriority())) {
            parts.add("优先级 " + old.getPriority() + "→" + t.getPriority());
        }
        if (!Objects.equals(old.getCategory(), t.getCategory())) {
            parts.add("分类 " + old.getCategory() + "→" + t.getCategory());
        }
        if (!Objects.equals(old.getOwner(), t.getOwner())) {
            parts.add("负责人 " + old.getOwner() + "→" + t.getOwner());
        }
        /* 列变化单独写 move 日志（见 update()），这里不重复。 */
        if (!Objects.equals(old.getStartDate(), t.getStartDate())) {
            parts.add("开始日期 " + fmtDate(old.getStartDate()) + "→" + fmtDate(t.getStartDate()));
        }
        if (!Objects.equals(old.getDueDate(), t.getDueDate())) {
            parts.add("截止日期 " + fmtDate(old.getDueDate()) + "→" + fmtDate(t.getDueDate()));
        }
        if (!Objects.equals(old.getReqId(), t.getReqId())) {
            parts.add("所属项目 " + reqName(workspaceId, old.getReqId()) + "→" + reqName(workspaceId, t.getReqId()));
        }
        if (!Objects.equals(old.getReqDocId(), t.getReqDocId())) {
            parts.add("关联需求变更");
        }
        if (!Objects.equals(old.getBranchId(), t.getBranchId())) {
            parts.add("所属分支变更");
        }
        if (!Objects.equals(old.getEstimateMinutes(), t.getEstimateMinutes())) {
            parts.add("预估耗时 " + (old.getEstimateMinutes() == null ? "无" : old.getEstimateMinutes() + " 分钟")
                    + "→" + (t.getEstimateMinutes() == null ? "无" : t.getEstimateMinutes() + " 分钟"));
        }
        if (!Objects.equals(old.getRecurType(), t.getRecurType())) {
            parts.add("循环 " + recurName(old.getRecurType()) + "→" + recurName(t.getRecurType()));
        }
        if (!Objects.equals(old.getRemindAt(), t.getRemindAt())) {
            parts.add("提醒时间 " + fmtTime(old.getRemindAt()) + "→" + fmtTime(t.getRemindAt()));
        }
        if (!Objects.equals(Boolean.TRUE.equals(old.getBlocked()), Boolean.TRUE.equals(t.getBlocked()))) {
            parts.add(Boolean.TRUE.equals(t.getBlocked())
                    ? ("标记为被阻塞" + (t.getBlockedReason() == null ? "" : "（" + Texts.cut(t.getBlockedReason(), 40) + "）"))
                    : "解除阻塞");
        } else if (Boolean.TRUE.equals(t.getBlocked()) && !Objects.equals(old.getBlockedReason(), t.getBlockedReason())) {
            parts.add("卡点原因变更");
        }
        if (!Objects.equals(old.getOwnerUserId(), t.getOwnerUserId()) && t.getOwnerUserId() != null) {
            parts.add("绑定负责人账号");
        }
        List<String> tags = new ArrayList<String>();
        if (newTags != null) {
            for (String tag : newTags) {
                String name = Texts.trimToNull(tag);
                if (name != null) {
                    name = name.replace(',', ' ').replace('，', ' ').trim();
                    if (!name.isEmpty()) {
                        name = Texts.cut(name, 16);
                        if (!tags.contains(name)) {
                            tags.add(name);
                        }
                    }
                }
            }
        }
        if (!new HashSet<String>(oldTags).equals(new HashSet<String>(tags))) {
            parts.add("标签 " + (oldTags.isEmpty() ? "无" : String.join("/", oldTags)) + "→" + (tags.isEmpty() ? "无" : String.join("/", tags)));
        }
        int oldProgress = old.getProgress() == null ? 0 : old.getProgress();
        int newProgress = t.getProgress() == null ? 0 : t.getProgress();
        if (oldProgress != newProgress) {
            parts.add("进度 " + oldProgress + "%→" + newProgress + "%");
        }
        if (!Objects.equals(old.getNote(), t.getNote())) {
            parts.add("进度备注");
        }
        return parts;
    }

    private String fmtDate(LocalDate date) {
        return date == null ? "无" : date.toString();
    }

    private String fmtTime(LocalDateTime time) {
        if (time == null) {
            return "无";
        }
        return time.toLocalDate() + " " + String.format("%02d:%02d", time.getHour(), time.getMinute());
    }

    private String recurName(String type) {
        if ("daily".equals(type)) {
            return "每天";
        }
        if ("weekly".equals(type)) {
            return "每周";
        }
        if ("monthly".equals(type)) {
            return "每月";
        }
        return "不循环";
    }

    private String reqName(String workspaceId, String reqId) {
        if (reqId == null) {
            return "无";
        }
        Requirement r = reqMapper.selectById(reqId);
        return r == null || !workspaceId.equals(r.getWorkspaceId()) ? "无" : r.getName();
    }

    private int priIndex(String pri) {
        for (int i = 0; i < PRIORITIES.length; i++) {
            if (PRIORITIES[i].equals(pri)) {
                return i;
            }
        }
        return 9;
    }

    private Map<String, Integer> columnIndexMap(String workspaceId) {
        Map<String, Integer> map = new LinkedHashMap<String, Integer>();
        int i = 0;
        for (BoardColumn c : boardColumnMapper.selectAll(workspaceId)) {
            map.put(c.getId(), i++);
        }
        map.put(Consts.COL_DONE, i);
        return map;
    }

    public String columnName(String workspaceId, String column) {
        if (Consts.COL_DONE.equals(column)) {
            return "已完成";
        }
        BoardColumn c = boardColumnMapper.selectById(workspaceId, column);
        return c == null ? column : c.getName();
    }

    private void log(String userId, String workspaceId, String taskId, String action, String detail) {
        log(userId, workspaceId, taskId, action, detail, null, null);
    }

    /**
     * 带列信息的日志：move 事件额外记下移动前后的列 id。
     * 流程体检靠这两个字段算「每列停留多久」「有没有往回退」——
     * 只靠 detail 里的列名，列一旦改名历史就断链了。
     */
    private void log(String userId, String workspaceId, String taskId, String action, String detail,
                     String fromColumn, String toColumn) {
        TaskLog taskLog = new TaskLog();
        taskLog.setTaskId(taskId);
        taskLog.setWorkspaceId(workspaceId);
        taskLog.setActorId(userId);
        taskLog.setAction(action);
        taskLog.setDetail(detail);
        taskLog.setFromColumn(fromColumn);
        taskLog.setToColumn(toColumn);
        logMapper.insert(taskLog);
    }
}
