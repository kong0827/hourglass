package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.common.Consts;
import com.hourglass.common.Texts;
import com.hourglass.common.WorkTime;
import com.hourglass.dto.PageResult;
import com.hourglass.entity.AppUser;
import com.hourglass.entity.Task;
import com.hourglass.entity.TaskLog;
import com.hourglass.entity.TimeLog;
import com.hourglass.entity.Workspace;
import com.hourglass.mapper.TaskLogMapper;
import com.hourglass.mapper.TaskMapper;
import com.hourglass.mapper.TimeLogMapper;
import com.hourglass.mapper.UserMapper;
import com.hourglass.mapper.WorkspaceMapper;
import com.hourglass.mapper.WorkspaceMemberMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
public class TimeLogService {

    /** 记录来源码值：计时器产生 / 手工补记 */
    private static final String ORIGIN_TIMER = "timer";
    private static final String ORIGIN_MANUAL = "manual";
    /** 手工补记单条上限：24 小时 */
    private static final int MANUAL_MAX_MINUTES = 24 * 60;

    private final TimeLogMapper timeLogMapper;
    private final TaskMapper taskMapper;
    private final TaskLogMapper logMapper;
    private final WorkspaceMapper workspaceMapper;
    private final UserMapper userMapper;
    private final WorkspaceMemberMapper memberMapper;
    private final ProjectAccessService projectAccess;
    private final TaskCompletionService completionService;
    private final TaskSupport support;

    public TimeLogService(TimeLogMapper timeLogMapper, TaskMapper taskMapper, TaskLogMapper logMapper,
                          WorkspaceMapper workspaceMapper, UserMapper userMapper,
                          WorkspaceMemberMapper memberMapper, ProjectAccessService projectAccess,
                          TaskCompletionService completionService, TaskSupport support) {
        this.timeLogMapper = timeLogMapper;
        this.taskMapper = taskMapper;
        this.logMapper = logMapper;
        this.workspaceMapper = workspaceMapper;
        this.userMapper = userMapper;
        this.memberMapper = memberMapper;
        this.projectAccess = projectAccess;
        this.completionService = completionService;
        this.support = support;
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
        /* 项目可见范围可能已被收回：不可见时只保留计时本身，不回传任务标题 */
        if (task != null && projectAccess.canView(r.getWorkspaceId(), userId, task.getReqId())) {
            res.put("taskTitle", task.getTitle());
        }
        Workspace ws = workspaceMapper.selectById(r.getWorkspaceId());
        if (ws != null) {
            res.put("workspaceName", ws.getName());
        }
        return res;
    }

    public Map<String, Object> status(String workspaceId, String taskId, String userId) {
        projectAccess.assertViewTask(workspaceId, userId, ensureTask(workspaceId, taskId));
        return statusOf(workspaceId, taskId, userId);
    }

