package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.common.Consts;
import com.hourglass.common.Ids;
import com.hourglass.common.Texts;
import com.hourglass.dto.TaskBulkMoveRequest;
import com.hourglass.dto.TaskMoveRequest;
import com.hourglass.dto.TaskReopenRequest;
import com.hourglass.entity.Subtask;
import com.hourglass.entity.Task;
import com.hourglass.mapper.SubtaskMapper;
import com.hourglass.mapper.TaskLogMapper;
import com.hourglass.mapper.TaskMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * BE-ARCH-1：任务流程（移动 / 批量移动 / 取消完成 / 循环任务 / 计时联动 / 完成归档）。
 *
 * <p>只看"任务在列之间怎么走"。查询在 {@link TaskQueryService}，新建与编辑在
 * {@link TaskCommandService}（编辑改列时会回调这里，保证移动语义只有一份）。
 */
@Service
public class TaskWorkflowService {

    /** 列内排序的稀疏步长：插入时取中值，只有间隔用完才整列重排 */
    private static final int SORT_STEP = 1024;

    private final TaskMapper taskMapper;
    private final TaskLogMapper logMapper;
    private final SubtaskMapper subtaskMapper;
    private final TaskSupport support;
    /** 计时口径（有效工时 / 关闭计时）统一收在 TimeLogService，这里只负责在移列时触发 */
    private final TimeLogService timeLogService;
    /** 任务完成快照（「任务清单」视图的数据源） */
    private final TaskCompletionService completionService;
    /** 审计日志与字段差异 */
    private final TaskAuditLogger audit;
    private final NotificationEventService notificationEvents;
    private final TaskWatchService watchService;
    private final ProjectAccessService projectAccess;
    /** 状态流转矩阵：所有会改列的入口统一在这里判定 */
    private final ColumnTransitionService transitions;
    private final WorkspaceService workspaceService;
    private final DeliveryScopeLock scopeLock;
    @org.springframework.beans.factory.annotation.Autowired
    private com.hourglass.mapper.VersionTaskMapper versionTaskMapper;
    @org.springframework.beans.factory.annotation.Autowired
    private TaskPublicationService publications;

    public TaskWorkflowService(TaskMapper taskMapper, TaskLogMapper logMapper, SubtaskMapper subtaskMapper,
                               TaskSupport support, TimeLogService timeLogService,
                               TaskCompletionService completionService, TaskAuditLogger audit,
                               NotificationEventService notificationEvents, TaskWatchService watchService,
                               ProjectAccessService projectAccess, ColumnTransitionService transitions,
                               WorkspaceService workspaceService, DeliveryScopeLock scopeLock) {
        this.scopeLock = scopeLock;
        this.taskMapper = taskMapper;
        this.logMapper = logMapper;
        this.subtaskMapper = subtaskMapper;
        this.support = support;
        this.timeLogService = timeLogService;
        this.completionService = completionService;
        this.audit = audit;
        this.notificationEvents = notificationEvents;
        this.watchService = watchService;
        this.projectAccess = projectAccess;
        this.transitions = transitions;
        this.workspaceService = workspaceService;
    }

    /** 强制移动只给空间主 / 管理员；非强制请求不查角色，避免每次移动多一次成员查询 */
    private boolean canForce(String userId, String workspaceId, boolean force) {
        if (!force) {
            return false;
        }
        return projectAccess.canManageForUpdate(workspaceId, userId);
    }

    /** 移动日志后缀：原因 + 强制标记 */
    private static String moveSuffix(ColumnTransitionService.Decision decision) {
        StringBuilder suffix = new StringBuilder();
        if (decision.getReason() != null) {
            suffix.append("，原因：").append(decision.getReason());
        }
        if (decision.isForced()) {
            suffix.append("（强制移动）");
        }
        return suffix.toString();
    }

    private String stopReasonForRule(String rule) {
        if ("waiting".equals(rule)) {
            return "进入等待列";
        }
        if ("ended".equals(rule)) {
            return "执行已结束";
        }
        return "移回待处理";
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
        return moveLocked(userId, workspaceId, id, req, lockActiveTask(workspaceId, id), true);
    }

