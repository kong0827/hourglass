package com.devstudio.kanban.service;

import com.devstudio.kanban.common.AppException;
import com.devstudio.kanban.common.Consts;
import com.devstudio.kanban.common.Texts;
import com.devstudio.kanban.common.WorkTime;
import com.devstudio.kanban.entity.AppUser;
import com.devstudio.kanban.entity.Task;
import com.devstudio.kanban.entity.TaskLog;
import com.devstudio.kanban.entity.TimeLog;
import com.devstudio.kanban.entity.Workspace;
import com.devstudio.kanban.mapper.TaskLogMapper;
import com.devstudio.kanban.mapper.TaskMapper;
import com.devstudio.kanban.mapper.TimeLogMapper;
import com.devstudio.kanban.mapper.UserMapper;
import com.devstudio.kanban.mapper.WorkspaceMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
public class TimeLogService {

    private final TimeLogMapper timeLogMapper;
    private final TaskMapper taskMapper;
    private final TaskLogMapper logMapper;
    private final WorkspaceMapper workspaceMapper;
    private final UserMapper userMapper;

    public TimeLogService(TimeLogMapper timeLogMapper, TaskMapper taskMapper, TaskLogMapper logMapper,
                          WorkspaceMapper workspaceMapper, UserMapper userMapper) {
        this.timeLogMapper = timeLogMapper;
        this.taskMapper = taskMapper;
        this.logMapper = logMapper;
        this.workspaceMapper = workspaceMapper;
        this.userMapper = userMapper;
    }

    /**
     * 我当前正在计时的任务（**跨空间**）。个人同一时刻只计一个，所以最多一条。
     * 看板卡片靠它显示"计时中"并切换开始 / 停止按钮。
     */
    public Map<String, Object> myRunning(String userId) {
        Map<String, Object> res = new LinkedHashMap<String, Object>();
        List<TimeLog> running = timeLogMapper.selectRunningAllByUser(userId);
        TimeLog r = running.isEmpty() ? null : running.get(0);
        if (r == null) {
            res.put("running", false);
            return res;
        }
        res.put("running", true);
        res.put("taskId", r.getTaskId());
        res.put("workspaceId", r.getWorkspaceId());
        res.put("startedAt", r.getStartedAt().toString());
        res.put("elapsedMinutes", effectiveMinutes(r.getStartedAt(), userId));
        Task task = taskMapper.selectById(r.getTaskId());
        if (task != null) {
            res.put("taskTitle", task.getTitle());
        }
        Workspace ws = workspaceMapper.selectById(r.getWorkspaceId());
        if (ws != null) {
            res.put("workspaceName", ws.getName());
        }
        return res;
    }

    public Map<String, Object> status(String workspaceId, String taskId, String userId) {
        ensureTask(workspaceId, taskId);
        Map<String, Object> res = new LinkedHashMap<String, Object>();
        TimeLog running = timeLogMapper.selectRunningByTaskAndUser(taskId, userId);
        res.put("running", running != null);
        res.put("startedAt", running == null ? null : running.getStartedAt().toString());
        res.put("elapsedMinutes", running == null ? 0 : effectiveMinutes(running.getStartedAt(), userId));
        Integer total = timeLogMapper.sumByTaskId(workspaceId, taskId);
        res.put("totalMinutes", total == null ? 0 : total);
        Integer mine = timeLogMapper.sumByWorkspaceUser(workspaceId, userId);
        res.put("myTotalMinutes", mine == null ? 0 : mine);
        return res;
    }

