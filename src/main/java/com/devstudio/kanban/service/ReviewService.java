package com.devstudio.kanban.service;

import com.devstudio.kanban.dto.BoardResponse;
import com.devstudio.kanban.dto.ReviewCountRow;
import com.devstudio.kanban.dto.ReviewResponse;
import com.devstudio.kanban.dto.WorkSumRow;
import com.devstudio.kanban.entity.Task;
import com.devstudio.kanban.entity.TimeAgg;
import com.devstudio.kanban.entity.WorkspaceMember;
import com.devstudio.kanban.mapper.TaskMapper;
import com.devstudio.kanban.mapper.TimeLogMapper;
import com.devstudio.kanban.mapper.WorkspaceMemberMapper;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
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
    private final ProjectAccessService projectAccess;

    public ReviewService(TaskMapper taskMapper, RequirementService requirementService, TimeLogMapper timeLogMapper,
                         WorkspaceMemberMapper memberMapper, ProjectAccessService projectAccess) {
        this.taskMapper = taskMapper;
        this.requirementService = requirementService;
        this.timeLogMapper = timeLogMapper;
        this.memberMapper = memberMapper;
        this.projectAccess = projectAccess;
    }

    /** 成员显示名（成员查询已 JOIN 出 display_name，缺省回退登录名/ID） */
    private static String memberDisplayName(WorkspaceMember m) {
        String name = m.getDisplayName() == null ? null : m.getDisplayName().trim();
        if (name == null || name.isEmpty()) {
            name = m.getUsername() == null ? null : m.getUsername().trim();
        }
        return name == null || name.isEmpty() ? m.getUserId() : name;
    }

    /** 兼容旧调用（不带用户时工作区工时的"我的"部分按 0 计） */
    public ReviewResponse review(String workspaceId, Integer weekOffset) {
        return review(workspaceId, null, weekOffset);
    }

    public ReviewResponse review(String workspaceId, String userId, Integer weekOffset) {
        LocalDate today = LocalDate.now();
        LocalDate monday = today.minusDays(today.getDayOfWeek().getValue() - 1);
        String viewerId = projectAccess.viewerScope(workspaceId, userId);

        /* 只允许回看过去 52 周：正向偏移会翻到未来（永远是空周），无上限还会让 LocalDate 溢出 */
        int offset = weekOffset == null ? autoOffset(workspaceId, viewerId, monday)
                : Math.max(-52, Math.min(0, weekOffset));
        LocalDate start = monday.plusWeeks(offset);
        LocalDate end = start.plusDays(6);
        LocalDate before = end.plusDays(1);

        ReviewResponse resp = new ReviewResponse();
        resp.setWeekOffset(offset);
        resp.setWeekStart(start.toString());
        resp.setWeekEnd(end.toString());
        resp.setLabel(offset == 0 ? "本周" : (offset == -1 ? "上周" : "该周期"));

        /* 本周完成：一次查询取回列表，统计量由这份小结果集在内存里汇总 */
        List<Task> completed = taskMapper.selectCompletedBetween(workspaceId, viewerId, start, before);
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

        /* N-5：成员贡献以空间成员全集为准，工时只取本周期。
           原实现只遍历"本周完成过任务的人"，且工时取全量累计 —— 只计时没完成的在册成员
           会被误并进"已离开成员"，列表上的工时也不是本周值。 */
        List<WorkspaceMember> members = memberMapper.selectByWorkspace(workspaceId);
        Set<String> memberIds = new HashSet<String>();
        for (WorkspaceMember m : members) {
            if (m.getUserId() != null) {
                memberIds.add(m.getUserId());
            }
        }
        Map<String, Integer> weekUserMinutes = new HashMap<String, Integer>();
        int nonMemberMinutes = 0;
        for (TimeAgg a : timeLogMapper.sumBetweenByWorkspaceGroupByUser(workspaceId,
                start.atStartOfDay(), before.atStartOfDay(), viewerId)) {
            int mm = a.getTotalMinutes() == null ? 0 : a.getTotalMinutes();
            if (a.getUserId() != null && memberIds.contains(a.getUserId())) {
                Integer old = weekUserMinutes.get(a.getUserId());
                weekUserMinutes.put(a.getUserId(), (old == null ? 0 : old) + mm);
            } else {
                nonMemberMinutes += mm;
            }
        }
        Map<String, Integer> nameMinutes = new HashMap<String, Integer>();
        for (WorkspaceMember m : members) {
            Integer mm = weekUserMinutes.get(m.getUserId());
            if (mm != null) {
                String name = memberDisplayName(m);
                Integer old = nameMinutes.get(name);
                nameMinutes.put(name, (old == null ? 0 : old) + mm);
            }
        }
        Map<String, Integer> doneLeft = new LinkedHashMap<String, Integer>(memberCount);
        Set<String> seenNames = new HashSet<String>();
        List<ReviewResponse.MemberStat> memberStats = new ArrayList<ReviewResponse.MemberStat>();
        for (WorkspaceMember m : members) {
            String name = memberDisplayName(m);
            if (!seenNames.add(name)) {
                continue; // 同名成员合并成一行，避免出现两条一样的名字
            }
            ReviewResponse.MemberStat ms = new ReviewResponse.MemberStat();
            ms.setName(name);
            Integer c = doneLeft.remove(name);
            ms.setCount(c == null ? 0 : c);
            Integer mm = nameMinutes.get(name);
            ms.setMinutes(mm == null ? 0 : mm);
            memberStats.add(ms);
        }
        /* 负责人只存了文本（历史值 / 非成员）的任务：保留完成数，工时归不到账号 */
        for (Map.Entry<String, Integer> e : doneLeft.entrySet()) {
            ReviewResponse.MemberStat ms = new ReviewResponse.MemberStat();
            ms.setName(e.getKey());
            ms.setCount(e.getValue());
            ms.setMinutes(0);
            memberStats.add(ms);
        }
        resp.setMembers(memberStats);
        resp.setCatDist(toNameCounts(catCount));

        /* N-5：工时（本空间全员 / 我的 / 本周期全空间）一次聚合 */
        WorkSumRow work = timeLogMapper.sumWork(workspaceId, userId,
                start.atStartOfDay(), before.atStartOfDay(), viewerId);
        ReviewResponse.WorkMinutes wm = new ReviewResponse.WorkMinutes();
        if (work != null) {
            wm.setSpace(work.getTotalAll());
            wm.setSpaceWeek(work.getWeekAll());
            wm.setMine(work.getTotalMine());
            wm.setMineWeek(work.getWeekMine());
        }
        resp.setWorkMinutes(wm);

        /* 成员退出空间（或被删号）后，其工时仍留在空间总额里：本周期内无法归到在册成员的
           部分单独成行，让"成员贡献合计"与"本周全空间"能对上。 */
        if (nonMemberMinutes > 0) {
            ReviewResponse.MemberStat ms = new ReviewResponse.MemberStat();
            ms.setName("已离开成员 / 未在册");
            ms.setCount(0);
            ms.setMinutes(nonMemberMinutes);
            memberStats.add(ms);
        }

        /* O-10：进度 100% 但未入已完成列 → 单独成组，不静默漏统计 */
        resp.setPendingDone(taskMapper.selectPendingDone(workspaceId, viewerId));

        /* 「进行中」= 已经开工、还没做完的任务 —— 按所在列判断（非「已完成」、非「待处理」）。
           历史周期由 SQL 收敛到「该周期内有日志活动」且「周期结束时已存在」。 */
        resp.setProgressTasks(taskMapper.selectProgressTasks(workspaceId, viewerId, start, before, offset < 0));

        resp.setReqDist(requirementService.list(workspaceId, userId));

        /* 未完成任务的计数与到期分布：一次条件 SUM，替代对全部任务的三次遍历 */
        ReviewCountRow rc = taskMapper.countReviewStatus(workspaceId, viewerId, today);
        BoardResponse.Counts counts = new BoardResponse.Counts();
        if (rc != null) {
            counts.setOver(rc.getOver());
            counts.setToday(rc.getToday());
            counts.setSoon(rc.getSoon());
            resp.setOpenP0(rc.getOpenP0());
            resp.setDoing(rc.getDoing());
            resp.setBacklog(rc.getBacklog());
        }
        resp.setCounts(counts);
        return resp;
    }

    /** 未指定周时：从本周往前找最近一个有完成记录的周，都没有则返回上周 */
    private int autoOffset(String workspaceId, String viewerId, LocalDate monday) {
        LocalDate latest = taskMapper.selectLatestCompletedAt(workspaceId, viewerId);
        if (latest == null) {
            return -1;
        }
        LocalDate weekStart = latest.minusDays(latest.getDayOfWeek().getValue() - 1);
        int offset = (int) ChronoUnit.WEEKS.between(monday, weekStart);
        return Math.max(-12, Math.min(0, offset));
    }

    private List<BoardResponse.NameCount> toNameCounts(Map<String, Integer> map) {
        List<BoardResponse.NameCount> list = new ArrayList<BoardResponse.NameCount>();
        for (Map.Entry<String, Integer> e : map.entrySet()) {
            list.add(new BoardResponse.NameCount(e.getKey(), e.getValue()));
        }
        return list;
    }
}