    private Map<String, Object> moveLocked(String userId, String workspaceId, String id, TaskMoveRequest req, Task task,
                                           boolean returnTask) {
        projectAccess.assertViewTask(workspaceId, userId, task);
        projectAccess.assertWriteForUpdate(workspaceId, userId, task.getReqId());
        String from = task.getBoardColumn();
        String to = req.getColumn();
        support.validateColumn(workspaceId, to);
        boolean force = Boolean.TRUE.equals(req.getForce());
        ColumnTransitionService.Decision decision = transitions.check(workspaceId, from, to,
                req.getReason(), force, canForce(userId, workspaceId, force));

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
                if (!support.canTime(workspaceId, to)) {
                    /* 移入不可计时列（待处理 / 等待接续 / 执行结束）：保留已记录工时，停掉运行中计时 */
                    timeLogService.closeRunningForTask(workspaceId, id, userId, stopReasonForRule(support.processingRule(workspaceId, to)));
                } else {
                    /* 拖进「正常处理」列 = 开工，自动开始计时。
                       若本人已有别的任务在计时，start() 会先把它停掉 —— 个人同一时刻只计一个任务。
                       阻塞任务不开表；autoTimer=false 时跳过（"取消完成"这类回退操作不该顺手开表）。 */
                    boolean wantAuto = (req.getAutoTimer() == null || req.getAutoTimer())
                            && !Boolean.TRUE.equals(task.getBlocked());
                    if (wantAuto) {
                        Map<String, Object> work = timeLogService.start(userId, workspaceId, id);
                        autoTimerStarted = Boolean.TRUE.equals(work.get("running"));
                    }
                }
            }
        }
        target.add(position, task);
        if (sparse >= 0) {
            task.setSortOrder(sparse);
        } else {
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
        if (task.getUpdatedAt() != null) {
            task.setVersionCheck(Boolean.TRUE);
        }
        int updatedRows = taskMapper.update(task);
        if (Boolean.TRUE.equals(task.getVersionCheck()) && updatedRows == 0) {
            throw new com.hourglass.common.AppException(409, "任务已被其他人修改，请刷新后重试");
        }

        /* 「任务清单」归档：完成时落快照，取消完成时删掉（重复完成会重新生成） */
        if (!from.equals(to)) {
            if (Consts.COL_DONE.equals(to)) {
                completionService.archive(task);
            } else if (Consts.COL_DONE.equals(from)) {
                completionService.remove(workspaceId, id);
            }
        }

        String detail = from.equals(to)
                ? "「" + support.columnName(workspaceId, to) + "」列内顺序调整"
                : "从「" + support.columnName(workspaceId, from) + "」移动到「"
                        + support.columnName(workspaceId, to) + "」" + moveSuffix(decision);
        /* 列内排序（from==to）不算流程事件，不写 from/to，免得把"停留"切成碎段 */
        audit.log(userId, workspaceId, id, "move", detail,
                from.equals(to) ? null : from, from.equals(to) ? null : to);
        if (!from.equals(to)) {
            notifyColumnMove(workspaceId, userId, task, detail, true);
        }
        Map<String, Object> res = new LinkedHashMap<String, Object>();
        if (returnTask) {
            Task result = taskMapper.selectById(id);
            List<Task> batch = Collections.singletonList(result);
            versionTaskMapper.enrichTasks(workspaceId, batch);
            publications.enrichTasks(workspaceId, batch);
            res.put("task", result);
        }
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
        support.validateColumn(workspaceId, req.getColumn());
        List<String> taskIds = new ArrayList<String>();
        Set<String> seen = new HashSet<String>();
        for (String id : req.getIds()) {
            String taskId = Texts.trimToNull(id);
            if (taskId != null && seen.add(taskId)) {
                taskIds.add(taskId);
            }
        }
        // 全部项目先锁（helper 排序），再按任务 ID 锁，避免批量请求锁顺序相反。
        Collections.sort(taskIds);
        Map<String, Task> observed = new LinkedHashMap<String, Task>();
        List<String> projectIds = new ArrayList<String>();
        for (String taskId : taskIds) {
            Task task = support.require(workspaceId, taskId);
            observed.put(taskId, task);
            projectIds.add(task.getReqId());
        }
        scopeLock.lockProjects(workspaceId, projectIds.toArray(new String[0]));
        Map<String, Task> locked = new LinkedHashMap<String, Task>();
        for (String taskId : taskIds) {
            Task task = scopeLock.lockTask(workspaceId, taskId);
            assertSameProject(observed.get(taskId), task);
            locked.put(taskId, task);
        }
        /* 先整批校验再动库：任一项被禁止或缺原因，整批不产生变更，错误信息带任务标题 */
        boolean force = Boolean.TRUE.equals(req.getForce());
        boolean canForce = canForce(userId, workspaceId, force);
        for (String taskId : taskIds) {
            Task task = locked.get(taskId);
            projectAccess.assertViewTask(workspaceId, userId, task);
            projectAccess.assertWriteForUpdate(workspaceId, userId, task.getReqId());
            try {
                transitions.check(workspaceId, task.getBoardColumn(), req.getColumn(),
                        req.getReason(), force, canForce);
            } catch (AppException e) {
                throw new AppException(e.getCode(), "「" + task.getTitle() + "」" + e.getMessage());
            }
        }
        int moved = 0;
        for (String taskId : taskIds) {
            TaskMoveRequest one = new TaskMoveRequest();
            one.setColumn(req.getColumn());
            one.setAutoTimer(req.getAutoTimer() != null && req.getAutoTimer());
            one.setAutoResume(req.getAutoResume() != null && req.getAutoResume());
            one.setReason(req.getReason());
            one.setForce(req.getForce());
            moveLocked(userId, workspaceId, taskId, one, locked.get(taskId), false);
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
    public Map<String, Object> reopen(String userId, String workspaceId, String id, TaskReopenRequest body) {
        Task task = lockActiveTask(workspaceId, id);
        projectAccess.assertViewTask(workspaceId, userId, task);
        projectAccess.assertWriteForUpdate(workspaceId, userId, task.getReqId());
        if (!Consts.COL_DONE.equals(task.getBoardColumn())) {
            throw AppException.badRequest("任务不在已完成列，无需取消完成");
        }
        String target = logMapper.selectLastDoneFromColumn(workspaceId, id);
        if (target != null && (Consts.COL_DONE.equals(target) || !support.columnExists(workspaceId, target))) {
            target = null;
        }
        if (target == null) {
            target = support.columnExists(workspaceId, Consts.COL_DOING)
                    ? Consts.COL_DOING : support.firstOpenColumn(workspaceId);
        }
        TaskMoveRequest req = new TaskMoveRequest();
        req.setColumn(target);
        req.setAutoTimer(false);
        req.setAutoResume(false);
        if (body != null) {
            req.setReason(body.getReason());
            req.setForce(body.getForce());
        }
        return moveLocked(userId, workspaceId, id, req, task, true);
    }

    /**
     * 抽屉里编辑导致的改列：计时联动（完成停表+接力 / 进入可计时列开表 / 进入不可计时列停表）。
     * 由 {@link TaskCommandService#update} 在落库前调用，保持与拖拽 move 相同的计时口径。
     *
     * @param blocked 本次保存后的阻塞状态；阻塞任务不开表（与前端不显示计时入口一致）
     */
    @org.springframework.transaction.annotation.Transactional
    public String beforeEditColumnChange(String userId, String workspaceId, String id,
                                         String from, String to, String reason, boolean force,
                                         boolean blocked) {
        if (from == null || from.equals(to)) {
            return null;
        }
        Task task = lockActiveTask(workspaceId, id);
        projectAccess.assertViewTask(workspaceId, userId, task);
        projectAccess.assertWriteForUpdate(workspaceId, userId, task.getReqId());
        if (!from.equals(task.getBoardColumn())) {
            throw new AppException(409, "任务所在列已变化，请刷新后重试");
        }
        ColumnTransitionService.Decision decision = transitions.check(workspaceId, from, to,
                reason, force, canForce(userId, workspaceId, force));
        if (Consts.COL_DONE.equals(to)) {
            timeLogService.closeRunningForTask(workspaceId, id, userId, "任务已完成");
            /* 抽屉里改成已完成也接力：进行中不该出现"谁都没在计时"的空档 */
            timeLogService.resumeInColumn(userId, workspaceId, from, id);
        } else if (!support.canTime(workspaceId, to)) {
            /* 抽屉里改成不可计时列：工时保留，计时停掉 */
            timeLogService.closeRunningForTask(workspaceId, id, userId, stopReasonForRule(support.processingRule(workspaceId, to)));
        } else if (!blocked) {
            /* 改成「正常处理」列 = 开工，与看板拖拽 / 列表行内移动同一口径 */
            timeLogService.start(userId, workspaceId, id);
        }
        return moveSuffix(decision);
    }

    /**
     * 抽屉里编辑导致的改列：完成归档 / 取消完成撤档 / 循环派生 / 移动日志。
     * 顺序与拖拽 move 一致；标签由调用方先落库，循环任务才能继承保存后的标签。
     */
    @org.springframework.transaction.annotation.Transactional
    public void afterEditColumnChange(String userId, String workspaceId, Task task, String from,
                                      String moveSuffix) {
        if (from == null || from.equals(task.getBoardColumn())) {
            return;
        }
        boolean movedToDone = Consts.COL_DONE.equals(task.getBoardColumn());
        boolean leftDone = Consts.COL_DONE.equals(from);
        if (movedToDone) {
            completionService.archive(task);
        } else if (leftDone) {
            completionService.remove(workspaceId, task.getId());
        }
        if (movedToDone) {
            maybeGenerateNext(userId, workspaceId, task, from);
        }
        /* 抽屉里改列也是“移动”：流程体检只读 action=move 的日志，
           只记 update 会让这些移动在停留时长/返工率里凭空消失。 */
        String detail = "从「" + support.columnName(workspaceId, from) + "」移动到「"
                + support.columnName(workspaceId, task.getBoardColumn()) + "」"
                + (moveSuffix == null ? "" : moveSuffix);
        audit.log(userId, workspaceId, task.getId(), "move", detail, from, task.getBoardColumn());
        /* 拖拽是独立动作，负责人在此即时通知；抽屉改列由编辑入口合并成一条，这里只发关注者 */
        notifyColumnMove(workspaceId, userId, task, detail, false);
    }

    /**
     * 列流转通知：关注者走关注开关。负责人不是操作者时必有单独通知——
     * 拖拽路径（notifyOwner=true）在此发出；抽屉路径由 {@link TaskCommandService} 与字段变更合并为一条，
     * 这里只把负责人放进 skip，避免同一次保存发两条。
     */
    private void notifyColumnMove(String workspaceId, String actorId, Task task, String detail, boolean notifyOwner) {
        String owner = Texts.trimToNull(task.getOwnerUserId());
        boolean skipOwner = owner != null && !owner.equals(actorId);
        if (notifyOwner && skipOwner) {
            notificationEvents.notify(owner, workspaceId,
                    UserNotificationPreferenceService.TASK_UPDATED,
                    "任务更新：" + task.getTitle(), detail, task.getId(), task.getReqId());
        }
        watchService.notifyWatchers(workspaceId, task.getId(), actorId,
                UserNotificationPreferenceService.TASK_WATCH,
                "「" + task.getTitle() + "」已流转", detail, task.getReqId(),
                skipOwner ? Collections.singletonList(owner) : Collections.<String>emptyList());
    }

    private Task lockActiveTask(String workspaceId, String taskId) {
        Task observed = support.require(workspaceId, taskId);
        scopeLock.lockProjects(workspaceId, observed.getReqId());
        Task task = scopeLock.lockTask(workspaceId, taskId);
        assertSameProject(observed, task);
        return task;
    }

    private void assertSameProject(Task observed, Task task) {
        if (task.getDeletedAt() != null) {
            throw AppException.notFound("任务不存在");
        }
        if (!java.util.Objects.equals(observed.getReqId(), task.getReqId())) {
            throw new AppException(409, "任务所属项目已变化，请刷新后重试");
        }
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
                audit.log(userId, workspaceId, doneTask.getId(), "update", "重复完成：沿用已生成的下一次任务");
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
        String firstCol = support.firstOpenColumn(workspaceId);

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
        nt.setCategoryId(doneTask.getCategoryId());
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
            audit.log(userId, workspaceId, doneTask.getId(), "update", "检测到并发完成：沿用另一端已生成的下一次任务");
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
        support.saveTags(workspaceId, nt.getId(), support.tagNames(workspaceId, doneTask.getId()));

        audit.log(userId, workspaceId, nt.getId(), "create", "由循环任务生成「" + nt.getTitle() + "」（截止 " + next + "）");
        audit.log(userId, workspaceId, doneTask.getId(), "update", "完成后生成下次任务「" + nt.getTitle() + "」（截止 " + next + "）");
        return next.toString();
    }
}
