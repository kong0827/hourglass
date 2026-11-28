package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.common.Texts;
import com.hourglass.dto.MyDemandQuery;
import com.hourglass.entity.AppUser;
import com.hourglass.entity.Demand;
import com.hourglass.entity.ProjectMember;
import com.hourglass.entity.WorkspaceMember;
import com.hourglass.mapper.MyWorkMapper;
import com.hourglass.mapper.RequirementMapper;
import com.hourglass.mapper.UserMapper;
import com.hourglass.mapper.WorkspaceMemberMapper;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 多角色个人工作台：待我处理 / 我发起的 / 我关注的 / 团队。
 *
 * <p>工作项关系（负责、测试、关注）复用 TaskQueryService 的跨空间口径；
 * 需求关系（发起、评审、关注）限定当前空间，并复用项目可见范围。
 * 计数与列表使用同一 WHERE，避免「页签数字」和「加载行数」对不上。
 */
@Service
public class MyWorkService {

    private static final int MAX_PAGE_SIZE = 100;
    private static final DateTimeFormatter TIME_FORMAT = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");
    private static final String[] DEMAND_STATUSES = {"review", "pass", "plan", "done", "closed"};

    private final TaskQueryService taskQuery;
    private final MyWorkMapper myWorkMapper;
    private final ProjectAccessService projectAccess;
    private final WorkspaceMemberMapper memberMapper;
    private final UserMapper userMapper;
    private final ReleasePrepService releasePrep;
    private final RequirementMapper requirementMapper;

    public MyWorkService(TaskQueryService taskQuery, MyWorkMapper myWorkMapper,
                         ProjectAccessService projectAccess, WorkspaceMemberMapper memberMapper,
                         UserMapper userMapper, ReleasePrepService releasePrep,
                         RequirementMapper requirementMapper) {
        this.taskQuery = taskQuery;
        this.myWorkMapper = myWorkMapper;
        this.projectAccess = projectAccess;
        this.memberMapper = memberMapper;
        this.userMapper = userMapper;
        this.releasePrep = releasePrep;
        this.requirementMapper = requirementMapper;
    }

    /**
     * 页签计数：一次请求返回四项。
     *
     * <p>pending 是工作项并集（同一工作项既负责又测试只算一次）加待评审需求；
     * claimable 是旧口径里「无人认领、我能领取」的部分，只给次级入口提示，不进页签数字。
     */
    public Map<String, Object> counts(String workspaceId, String userId) {
        String displayName = displayName(userId);
        /* 工作项跨空间：与 /api/my-tasks 同一口径 */
        int pendingTasks = taskQuery.countMyWork(userId, displayName, "pending", false, true);
        int devCount = taskQuery.countMyWork(userId, displayName, "dev", false, true);
        int testCount = taskQuery.countMyWork(userId, displayName, "test", true, true);
        int claimableBase = taskQuery.countMyWork(userId, displayName, "test", false, true);
        int claimable = Math.max(0, claimableBase - testCount);
        int watchedTasks = taskQuery.countMyWork(userId, displayName, "watch", false, false);
        /* 我发起的工作项：跨空间，与 /api/my-tasks?view=created 同一口径 */
        int createdTasks = taskQuery.countMyWork(userId, displayName, "created", false, false);

        /* 需求限定当前空间 */
        MyDemandQuery created = demandQuery(workspaceId, userId, displayName, "created");
        int createdCount = myWorkMapper.countMyDemands(created);
        int createdNameOnly = 0;
        if (displayName != null) {
            MyDemandQuery nameOnly = demandQuery(workspaceId, userId, displayName, "created");
            nameOnly.setNameOnlyCount(true);
            createdNameOnly = myWorkMapper.countMyDemands(nameOnly);
        }
        int watchedDemands = myWorkMapper.countMyDemands(demandQuery(workspaceId, userId, displayName, "watch"));
        int watchedPlans = releasePrep.countMyWatchedPlans(workspaceId, userId);
        int reviewCount = myWorkMapper.countMyDemands(demandQuery(workspaceId, userId, displayName, "review"));

        /* 待我执行：测试计划执行人是我、未完成；只算当前空间 */
        int planCount = myWorkMapper.countMyTestPlans(workspaceId, userId);

        /* 未归档项目数（按可见范围）：前端据此把空空间的「新建工作项」换成「新建项目」 */
        int projectCount = requirementMapper.countActive(workspaceId,
                projectAccess.viewerScope(workspaceId, userId));

        Map<String, Object> pending = new LinkedHashMap<String, Object>();
        pending.put("tasks", pendingTasks);
        pending.put("dev", devCount);
        pending.put("test", testCount);
        pending.put("review", reviewCount);
        pending.put("plans", planCount);

        Map<String, Object> res = new LinkedHashMap<String, Object>();
        res.put("pending", pending);
        res.put("created", createdCount);
        res.put("createdTasks", createdTasks);
        res.put("watched", watchedTasks + watchedDemands + watchedPlans);
        res.put("watchedTasks", watchedTasks);
        res.put("watchedDemands", watchedDemands);
        res.put("watchedPlans", watchedPlans);
        res.put("claimable", claimable);
        res.put("projectCount", projectCount);
        res.put("reviewAvailable", reviewAvailable(workspaceId, userId));
        res.put("matchedByNameOnly", createdNameOnly);
        res.put("updatedAt", LocalDateTime.now().format(TIME_FORMAT));
        return res;
    }