    @Transactional
    public Map<String, Object> start(String userId, String workspaceId, String taskId) {
        Task task = ensureTask(workspaceId, taskId);
        if (timeLogMapper.selectRunningByTaskAndUser(taskId, userId) == null) {
            // 个人计时：开始新计时前自动停止"我自己"其他任务上运行中的计时
            // （无锁先查后插，同账号跨设备极端并发窗口见 api.md「已接受的现状口径」）
            for (TimeLog other : timeLogMapper.selectRunningAllByUser(userId)) {
                int wallMins = wallMinutes(other.getStartedAt());
                int mins = effectiveMinutes(other.getStartedAt(), userId);
                timeLogMapper.closeRunning(other.getTaskId(), userId, mins);
                // 旧任务在别的空间时只写"在另一空间开始新计时"：不把新任务标题泄露给该空间的读者
                String scope = other.getWorkspaceId().equals(workspaceId)
                        ? "（开始「" + task.getTitle() + "」的计时）"
                        : "（在另一个空间开始新计时）";
                log(userId, other.getWorkspaceId(), other.getTaskId(), "自动停止计时" + scope + "，本次计入 " + mins + " 分钟"
                        + capNote(wallMins, mins));
            }
            TimeLog t = new TimeLog();
            t.setTaskId(taskId);
            t.setWorkspaceId(workspaceId);
            t.setUserId(userId);
            t.setStartedAt(LocalDateTime.now());
            timeLogMapper.insert(t);
            log(userId, workspaceId, taskId, "开始计时");
        }
        return status(workspaceId, taskId, userId);
    }

    /**
     * 手动开始计时（前端点卡片 / 抽屉的按钮都走这里）：先校验任务所在的列。
     * 只有「待处理」「已完成」以外的任务能计时 —— 回退到待处理时**已记录的工时不删**，但不能再继续计。
     * （move 内部自动开表不经过这里：那时任务还没落库到新列，走校验会读到旧列。）
     */
    @Transactional
    public Map<String, Object> startManual(String userId, String workspaceId, String taskId) {
        Task task = ensureTask(workspaceId, taskId);
        if (Consts.COL_BACKLOG.equals(task.getBoardColumn()) || Consts.COL_DONE.equals(task.getBoardColumn())) {
            throw AppException.badRequest("只有「进行中」的任务才能计时，请先把任务移到进行中");
        }
        return start(userId, workspaceId, taskId);
    }

    /**
     * 计时接力：把正在计时的任务完成之后，「进行中」不该出现"这一列全都没在计时"的空档。
     * 只在我当前**没有任何**运行中的计时时才接力 —— 否则会把别的空间正在计的任务抢掉。
     *
     * @param columnId      刚完成的任务原来所在的列（待处理 / 已完成不接力）
     * @param excludeTaskId 刚完成的任务，不参与挑选
     * @return 接力开始的任务；没有可接力的返回 null
     */
    @Transactional
    public Task resumeInColumn(String userId, String workspaceId, String columnId, String excludeTaskId) {
        if (columnId == null || Consts.COL_BACKLOG.equals(columnId) || Consts.COL_DONE.equals(columnId)) {
            return null;
        }
        if (!timeLogMapper.selectRunningAllByUser(userId).isEmpty()) {
            return null;
        }
        /* 只接力“自己的任务”：共享空间里 A 完成自己的任务，不该自动把计时开到 B 的任务上 */
        AppUser me = userMapper.selectById(userId);
        String myName = me == null ? null : Texts.trimToNull(me.getDisplayName());
        /* 只查目标列（已按 sort_order,id 排序），第一条属于自己的就是接力目标 */
        for (Task t : taskMapper.selectColumnTasks(workspaceId, columnId)) {
            if (excludeTaskId != null && excludeTaskId.equals(t.getId())) {
                continue;
            }
            boolean mine = t.getOwnerUserId() != null
                    ? userId.equals(t.getOwnerUserId())
                    : (myName != null && myName.equals(t.getOwner()));
            if (mine) {
                start(userId, workspaceId, t.getId());
                return t;
            }
        }
        return null;
    }

    /** 列内顺序，空的排最后 */
    private int sortKey(Task t) {
        return t.getSortOrder() == null ? Integer.MAX_VALUE : t.getSortOrder();
    }

    @Transactional
    public Map<String, Object> stop(String userId, String workspaceId, String taskId) {
        ensureTask(workspaceId, taskId);
        TimeLog running = timeLogMapper.selectRunningByTaskAndUser(taskId, userId);
        if (running == null) {
            throw AppException.badRequest("当前没有正在进行的计时");
        }
        int wallMinutes = wallMinutes(running.getStartedAt());
        int minutes = effectiveMinutes(running.getStartedAt(), userId);
        timeLogMapper.closeRunning(taskId, userId, minutes);
        log(userId, workspaceId, taskId, "停止计时，本次计入 " + minutes + " 分钟" + capNote(wallMinutes, minutes));
        return status(workspaceId, taskId, userId);
    }

