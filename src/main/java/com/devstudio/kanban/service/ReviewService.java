package com.devstudio.kanban.service;

import com.devstudio.kanban.common.Consts;
import com.devstudio.kanban.common.TaskCalc;
import com.devstudio.kanban.dto.BoardResponse;
import com.devstudio.kanban.dto.ReviewResponse;
import com.devstudio.kanban.entity.AppUser;
import com.devstudio.kanban.entity.Task;
import com.devstudio.kanban.entity.TimeAgg;
import com.devstudio.kanban.entity.WorkspaceMember;
import com.devstudio.kanban.mapper.TaskLogMapper;
import com.devstudio.kanban.mapper.TaskMapper;
import com.devstudio.kanban.mapper.TimeLogMapper;
import com.devstudio.kanban.mapper.UserMapper;
import com.devstudio.kanban.mapper.WorkspaceMemberMapper;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

@Service
public class ReviewService {

    private final TaskMapper taskMapper;
    private final RequirementService requirementService;
    private final TimeLogMapper timeLogMapper;
    private final WorkspaceMemberMapper memberMapper;
    private final UserMapper userMapper;
    private final TaskLogMapper taskLogMapper;

    public ReviewService(TaskMapper taskMapper, RequirementService requirementService, TimeLogMapper timeLogMapper,
                         WorkspaceMemberMapper memberMapper, UserMapper userMapper, TaskLogMapper taskLogMapper) {
        this.taskMapper = taskMapper;
        this.requirementService = requirementService;
        this.timeLogMapper = timeLogMapper;
        this.memberMapper = memberMapper;
        this.userMapper = userMapper;
        this.taskLogMapper = taskLogMapper;
    }

    /** 兼容旧调用（不带用户时工作区工时的"我的"部分按 0 计） */
    public ReviewResponse review(String workspaceId, Integer weekOffset) {
        return review(workspaceId, null, weekOffset);
    }