    /** 待我执行：指派给我的测试计划分页（未完成、项目可见且未归档） */
    public Map<String, Object> testPlans(String workspaceId, String userId, int offset, int limit) {
        int safeOffset = Math.max(0, offset);
        int safeLimit = Math.max(1, Math.min(MAX_PAGE_SIZE, limit));
        int total = myWorkMapper.countMyTestPlans(workspaceId, userId);
        List<com.hourglass.dto.MyTestPlanRow> items = total <= safeOffset
                ? new ArrayList<com.hourglass.dto.MyTestPlanRow>()
                : myWorkMapper.selectMyTestPlans(workspaceId, userId, safeOffset, safeLimit);
        Map<String, Object> res = new LinkedHashMap<String, Object>();
        res.put("items", items);
        res.put("total", total);
        res.put("offset", safeOffset);
        res.put("limit", safeLimit);
        res.put("hasMore", safeOffset + items.size() < total);
        res.put("updatedAt", LocalDateTime.now().format(TIME_FORMAT));
        return res;
    }

    /** 需求队列分页：我发起的 / 我关注的 / 待我评审 */
    public Map<String, Object> demands(String workspaceId, String userId, MyDemandQuery query) {
        String view = Texts.trimToNull(query.getView());
        if (!"created".equals(view) && !"watch".equals(view) && !"review".equals(view)) {
            throw AppException.badRequest("请选择有效的个人需求视图");
        }
        String displayName = displayName(userId);
        query.setView(view);
        query.setWorkspaceId(workspaceId);
        query.setUserId(userId);
        query.setDisplayName(displayName);
        query.setStatus(normalizeStatus(query.getStatus()));
        query.setViewerId(projectAccess.viewerScope(workspaceId, userId));
        query.setOffset(Math.max(0, query.getOffset()));
        query.setLimit(Math.max(1, Math.min(MAX_PAGE_SIZE, query.getLimit())));

        int total = myWorkMapper.countMyDemands(query);
        List<Demand> items = total <= query.getOffset()
                ? new ArrayList<Demand>()
                : myWorkMapper.selectMyDemands(query);
        fillCreatorNames(items);

        int nameOnly = 0;
        if ("created".equals(view) && displayName != null) {
            MyDemandQuery nameOnlyQuery = copyOf(query);
            nameOnlyQuery.setNameOnlyCount(true);
            nameOnly = query.isNameOnlyCount() ? total : myWorkMapper.countMyDemands(nameOnlyQuery);
        }

        Map<String, Object> res = new LinkedHashMap<String, Object>();
        res.put("items", items);
        res.put("total", total);
        res.put("offset", query.getOffset());
        res.put("limit", query.getLimit());
        res.put("hasMore", query.getOffset() + items.size() < total);
        res.put("statusCounts", "created".equals(view) ? statusCounts(query) : null);
        res.put("matchedByNameOnly", nameOnly);
        res.put("updatedAt", LocalDateTime.now().format(TIME_FORMAT));
        return res;
    }