    private Map<String, Object> statusOf(String workspaceId, String taskId, String userId) {
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
        projectAccess.assertWrite(workspaceId, userId, task.getReqId());
        // 同账号跨任务共用一把锁，避免跨设备同时开始产生多条运行记录
        userMapper.lockById(userId);
        if (timeLogMapper.selectRunningByTaskAndUser(taskId, userId) == null) {
            // 个人计时：开始新计时前自动停止"我自己"其他任务上运行中的计时
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
        projectAccess.assertWrite(workspaceId, userId, task.getReqId());
        if (!support.canTime(workspaceId, task.getBoardColumn())) {
            throw AppException.badRequest("当前列不计时，请先移到处理规则为「正常计时」的列");
        }
        if (Boolean.TRUE.equals(task.getBlocked())) {
            throw AppException.badRequest("任务处于阻塞状态，请先解除阻塞再开始计时");
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
        /* 只允许「进行中」列接力，且只接自己的任务：不能因停表把计时开到别人的任务上。 */
        if (!Consts.COL_DOING.equals(columnId) || !support.canTime(workspaceId, columnId)) {
            return null;
        }
        if (!timeLogMapper.selectRunningAllByUser(userId).isEmpty()) {
            return null;
        }
        AppUser me = userMapper.selectById(userId);
        String myName = me == null ? null : Texts.trimToNull(me.getDisplayName());
        for (Task t : taskMapper.selectColumnTasks(workspaceId, columnId)) {
            if (excludeTaskId != null && excludeTaskId.equals(t.getId())) {
                continue;
            }
            boolean mine = t.getOwnerUserId() != null
                    ? userId.equals(t.getOwnerUserId())
                    : (myName != null && myName.equals(t.getOwner()));
            /* 阻塞任务不开表：接力也不能把计时开到阻塞任务上 */
            if (mine && !Boolean.TRUE.equals(t.getBlocked())
                    && projectAccess.canWrite(workspaceId, userId, t.getReqId())) {
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
        Task task = ensureTask(workspaceId, taskId);
        userMapper.lockById(userId);
        TimeLog running = timeLogMapper.selectRunningByTaskAndUser(taskId, userId);
        if (running == null) {
            throw AppException.badRequest("当前没有正在进行的计时");
        }
        int wallMinutes = wallMinutes(running.getStartedAt());
        int minutes = effectiveMinutes(running.getStartedAt(), userId);
        timeLogMapper.closeRunning(taskId, userId, minutes);
        log(userId, workspaceId, taskId, "停止计时，本次计入 " + minutes + " 分钟" + capNote(wallMinutes, minutes));
        /* 手动停表也接力：停在可计时列时，继续接上同列下一个任务 */
        Task resumed = resumeInColumn(userId, workspaceId, task.getBoardColumn(), taskId);
        Map<String, Object> result = statusOf(workspaceId, taskId, userId);
        result.put("autoTimerTask", resumed == null ? null : resumed.getTitle());
        return result;
    }

    /**
     * 手工补记工时：项目可写者可补任何人（须为空间成员）。
     * 补记不经过「工作时段 / 8 小时上限」的计时裁剪——用户主动填多少就是多少（如加班、忘开表），
     * 只做范围校验（1 分钟 ~ 24 小时、日期不晚于今天）；日期落在当天仍会占用该用户的计时日额度。
     */
    @Transactional
    public Map<String, Object> addManual(String userId, String workspaceId, String taskId,
                                         String forUserId, LocalDate date, int minutes, String note) {
        Task task = ensureTask(workspaceId, taskId);
        projectAccess.assertWrite(workspaceId, userId, task.getReqId());
        String targetUserId = Texts.trimToNull(forUserId);
        if (targetUserId == null) {
            targetUserId = userId;
        }
        if (!userId.equals(targetUserId) && memberMapper.selectMember(workspaceId, targetUserId) == null) {
            throw AppException.badRequest("只能为空间成员补记工时");
        }
        if (date == null) {
            throw AppException.badRequest("请选择补记日期");
        }
        if (date.isAfter(LocalDate.now())) {
            throw AppException.badRequest("补记日期不能晚于今天");
        }
        if (minutes < 1 || minutes > MANUAL_MAX_MINUTES) {
            throw AppException.badRequest("单条补记范围 1 分钟 ~ 24 小时");
        }
        String noteText = Texts.cut(Texts.trimToNull(note), 200);
        LocalDateTime at = date.atTime(12, 0);
        TimeLog tl = new TimeLog();
        tl.setTaskId(taskId);
        tl.setWorkspaceId(workspaceId);
        tl.setUserId(targetUserId);
        tl.setStartedAt(at);
        tl.setEndedAt(at);
        tl.setMinutes(minutes);
        tl.setOrigin(ORIGIN_MANUAL);
        tl.setNote(noteText);
        timeLogMapper.insertCompleted(tl);
        log(userId, workspaceId, taskId, "补记工时：为「" + displayNameOf(targetUserId) + "」补记 "
                + minutes + " 分钟（" + date + "）" + (noteText == null ? "" : "，" + noteText));
        refreshCompletion(task);
        return status(workspaceId, taskId, userId);
    }

    /**
     * 作废一条已结束的工时记录（计时记录与手工补记都可作废）。
     *
     * <p>物理删除、时间线留痕：删掉后所有统计（任务累计、报表、每日额度、甘特负载等）
     * 都直接读 time_log，自动按实际工时重新计算；已完成任务的完成快照在这里同步重算。
     * 正在运行的计时不能作废，须先停止。权限与补记一致：项目可写者。
     */
    @Transactional
    public Map<String, Object> deleteRecord(String userId, String workspaceId, String taskId, Long logId) {
        TimeLog tl = timeLogMapper.selectById(logId);
        if (tl == null || !workspaceId.equals(tl.getWorkspaceId()) || !taskId.equals(tl.getTaskId())) {
            throw AppException.notFound("工时记录不存在：" + logId);
        }
        if (tl.getEndedAt() == null) {
            throw AppException.badRequest("正在计时的记录不能作废，请先停止计时");
        }
        Task task = ensureTask(workspaceId, tl.getTaskId());
        projectAccess.assertWrite(workspaceId, userId, task.getReqId());
        timeLogMapper.deleteById(logId, workspaceId);
        String who = displayNameOf(tl.getUserId());
        if (ORIGIN_MANUAL.equals(tl.getOrigin())) {
            String date = tl.getStartedAt() == null ? "" : tl.getStartedAt().toLocalDate().toString();
            log(userId, workspaceId, tl.getTaskId(), "删除补记工时：「" + who + "」的 "
                    + tl.getMinutes() + " 分钟（" + date + "）" + (tl.getNote() == null ? "" : "，" + tl.getNote()));
        } else {
            log(userId, workspaceId, tl.getTaskId(), "作废计时记录：「" + who + "」的 "
                    + tl.getMinutes() + " 分钟（" + rangeText(tl) + "）");
        }
        refreshCompletion(task);
        return status(workspaceId, tl.getTaskId(), userId);
    }

    /** 已完成任务的快照随实际工时重算（只动工时三列）；未完成任务没有快照，无需处理 */
    private void refreshCompletion(Task task) {
        if (task != null && task.getCompletedAt() != null) {
            completionService.refreshWork(task);
        }
    }

    /** 时间线文案用：2026-11-05 08:00 → 2026-11-06 18:00 */
    private static String rangeText(TimeLog tl) {
        return timeText(tl.getStartedAt()) + " → " + timeText(tl.getEndedAt());
    }

    private static String timeText(LocalDateTime t) {
        if (t == null) {
            return "";
        }
        return String.format("%04d-%02d-%02d %02d:%02d",
                t.getYear(), t.getMonthValue(), t.getDayOfMonth(), t.getHour(), t.getMinute());
    }

    /** 任务抽屉的工时记录列表：已结束的计时 + 手工补记，按时间倒序。 */
    public PageResult<Map<String, Object>> records(String workspaceId, String taskId, String userId,
                                                   int offset, int limit) {
        projectAccess.assertViewTask(workspaceId, userId, ensureTask(workspaceId, taskId));
        int safeOffset = Math.max(0, offset);
        int safeLimit = Math.max(1, Math.min(100, limit));
        int total = timeLogMapper.countRecordsByTask(workspaceId, taskId);
        List<TimeLog> rows = total <= safeOffset ? new ArrayList<TimeLog>()
                : timeLogMapper.selectRecordsByTask(workspaceId, taskId, safeOffset, safeLimit);
        java.util.Set<String> userIds = new java.util.LinkedHashSet<String>();
        for (TimeLog row : rows) {
            if (row.getUserId() != null) {
                userIds.add(row.getUserId());
            }
        }
        Map<String, AppUser> users = new LinkedHashMap<String, AppUser>();
        if (!userIds.isEmpty()) {
            for (AppUser user : userMapper.selectByIds(new ArrayList<String>(userIds))) {
                users.put(user.getId(), user);
            }
        }
        List<Map<String, Object>> out = new ArrayList<Map<String, Object>>();
        for (TimeLog tl : rows) {
            Map<String, Object> m = new LinkedHashMap<String, Object>();
            m.put("id", tl.getId());
            m.put("userId", tl.getUserId());
            m.put("userName", displayName(users.get(tl.getUserId()), tl.getUserId()));
            m.put("origin", ORIGIN_MANUAL.equals(tl.getOrigin()) ? ORIGIN_MANUAL : ORIGIN_TIMER);
            m.put("minutes", tl.getMinutes());
            m.put("date", tl.getStartedAt() == null ? null : tl.getStartedAt().toLocalDate().toString());
            m.put("startedAt", tl.getStartedAt() == null ? null : tl.getStartedAt().toString());
            m.put("endedAt", tl.getEndedAt() == null ? null : tl.getEndedAt().toString());
            m.put("note", tl.getNote());
            m.put("mine", userId.equals(tl.getUserId()));
            out.add(m);
        }
        return PageResult.of(out, total, safeOffset, safeLimit);
    }

    private static String displayName(AppUser user, String userId) {
        if (user == null) {
            return userId;
        }
        String displayName = Texts.trimToNull(user.getDisplayName());
        return displayName == null ? user.getUsername() : displayName;
    }

    private String displayNameOf(String uid) {
        AppUser u = uid == null ? null : userMapper.selectById(uid);
        if (u == null) {
            return uid;
        }
        String dn = Texts.trimToNull(u.getDisplayName());
        return dn == null ? u.getUsername() : dn;
    }

    /**
     * 关闭某个任务上**所有人**的运行中计时（任务完成 / 删除时由 TaskWorkflowService / TaskTrashService 调用）。
     * 口径与手动停表完全一致：跳过周末、每人每天封顶 8 小时。
     *
     * @param reason 写进时间线的说明，例如「任务已完成」
     * @return 关闭的条数
     */
    @Transactional
    public int closeRunningForTask(String workspaceId, String taskId, String actorId, String reason) {
        List<TimeLog> observed = timeLogMapper.selectRunningByTask(workspaceId, taskId);
        /* 与 start() 共用账号锁；按用户 ID 排序加锁，避免多人同时完成不同任务时死锁。
           锁后重读，覆盖“观察到之后、加锁之前”刚插入的运行记录。 */
        java.util.TreeSet<String> users = new java.util.TreeSet<String>();
        for (TimeLog running : observed) {
            if (Texts.trimToNull(running.getUserId()) != null) {
                users.add(running.getUserId());
            }
        }
        for (String userId : users) {
            userMapper.lockById(userId);
        }
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