    public ReviewResponse review(String workspaceId, String userId, Integer weekOffset) {
        LocalDate today = LocalDate.now();
        LocalDate monday = today.minusDays(today.getDayOfWeek().getValue() - 1);
        List<Task> all = taskMapper.selectAll(workspaceId);

        /* 只允许回看过去 52 周：正向偏移会翻到未来（永远是空周），无上限还会让 LocalDate 溢出 */
        int offset = weekOffset == null ? autoOffset(all, monday) : Math.max(-52, Math.min(0, weekOffset));
        LocalDate start = monday.plusWeeks(offset);
        LocalDate end = start.plusDays(6);

        ReviewResponse resp = new ReviewResponse();
        resp.setWeekOffset(offset);
        resp.setWeekStart(start.toString());
        resp.setWeekEnd(end.toString());
        resp.setLabel(offset == 0 ? "本周" : (offset == -1 ? "上周" : "该周期"));

        List<Task> completed = new ArrayList<Task>();
        for (Task t : all) {
            if (Consts.COL_DONE.equals(t.getBoardColumn()) && t.getCompletedAt() != null
                    && !t.getCompletedAt().isBefore(start) && !t.getCompletedAt().isAfter(end)) {
                completed.add(t);
            }
        }
        completed.sort(new Comparator<Task>() {
            @Override
            public int compare(Task a, Task b) {
                int byDate = b.getCompletedAt().compareTo(a.getCompletedAt());
                return byDate != 0 ? byDate : a.getId().compareTo(b.getId());
            }
        });
        resp.setCompleted(completed);

        int done = completed.size();
        int withDue = 0;
        int onTime = 0;
        Map<String, Integer> memberCount = new LinkedHashMap<String, Integer>();
        Map<String, Integer> catCount = new LinkedHashMap<String, Integer>();
        for (Task t : completed) {
            if (t.getDueDate() != null) {
                withDue++;
                if (!t.getCompletedAt().isAfter(t.getDueDate())) {
                    onTime++;
                }
            }
            memberCount.merge(t.getOwner(), 1, Integer::sum);
            catCount.merge(t.getCategory(), 1, Integer::sum);
        }
        ReviewResponse.Stats stats = new ReviewResponse.Stats();
        stats.setDone(done);
        stats.setWithDue(withDue);
        stats.setOnTime(onTime);
        // 口径：按期率分母=设置有截止日期的完成项；无截止日期的完成项不计入延期
        stats.setLate(withDue - onTime);
        stats.setOnTimeRate(withDue == 0 ? 0 : (int) Math.round(onTime * 100.0 / withDue));
        stats.setMembers(memberCount.size());
        resp.setStats(stats);

        /* N-5：成员贡献带上工时（按账号归属的 time_log 合计，映射到显示名） */
        Map<String, Integer> userMinutes = new HashMap<String, Integer>();
        for (TimeAgg a : timeLogMapper.sumByWorkspaceGroupByUser(workspaceId)) {
            if (a.getUserId() != null) {
                userMinutes.put(a.getUserId(), a.getTotalMinutes() == null ? 0 : a.getTotalMinutes());
            }
        }
        Map<String, Integer> nameMinutes = new HashMap<String, Integer>();
        for (WorkspaceMember m : memberMapper.selectByWorkspace(workspaceId)) {
            AppUser u = userMapper.selectById(m.getUserId());
            Integer mm = userMinutes.get(m.getUserId());
            if (u != null && mm != null) {
                Integer old = nameMinutes.get(u.getDisplayName());
                nameMinutes.put(u.getDisplayName(), (old == null ? 0 : old) + mm);
            }
        }
        List<ReviewResponse.MemberStat> memberStats = new ArrayList<ReviewResponse.MemberStat>();
        for (Map.Entry<String, Integer> e : memberCount.entrySet()) {
            ReviewResponse.MemberStat ms = new ReviewResponse.MemberStat();
            ms.setName(e.getKey());
            ms.setCount(e.getValue());
            Integer mm = nameMinutes.get(e.getKey());
            ms.setMinutes(mm == null ? 0 : mm);
            memberStats.add(ms);
        }
        resp.setMembers(memberStats);
        resp.setCatDist(toNameCounts(catCount));

        /* N-5：工时（本空间全员 / 我的 / 本周期全空间） */
        ReviewResponse.WorkMinutes wm = new ReviewResponse.WorkMinutes();
        Integer allTotal = timeLogMapper.sumByWorkspace(workspaceId);
        Integer weekAll = timeLogMapper.sumBetweenByWorkspace(workspaceId,
                start.atStartOfDay(), end.plusDays(1).atStartOfDay());
        wm.setSpace(allTotal == null ? 0 : allTotal);
        wm.setSpaceWeek(weekAll == null ? 0 : weekAll);
        if (userId != null) {
            Integer mine = timeLogMapper.sumByWorkspaceUser(workspaceId, userId);
            wm.setMine(mine == null ? 0 : mine);
        }
        resp.setWorkMinutes(wm);

        /* 第九轮审查 #5：成员退出空间（或被删号）后，其历史 time_log 仍留在
           "空间总工时"里，而成员贡献只按当前成员映射 —— 用户会看到"成员贡献合计
           小于空间总工时，且差额无从解释"。这里把无法归到在册成员的工时单独成行，
           让两个口径能对上（同一空间总工时口径：全部已结束的计时）。 */
        int listed = 0;
        for (ReviewResponse.MemberStat ms : memberStats) {
            listed += ms.getMinutes();
        }
        int orphan = wm.getSpace() - listed;
        if (orphan > 0) {
            ReviewResponse.MemberStat ms = new ReviewResponse.MemberStat();
            ms.setName("已离开成员 / 未在册");
            ms.setCount(0);
            ms.setMinutes(orphan);
            memberStats.add(ms);
        }

        /* O-10：进度 100% 但未入已完成列 → 单独成组，不静默漏统计 */
        List<Task> pendingDone = new ArrayList<Task>();
        for (Task t : all) {
            if (!Consts.COL_DONE.equals(t.getBoardColumn()) && TaskCalc.progressOf(t) >= 100) {
                pendingDone.add(t);
            }
        }
        resp.setPendingDone(pendingDone);

        /* 「进行中」= 已经开工、还没做完的任务 —— 按**所在列**判断（非「已完成」、非「待处理」）。
           原来按「0 < 进度 < 100」过滤，但很多人不会手动拖进度条，进行中的任务进度就是 0，
           于是整块是空的，看起来像"没有进行中的任务"。进度 100% 未归档的仍归 pendingDone，避免重复。 */
        List<Task> progressTasks = new ArrayList<Task>();
        for (Task t : all) {
            String col = t.getBoardColumn();
            if (Consts.COL_DONE.equals(col) || Consts.COL_BACKLOG.equals(col)) {
                continue;
            }
            if (TaskCalc.progressOf(t) >= 100) {
                continue;
            }
            progressTasks.add(t);
        }
        /* 排序：先按截止日期（没有截止的排后面），同一天的再按进度倒序 —— 「接下来该做什么」更直观 */
        progressTasks.sort(new Comparator<Task>() {
            @Override
            public int compare(Task a, Task b) {
                LocalDate da = a.getDueDate();
                LocalDate db = b.getDueDate();
                if (da == null && db != null) {
                    return 1;
                }
                if (da != null && db == null) {
                    return -1;
                }
                if (da != null && db != null) {
                    int byDate = da.compareTo(db);
                    if (byDate != 0) {
                        return byDate;
                    }
                }
                return Integer.compare(TaskCalc.progressOf(b), TaskCalc.progressOf(a));
            }
        });
        /* 历史周期要按"那一周确实碰过"来收窄，否则切到上周会把这一周才开工的任务也列进来
           （用户反馈的原症状）。没有状态快照，用 task_log 的活动记录近似：
             · 本周（offset == 0）：不收敛 —— 「进行中」就该是"我现在在做的事"；
             · 更早的周期：只保留「该周期内有日志活动」且「周期结束时已存在」的任务。 */
        if (offset < 0) {
            Set<String> activeIds = new HashSet<String>(taskLogMapper.selectActiveTaskIds(workspaceId, start, end));
            for (Iterator<Task> it = progressTasks.iterator(); it.hasNext(); ) {
                Task t = it.next();
                boolean existedBeforeWeekEnd = t.getCreatedAt() == null
                        || !t.getCreatedAt().toLocalDate().isAfter(end);
                if (!existedBeforeWeekEnd || !activeIds.contains(t.getId())) {
                    it.remove();
                }
            }
        }
        resp.setProgressTasks(progressTasks);

        resp.setReqDist(requirementService.list(workspaceId));
        resp.setCounts(TaskCalc.countDue(all, today));

        int openP0 = 0;
        int doing = 0;
        int backlog = 0;
        for (Task t : all) {
            if (Consts.COL_DONE.equals(t.getBoardColumn())) {
                continue;
            }
            if ("P0".equals(t.getPriority())) {
                openP0++;
            }
            if (Consts.COL_DOING.equals(t.getBoardColumn())) {
                doing++;
            } else if (Consts.COL_BACKLOG.equals(t.getBoardColumn())) {
                backlog++;
            }
        }
        resp.setOpenP0(openP0);
        resp.setDoing(doing);
        resp.setBacklog(backlog);
        return resp;
    }

    /** 未指定周时：从本周往前找最近一个有完成记录的周，都没有则返回上周 */
    private int autoOffset(List<Task> all, LocalDate monday) {
        for (int k = 0; k >= -12; k--) {
            LocalDate start = monday.plusWeeks(k);
            LocalDate end = start.plusDays(6);
            for (Task t : all) {
                if (Consts.COL_DONE.equals(t.getBoardColumn()) && t.getCompletedAt() != null
                        && !t.getCompletedAt().isBefore(start) && !t.getCompletedAt().isAfter(end)) {
                    return k;
                }
            }
        }
        return -1;
    }

    private List<BoardResponse.NameCount> toNameCounts(Map<String, Integer> map) {
        List<BoardResponse.NameCount> list = new ArrayList<BoardResponse.NameCount>();
        for (Map.Entry<String, Integer> e : map.entrySet()) {
            list.add(new BoardResponse.NameCount(e.getKey(), e.getValue()));
        }
        return list;
    }
}