    /**
     * 关闭某个任务上**所有人**的运行中计时（任务完成 / 删除时由 TaskService 调用）。
     * 口径与手动停表完全一致：跳过周末、每人每天封顶 8 小时。
     *
     * @param reason 写进时间线的说明，例如「任务已完成」
     * @return 关闭的条数
     */
    @Transactional
    public int closeRunningForTask(String workspaceId, String taskId, String actorId, String reason) {
        int closed = 0;
        for (TimeLog running : timeLogMapper.selectRunningByTask(workspaceId, taskId)) {
            int wall = wallMinutes(running.getStartedAt());
            int eff = effectiveMinutes(running.getStartedAt(), running.getUserId());
            timeLogMapper.closeRunning(taskId, running.getUserId(), eff);
            log(actorId, workspaceId, taskId, "停止计时（" + reason + "），本次计入 " + eff + " 分钟" + capNote(wall, eff));
            closed++;
        }
        return closed;
    }

    /** 实际经过的分钟数（仅用于日志里说明"被裁剪了多少"） */
    private int wallMinutes(LocalDateTime start) {
        long minutes = ChronoUnit.MINUTES.between(start, LocalDateTime.now());
        return (int) Math.max(0, minutes);
    }

    private String capNote(int wall, int effective) {
        return wall > effective ? "（已按「工作时段 + 你的每天上限 + 跳过周末」裁剪，实际经过 " + wall + " 分钟）" : "";
    }

    /**
     * 一段计时的有效工时（分钟）—— 规则见 {@link WorkTime}：
     * 只计**该账号自己设定的工作时段**（默认 09:00–18:00）、跳过周末、
     * 每人每天封顶**该账号自己设定的上限**（默认 8 小时），并扣减当天已记录工时。
     */
    private int effectiveMinutes(LocalDateTime start, String userId) {
        int[] w = workHoursOf(userId);
        return WorkTime.effectiveMinutes(start, LocalDateTime.now(), w[0], w[1], w[2],
                day -> usedMinutesOn(userId, day));
    }

    /** 该账号的计时设置：[开始小时, 结束小时, 每天上限分钟]；没配置或越界时回落默认 9 / 18 / 8h */
    private int[] workHoursOf(String userId) {
        AppUser u = userId == null ? null : userMapper.selectById(userId);
        int sh = (u == null || u.getWorkStartHour() == null) ? WorkTime.DEFAULT_START_HOUR : u.getWorkStartHour();
        int eh = (u == null || u.getWorkEndHour() == null) ? WorkTime.DEFAULT_END_HOUR : u.getWorkEndHour();
        int mh = (u == null || u.getWorkMaxHours() == null) ? WorkTime.MAX_HOURS_PER_DAY : u.getWorkMaxHours();
        int nsh = WorkTime.normalizeStartHour(sh);
        return new int[]{ nsh, WorkTime.normalizeEndHour(eh, nsh), WorkTime.normalizeMaxHours(mh) * 60 };
    }

    private int usedMinutesOn(String userId, LocalDate day) {
        Integer v = timeLogMapper.sumMinutesByUserOnDate(userId, day);
        return v == null ? 0 : v;
    }

    private Task ensureTask(String workspaceId, String taskId) {
        Task t = taskMapper.selectById(taskId);
        if (t == null || !workspaceId.equals(t.getWorkspaceId()) || t.getDeletedAt() != null) {
            throw AppException.notFound("任务不存在：" + taskId);
        }
        return t;
    }

    private void log(String userId, String workspaceId, String taskId, String detail) {
        TaskLog taskLog = new TaskLog();
        taskLog.setTaskId(taskId);
        taskLog.setWorkspaceId(workspaceId);
        taskLog.setActorId(userId);
        taskLog.setAction("update");
        taskLog.setDetail(detail);
        logMapper.insert(taskLog);
    }
}