    /** 状态 chips：与列表同一 WHERE，只放开 status */
    private Map<String, Integer> statusCounts(MyDemandQuery query) {
        MyDemandQuery countsQuery = copyOf(query);
        countsQuery.setStatus(null);
        Map<String, Integer> counts = new LinkedHashMap<String, Integer>();
        for (String status : DEMAND_STATUSES) {
            counts.put(status, 0);
        }
        for (Map<String, Object> row : myWorkMapper.countMyDemandStatuses(countsQuery)) {
            Object status = row.get("status");
            Object cnt = row.get("cnt");
            if (status == null) {
                continue;
            }
            String key = String.valueOf(status);
            /* 存量旧状态归一：评审不通过 / 中途取消都归入已关闭 */
            if ("rej".equals(key) || "canceled".equals(key)) {
                key = "closed";
            }
            Integer prev = counts.get(key);
            if (prev != null) {
                counts.put(key, prev + (cnt == null ? 0 : ((Number) cnt).intValue()));
            }
        }
        int all = 0;
        for (String status : DEMAND_STATUSES) {
            all += counts.get(status);
        }
        counts.put("all", all);
        return counts;
    }

    /** 有等待评审的入口才显示分区：管理员，或至少有一个可写项目 */
    private boolean reviewAvailable(String workspaceId, String userId) {
        String role = projectAccess.roleOf(workspaceId, userId);
        if (ProjectAccessService.isPrivileged(role)) {
            return true;
        }
        if (role == null || ProjectAccessService.isViewer(role)) {
            return false;
        }
        WorkspaceMember member = memberMapper.selectMember(workspaceId, userId);
        if (member == null) {
            return false;
        }
        /* 非 assigned 模式默认参与所有项目（默认 write） */
        if (!ProjectAccessService.isAssigned(member)) {
            return true;
        }
        for (ProjectMember grant : projectAccess.grants(workspaceId)) {
            if (userId.equals(grant.getUserId()) && ProjectAccessService.ACCESS_WRITE.equals(grant.getAccess())) {
                return true;
            }
        }
        return false;
    }

    private MyDemandQuery demandQuery(String workspaceId, String userId, String displayName, String view) {
        MyDemandQuery q = new MyDemandQuery();
        q.setWorkspaceId(workspaceId);
        q.setUserId(userId);
        q.setDisplayName(displayName);
        q.setView(view);
        q.setViewerId(projectAccess.viewerScope(workspaceId, userId));
        return q;
    }

    private MyDemandQuery copyOf(MyDemandQuery src) {
        MyDemandQuery q = new MyDemandQuery();
        q.setWorkspaceId(src.getWorkspaceId());
        q.setUserId(src.getUserId());
        q.setDisplayName(src.getDisplayName());
        q.setView(src.getView());
        q.setStatus(src.getStatus());
        q.setQ(src.getQ());
        q.setPris(new ArrayList<String>(src.getPris()));
        q.setReqs(new ArrayList<String>(src.getReqs()));
        q.setSort(src.getSort());
        q.setOffset(src.getOffset());
        q.setLimit(src.getLimit());
        q.setViewerId(src.getViewerId());
        q.setNameOnlyCount(src.isNameOnlyCount());
        return q;
    }

    private String normalizeStatus(String status) {
        String s = Texts.trimToNull(status);
        if ("rej".equals(s) || "canceled".equals(s)) {
            return "closed";
        }
        if (s == null) {
            return null;
        }
        for (String known : DEMAND_STATUSES) {
            if (known.equals(s)) {
                return s;
            }
        }
        return null;
    }

    private String displayName(String userId) {
        AppUser me = userMapper.selectById(userId);
        return me == null ? null : Texts.trimToNull(me.getDisplayName());
    }

    /** 批量回填提交人显示名：created_by 可能是账号 ID，也可能是历史显示名 */
    private void fillCreatorNames(List<Demand> items) {
        if (items == null || items.isEmpty()) {
            return;
        }
        java.util.Set<String> ids = new java.util.LinkedHashSet<String>();
        for (Demand d : items) {
            if (Texts.trimToNull(d.getCreatedBy()) != null) {
                ids.add(d.getCreatedBy());
            }
            if (Texts.trimToNull(d.getReviewerUserId()) != null) {
                ids.add(d.getReviewerUserId());
            }
        }
        if (ids.isEmpty()) {
            return;
        }
        Map<String, String> names = new LinkedHashMap<String, String>();
        for (AppUser user : userMapper.selectByIds(new ArrayList<String>(ids))) {
            if (user != null && user.getId() != null) {
                names.put(user.getId(), user.getDisplayName());
            }
        }
        for (Demand d : items) {
            String name = names.get(d.getCreatedBy());
            d.setCreatedByName(name == null ? null : Texts.cut(name, 32));
            String reviewer = names.get(d.getReviewerUserId());
            d.setReviewerName(reviewer == null ? null : Texts.cut(reviewer, 32));
        }
    }
}
