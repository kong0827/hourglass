package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.common.Consts;
import com.hourglass.dto.TaskBlockedAt;
import com.hourglass.entity.DevBranch;
import com.hourglass.entity.Task;
import com.hourglass.entity.WorkspaceMember;
import com.hourglass.mapper.DemandMapper;
import com.hourglass.mapper.DevBranchMapper;
import com.hourglass.mapper.TaskLogMapper;
import com.hourglass.mapper.WorkspaceMemberMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 手机端团队只读视图。
 *
 * <p>团队概览用 {@link ManagerService#mobileTeamSnapshot} 一次加载任务与风险，负载复用
 * {@link ManagerService#workload}；本类只做权限校验、阻塞时长读取和面向手机端的字段收窄。</p>
 */
@Service
public class MobileService {

    private static final int RISK_LIMIT = 5;
    private static final LocalDate MIN_DATE = LocalDate.of(1900, 1, 1);
    private static final LocalDate MAX_DATE = LocalDate.of(2100, 12, 31);
    private static final String DEMAND_REVIEW = "review";
    private static final String TYPE_OVERDUE = "overdue";
    private static final String TYPE_BLOCKED = "blocked";

    private final DemandMapper demandMapper;
    private final DevBranchMapper branchMapper;
    private final WorkspaceMemberMapper memberMapper;
    private final TaskLogMapper taskLogMapper;
    private final ProjectAccessService projectAccess;
    private final ManagerService managerService;
    private final Clock clock;

    @Autowired
    public MobileService(DemandMapper demandMapper, DevBranchMapper branchMapper,
                         WorkspaceMemberMapper memberMapper, TaskLogMapper taskLogMapper,
                         ProjectAccessService projectAccess, ManagerService managerService) {
        this(demandMapper, branchMapper, memberMapper, taskLogMapper, projectAccess, managerService,
                Clock.systemDefaultZone());
    }

    MobileService(DemandMapper demandMapper, DevBranchMapper branchMapper, WorkspaceMemberMapper memberMapper,
                  TaskLogMapper taskLogMapper, ProjectAccessService projectAccess, ManagerService managerService,
                  Clock clock) {
        this.demandMapper = demandMapper;
        this.branchMapper = branchMapper;
        this.memberMapper = memberMapper;
        this.taskLogMapper = taskLogMapper;
        this.projectAccess = projectAccess;
        this.managerService = managerService;
        this.clock = clock;
    }

    public Map<String, Object> teamOverview(String workspaceId, String userId, String from, String to) {
        String role = requireMember(workspaceId, userId);
        LocalDate today = today();
        LocalDate toDate = parseDate(to, today);
        LocalDate fromDate = parseDate(from, toDate.minusDays(6));
        if (fromDate.isAfter(toDate)) {
            LocalDate swap = fromDate;
            fromDate = toDate;
            toDate = swap;
        }

        /* 一次快照同时拿任务与风险，避免同一次请求内重复 selectAll */
        Map<String, Object> snapshot = managerService.mobileTeamSnapshot(workspaceId, userId);
        List<Task> tasks = castTasks(snapshot.get("tasks"));
        Map<String, Object> rawRisks = castMap(snapshot.get("risks"));
        Map<String, String> memberNames = memberNames(workspaceId);
        Map<String, LocalDateTime> blockedSince = blockedSinceMap(workspaceId, rawRisks);

        PeriodStats current = periodStats(tasks, fromDate, toDate);
        long days = ChronoUnit.DAYS.between(fromDate, toDate) + 1;
        LocalDate prevTo = fromDate.minusDays(1);
        LocalDate prevFrom = prevTo.minusDays(days - 1);
        PeriodStats previous = periodStats(tasks, prevFrom, prevTo);

        int overdue = 0;
        int blocked = 0;
        for (Task task : tasks) {
            if (isDone(task)) {
                continue;
            }
            if (task.getDueDate() != null && task.getDueDate().isBefore(today)) {
                overdue++;
            }
            if (Boolean.TRUE.equals(task.getBlocked())) {
                blocked++;
            }
        }

        Map<String, Object> health = new LinkedHashMap<String, Object>();
        health.put("doneRate", round2(current.rate()));
        health.put("doneCount", current.done);
        health.put("planCount", current.plan);
        health.put("overdue", overdue);
        health.put("blocked", blocked);
        health.put("deltaWeek", round2(current.rate() - previous.rate()));
        health.put("from", fromDate);
        health.put("to", toDate);

        Map<String, Object> pending = new LinkedHashMap<String, Object>();
        pending.put("review", countDemandReview(workspaceId, userId));
        Map<String, Integer> branchPending = countBranchPending(workspaceId, userId);
        pending.put("accept", branchPending.get("testing"));
        pending.put("merge", branchPending.get("merging"));

        Map<String, Object> result = new LinkedHashMap<String, Object>();
        result.put("role", role);
        result.put("health", health);
        result.put("pending", pending);
        result.put("risks", mobileRisks(rawRisks, memberNames, null, blockedSince));
        return result;
    }

    /**
     * 手机端成员负载。
     *
     * <p>实际 = 区间内的计时，计划 = 每日上限 × 区间内工作日数——拿一周容量去比三十天的投入，
     * 负载率会假性爆表。前端团队视图显式传「本周 / 本月 / 近 30 天」的起止日期；
     * 不传时回落到「截至今天的最近 7 天」，与 {@link #teamOverview} 同口径。
     * 区间以服务端截断后的 {@code rangeFrom}/{@code rangeTo} 为准（上限 92 天），前端标签与数字同源。</p>
     */
    public Map<String, Object> workload(String workspaceId, String userId, String from, String to) {
        requireManager(workspaceId, userId);
        /* 缺省区间与 teamOverview 同口径：截至今天的最近 7 天，避免两个接口各自为政 */
        LocalDate toDate = parseDate(to, today());
        LocalDate fromDate = parseDate(from, toDate.minusDays(6));
        Map<String, Object> raw = managerService.workload(workspaceId, userId, fromDate, toDate);
        LocalDate rangeFrom = parseDate(text(raw.get("rangeFrom")), fromDate);
        LocalDate rangeTo = parseDate(text(raw.get("rangeTo")), toDate);
        int perDay = intValue(raw.get("capacityMinutesPerDay"));
        int rangeWorkdays = intValue(raw.get("rangeWorkdays"));
        int rangeCapacity = perDay > 0 ? perDay * rangeWorkdays : 0;

        Map<String, WorkspaceMember> membersById = new HashMap<String, WorkspaceMember>();
        Map<String, String> userIdsByName = new HashMap<String, String>();
        List<WorkspaceMember> workspaceMembers = memberMapper.selectByWorkspace(workspaceId);
        if (workspaceMembers != null) {
            for (WorkspaceMember member : workspaceMembers) {
                if (member == null || !hasText(member.getUserId())) {
                    continue;
                }
                membersById.put(member.getUserId(), member);
                if (hasText(member.getDisplayName())) {
                    userIdsByName.put(member.getDisplayName().trim(), member.getUserId());
                }
                if (hasText(member.getUsername())) {
                    userIdsByName.put(member.getUsername().trim(), member.getUserId());
                }
            }
        }

        /* 同一人的历史任务可能只有 owner 文本，按显示名归一，避免绑定/未绑定拆成两行 */
        Map<String, Map<String, Object>> merged = new LinkedHashMap<String, Map<String, Object>>();
        for (Map<String, Object> item : castList(raw.get("members"))) {
            String key = text(item.get("key"));
            String canonicalId = key;
            WorkspaceMember member = membersById.get(key);
            if (member == null && userIdsByName.containsKey(key)) {
                canonicalId = userIdsByName.get(key);
                member = membersById.get(canonicalId);
            }
            Map<String, Object> row = merged.get(canonicalId);
            if (row == null) {
                String display = member != null && hasText(member.getDisplayName())
                        ? member.getDisplayName()
                        : (member != null && hasText(member.getUsername())
                        ? member.getUsername() : text(item.get("name")));
                row = new LinkedHashMap<String, Object>();
                row.put("userId", canonicalId);
                row.put("name", display);
                row.put("role", member == null || member.getRole() == null ? "" : member.getRole());
                row.put("plannedMinutes", rangeCapacity > 0
                        ? rangeCapacity : intValue(item.get("capacityMinutes")));
                row.put("actualMinutes", 0);
                merged.put(canonicalId, row);
            }
            int actual = intValue(item.get("rangeMinutes"));
            row.put("actualMinutes", intValue(row.get("actualMinutes")) + actual);
        }

        List<Map<String, Object>> members = new ArrayList<Map<String, Object>>();
        for (Map<String, Object> row : merged.values()) {
            int planned = intValue(row.get("plannedMinutes"));
            int actual = intValue(row.get("actualMinutes"));
            double percent = planned <= 0 ? 0 : round2(actual / (double) planned);
            row.put("percent", percent);
            row.put("overload", percent > 1);
            members.add(row);
        }
        Map<String, Object> result = new LinkedHashMap<String, Object>();
        result.put("capacityMinutesPerDay", raw.get("capacityMinutesPerDay"));
        result.put("workdays", raw.get("workdays"));
        result.put("rangeFrom", rangeFrom.toString());
        result.put("rangeTo", rangeTo.toString());
        result.put("rangeWorkdays", rangeWorkdays);
        result.put("members", members);
        return result;
    }

    public Map<String, Object> risks(String workspaceId, String userId, String type) {
        requireManager(workspaceId, userId);
        Map<String, Object> result = new LinkedHashMap<String, Object>();
        Map<String, Object> raw = managerService.risks(workspaceId, userId);
        Map<String, String> names = memberNames(workspaceId);
        Map<String, LocalDateTime> blockedSince = TYPE_OVERDUE.equals(type)
                ? Collections.<String, LocalDateTime>emptyMap()
                : blockedSinceMap(workspaceId, raw);
        /* 逾期与阻塞共用去重集合：同一任务只出现在一个列表，total 也按同一口径统计 */
        Set<String> seen = new HashSet<String>();
        if (!TYPE_BLOCKED.equals(type)) {
            result.put("overdue", mobileRisks(raw, names, TYPE_OVERDUE, seen, blockedSince));
        } else {
            result.put("overdue", Collections.emptyList());
        }
        if (!TYPE_OVERDUE.equals(type)) {
            result.put("blocked", mobileRisks(raw, names, TYPE_BLOCKED, seen, blockedSince));
        } else {
            result.put("blocked", Collections.emptyList());
        }
        result.put("total", riskTotal(raw, type));
        return result;
    }

    private int riskTotal(Map<String, Object> raw, String type) {
        Set<String> ids = new HashSet<String>();
        if (!TYPE_BLOCKED.equals(type)) {
            for (Map<String, Object> item : castList(raw.get("overdue"))) {
                String id = text(item.get("id"));
                if (hasText(id)) {
                    ids.add(id);
                }
            }
        }
        if (!TYPE_OVERDUE.equals(type)) {
            for (Map<String, Object> item : castList(raw.get("blocked"))) {
                String id = text(item.get("id"));
                if (hasText(id)) {
                    ids.add(id);
                }
            }
        }
        return ids.size();
    }

    private List<Map<String, Object>> mobileRisks(Map<String, Object> raw,
                                                  Map<String, String> memberNames, String type,
                                                  Map<String, LocalDateTime> blockedSince) {
        return mobileRisks(raw, memberNames, type, new HashSet<String>(), blockedSince);
    }

    /** 取现有风险评估里的任务，转换为手机端字段；type 为空时两类混合并截断。 */
    private List<Map<String, Object>> mobileRisks(Map<String, Object> raw,
                                                  Map<String, String> memberNames, String type,
                                                  Set<String> seen, Map<String, LocalDateTime> blockedSince) {
        List<Map<String, Object>> overdue = castList(raw.get("overdue"));
        List<Map<String, Object>> blocked = castList(raw.get("blocked"));
        List<Map<String, Object>> out = new ArrayList<Map<String, Object>>();
        LocalDate today = today();

        if (!TYPE_BLOCKED.equals(type)) {
            int limit = TYPE_OVERDUE.equals(type) ? RISK_LIMIT : 3;
            for (Map<String, Object> item : overdue) {
                String taskId = text(item.get("id"));
                if (hasText(taskId) && !seen.add(taskId)) {
                    continue;
                }
                LocalDate due = dateValue(item.get("dueDate"));
                long days = due == null ? 0 : Math.max(0, ChronoUnit.DAYS.between(due, today));
                Map<String, Object> risk = riskItem(item, memberNames);
                risk.put("dayCount", days);
                risk.put("due", due);
                risk.put("priority", item.get("priority"));
                risk.put("level", days >= 3 ? "high" : "mid");
                risk.put("reason", "逾期 " + days + " 天");
                out.add(risk);
                if (out.size() >= limit) {
                    break;
                }
            }
        }
        if (!TYPE_OVERDUE.equals(type)) {
            for (Map<String, Object> item : blocked) {
                String taskId = text(item.get("id"));
                if (hasText(taskId) && !seen.add(taskId)) {
                    continue;
                }
                /* 只认日志里的「标记为被阻塞」；没有日志就不显示天数，不拿 updatedAt 冒充 */
                LocalDateTime since = blockedSince == null ? null : blockedSince.get(taskId);
                Long days = since == null ? null
                        : Math.max(0, ChronoUnit.DAYS.between(since.toLocalDate(), today));
                Map<String, Object> risk = riskItem(item, memberNames);
                risk.put("dayCount", days);
                risk.put("blockedSince", since);
                risk.put("reason", hasText(text(item.get("blockedReason")))
                        ? text(item.get("blockedReason")) : "被阻塞（未填原因）");
                risk.put("level", days != null && days >= 3 ? "high" : "mid");
                risk.put("lastNudgedAt", null);
                out.add(risk);
                if (out.size() >= RISK_LIMIT) {
                    break;
                }
            }
        }
        return out;
    }

    private Map<String, LocalDateTime> blockedSinceMap(String workspaceId, Map<String, Object> raw) {
        Set<String> ids = new HashSet<String>();
        for (Map<String, Object> item : castList(raw.get("blocked"))) {
            String id = text(item.get("id"));
            if (hasText(id)) {
                ids.add(id);
            }
        }
        Map<String, LocalDateTime> result = new HashMap<String, LocalDateTime>();
        if (ids.isEmpty()) {
            return result;
        }
        List<TaskBlockedAt> rows = taskLogMapper.selectLastBlockedAt(
                workspaceId, new ArrayList<String>(ids));
        if (rows != null) {
            for (TaskBlockedAt row : rows) {
                if (row != null && hasText(row.getTaskId()) && row.getBlockedAt() != null) {
                    result.put(row.getTaskId(), row.getBlockedAt());
                }
            }
        }
        return result;
    }

    private Map<String, Object> riskItem(Map<String, Object> task, Map<String, String> memberNames) {
        String ownerUserId = text(task.get("ownerUserId"));
        String ownerName = text(task.get("owner"));
        if (!hasText(ownerName) && hasText(ownerUserId)) {
            String name = memberNames.get(ownerUserId);
            ownerName = name == null ? "" : name;
        }
        Map<String, Object> item = new LinkedHashMap<String, Object>();
        item.put("taskId", task.get("id"));
        item.put("title", task.get("title"));
        item.put("ownerName", hasText(ownerName) ? ownerName : "未指派");
        return item;
    }

    private PeriodStats periodStats(List<Task> tasks, LocalDate from, LocalDate to) {
        Set<String> planIds = new HashSet<String>();
        int done = 0;
        for (Task task : tasks) {
            boolean completedInRange = task.getCompletedAt() != null
                    && !task.getCompletedAt().isBefore(from)
                    && !task.getCompletedAt().isAfter(to);
            boolean dueInRange = task.getDueDate() != null
                    && !task.getDueDate().isBefore(from)
                    && !task.getDueDate().isAfter(to);
            if (completedInRange || dueInRange) {
                planIds.add(task.getId());
            }
            if (completedInRange) {
                done++;
            }
        }
        return new PeriodStats(planIds.size(), done);
    }

    private int countDemandReview(String workspaceId, String userId) {
        return demandMapper.countByStatus(workspaceId, DEMAND_REVIEW,
                projectAccess.viewerScope(workspaceId, userId));
    }

    private Map<String, Integer> countBranchPending(String workspaceId, String userId) {
        int testing = 0;
        int merging = 0;
        Set<String> hidden = projectAccess.hiddenProjectIds(workspaceId, userId);
        List<DevBranch> branches = branchMapper.selectVisibleByWorkspace(
                workspaceId, projectAccess.viewerScope(workspaceId, userId), null);
        if (branches != null) {
            for (DevBranch branch : branches) {
                if (branch == null) {
                    continue;
                }
                /* 分支列表本身不按项目隐藏过滤，这里补一层，避免把隐藏项目的待办数量带出去 */
                if (branch.getReqId() != null && hidden.contains(branch.getReqId())) {
                    continue;
                }
                if (BranchService.ST_TESTING.equals(branch.getStatus())) {
                    testing++;
                }
                if (BranchService.ST_MERGING.equals(branch.getStatus())) {
                    merging++;
                }
            }
        }
        Map<String, Integer> result = new HashMap<String, Integer>();
        result.put("testing", testing);
        result.put("merging", merging);
        return result;
    }

    private Map<String, String> memberNames(String workspaceId) {
        Map<String, String> names = new HashMap<String, String>();
        List<WorkspaceMember> members = memberMapper.selectByWorkspace(workspaceId);
        if (members == null) {
            return names;
        }
        for (WorkspaceMember member : members) {
            if (member != null && member.getUserId() != null) {
                names.put(member.getUserId(), hasText(member.getDisplayName())
                        ? member.getDisplayName() : member.getUsername());
            }
        }
        return names;
    }

    private String requireMember(String workspaceId, String userId) {
        String role = projectAccess.roleOf(workspaceId, userId);
        if (role == null) {
            throw new AppException(4030, "当前角色无权查看该数据");
        }
        return role;
    }

    private void requireManager(String workspaceId, String userId) {
        String role = requireMember(workspaceId, userId);
        if (!ProjectAccessService.isPrivileged(role)) {
            throw new AppException(4030, "当前角色无权查看该数据");
        }
    }

    private LocalDate parseDate(String value, LocalDate fallback) {
        if (!hasText(value)) {
            return fallback;
        }
        LocalDate parsed;
        try {
            parsed = LocalDate.parse(value.trim());
        } catch (RuntimeException e) {
            throw AppException.badRequest("日期格式不合法：" + value);
        }
        if (parsed.isBefore(MIN_DATE) || parsed.isAfter(MAX_DATE)) {
            throw AppException.badRequest("日期超出支持范围（1900-01-01 至 2100-12-31）");
        }
        return parsed;
    }

    private boolean isDone(Task task) {
        return task != null && Consts.COL_DONE.equals(task.getBoardColumn());
    }

    private LocalDate today() {
        return LocalDate.now(clock);
    }

    private double round2(double value) {
        return Math.round(value * 100.0) / 100.0;
    }

    private int intValue(Object value) {
        return value instanceof Number ? Math.max(0, ((Number) value).intValue()) : 0;
    }

    private String text(Object value) {
        return value == null ? "" : String.valueOf(value);
    }

    private boolean hasText(String value) {
        return value != null && !value.trim().isEmpty();
    }

    private LocalDate dateValue(Object value) {
        return value instanceof LocalDate ? (LocalDate) value : null;
    }

    @SuppressWarnings("unchecked")
    private List<Task> castTasks(Object value) {
        return value instanceof List ? (List<Task>) value : Collections.<Task>emptyList();
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> castMap(Object value) {
        return value instanceof Map ? (Map<String, Object>) value : Collections.<String, Object>emptyMap();
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> castList(Object value) {
        return value instanceof List ? (List<Map<String, Object>>) value : Collections.<Map<String, Object>>emptyList();
    }

    private static class PeriodStats {
        private final int plan;
        private final int done;

        private PeriodStats(int plan, int done) {
            this.plan = plan;
            this.done = done;
        }

        private double rate() {
            return plan == 0 ? 0 : Math.min(1.0, done / (double) plan);
        }
    }
}
