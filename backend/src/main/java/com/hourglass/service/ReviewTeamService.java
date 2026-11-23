package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.common.WorkTime;
import com.hourglass.dto.ReviewTeamAggRow;
import com.hourglass.dto.ReviewTeamCompletionRow;
import com.hourglass.dto.ReviewTeamDetailPage;
import com.hourglass.dto.ReviewTeamDetailRow;
import com.hourglass.dto.ReviewTeamDueRow;
import com.hourglass.dto.ReviewTeamPlanRow;
import com.hourglass.dto.ReviewTeamReleaseRow;
import com.hourglass.dto.ReviewTeamResponse;
import com.hourglass.entity.ProjectMemberRole;
import com.hourglass.entity.Requirement;
import com.hourglass.entity.Task;
import com.hourglass.entity.TimeAgg;
import com.hourglass.entity.WorkspaceMember;
import com.hourglass.mapper.ProjectMemberRoleMapper;
import com.hourglass.mapper.RequirementMapper;
import com.hourglass.mapper.ReviewTeamMapper;
import com.hourglass.mapper.TaskMapper;
import com.hourglass.mapper.TimeLogMapper;
import com.hourglass.mapper.WorkspaceMemberMapper;
import org.springframework.stereotype.Service;

import java.time.DayOfWeek;
import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 团队周回顾：把一周的需求 / 工作项 / 测试 / 文档事件与此刻快照拼成一张总览。
 *
 * <p>只读聚合，不改任何数据。行与行是不同对象，数量不可相加；
 * 完成节奏、在手、待回归、草稿积压、负载、逾期/阻塞是快照，不随周切换。</p>
 */
@Service
public class ReviewTeamService {

    private static final int DETAIL_LIMIT = 8;
    private static final int DETAIL_MAX_LIMIT = 50;
    private static final int DEFAULT_WORKDAYS = 5;
    private static final int MAX_WORKDAYS = 22;
    private static final int STALE_DAYS = 7;
    private static final int PERCENT = 100;
    private static final DateTimeFormatter DATE_TIME = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm");
    private static final DateTimeFormatter RANGE_FMT = DateTimeFormatter.ofPattern("MM-dd");
    private static final DateTimeFormatter AS_OF = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ssXXX");

    private final ReviewTeamMapper mapper;
    private final WorkspaceMemberMapper memberMapper;
    private final ProjectMemberRoleMapper roleMapper;
    private final RequirementMapper requirementMapper;
    private final TaskMapper taskMapper;
    private final TimeLogMapper timeLogMapper;
    private final ProjectAccessService projectAccess;

    public ReviewTeamService(ReviewTeamMapper mapper, WorkspaceMemberMapper memberMapper,
                             ProjectMemberRoleMapper roleMapper, RequirementMapper requirementMapper,
                             TaskMapper taskMapper, TimeLogMapper timeLogMapper,
                             ProjectAccessService projectAccess) {
        this.mapper = mapper;
        this.memberMapper = memberMapper;
        this.roleMapper = roleMapper;
        this.requirementMapper = requirementMapper;
        this.taskMapper = taskMapper;
        this.timeLogMapper = timeLogMapper;
        this.projectAccess = projectAccess;
    }

    /** 团队回顾仅空间主 / 管理员可见；个人回顾不走这里。 */
    public void requireTeam(String workspaceId, String userId) {
        if (!ProjectAccessService.isPrivileged(projectAccess.roleOf(workspaceId, userId))) {
            throw new AppException(403, "团队周回顾仅空间主或管理员可查看");
        }
    }

    public ReviewTeamResponse team(String workspaceId, String userId, String reqId,
                                   Integer weekOffset, String role) {
        requireTeam(workspaceId, userId);
        Range r = range(weekOffset);
        String scopeReq = normalizeReqId(reqId);
        String roleCode = normalizeRole(role);

        ReviewTeamResponse resp = new ReviewTeamResponse();
        resp.setScope("team");
        resp.setRole(roleCode);
        resp.setWeekOffset(r.offset);
        resp.setWeekStart(r.start.toString());
        resp.setWeekEnd(r.end.toString());
        resp.setLabel(r.label);
        resp.setAsOf(ZonedDateTime.now().format(AS_OF));
        fillProjectLabel(resp, workspaceId, scopeReq);

        Map<String, Integer> prevActions = counts(mapper.demandActionCounts(workspaceId, scopeReq, r.prevFrom, r.prevBefore));
        Map<String, Integer> prevCreatedTypes = counts(mapper.taskCreatedByType(workspaceId, scopeReq, r.prevFrom, r.prevBefore));
        Map<String, Integer> prevDoneTypes = counts(mapper.taskDoneByType(workspaceId, scopeReq, r.prevFrom, r.prevBefore));

        ReviewTeamResponse.Stats stats = resp.getStats();
        fillDemands(stats.getDemands(), workspaceId, scopeReq, r, prevActions);
        fillWork(stats.getWorkItems(), workspaceId, scopeReq, r, prevCreatedTypes, prevDoneTypes);
        fillTests(stats.getTests(), workspaceId, scopeReq, r);
        fillDocSummary(stats.getDocs(), workspaceId, scopeReq, r);

        List<WorkspaceMember> members = activeMembers(workspaceId);
        fillPace(resp.getPace(), workspaceId, scopeReq, r, members.size());
        fillTrend(resp.getTrend(), workspaceId, scopeReq, r);
        fillPool(resp.getPool(), workspaceId, scopeReq);
        fillReleases(resp.getReleases(), workspaceId, scopeReq, r);
        fillCompletions(resp.getCompletions(), workspaceId, scopeReq, r, stats.getWorkItems());
        fillQuality(resp.getQuality(), workspaceId, scopeReq, r, members);
        fillDocs(resp.getDocs(), workspaceId, scopeReq, r);
        List<MemberRowCtx> memberCtx = fillMembers(resp.getMembers(), workspaceId, scopeReq, r, members);
        fillProjects(resp.getProjects(), workspaceId, scopeReq, r);
        fillRisks(resp.getRisks(), workspaceId, scopeReq, r, resp.getMembers());
        fillIdle(resp);
        applyRoleFilter(resp, memberCtx, roleCode);
        return resp;
    }

    public ReviewTeamDetailPage detail(String workspaceId, String userId, String reqId,
                                       Integer weekOffset, String key, Integer limit) {
        requireTeam(workspaceId, userId);
        Range r = range(weekOffset);
        String scopeReq = normalizeReqId(reqId);
        int size = limit == null ? DETAIL_LIMIT : Math.max(1, Math.min(DETAIL_MAX_LIMIT, limit));

        ReviewTeamDetailPage page = new ReviewTeamDetailPage();
        page.setKey(key);
        page.setLimit(size);
        page.setTotal(total(workspaceId, scopeReq, r, key));
        page.setItems(toItems(rows(workspaceId, scopeReq, r, key, size)));
        return page;
    }

    /* ==================== 汇总 ==================== */

    private void fillDemands(ReviewTeamResponse.Demands d, String ws, String reqId, Range r,
                             Map<String, Integer> prevActions) {
        d.setCreated(mapper.countDemandCreated(ws, reqId, r.from, r.before));
        Map<String, Integer> actions = counts(mapper.demandActionCounts(ws, reqId, r.from, r.before));
        d.setPassed(get(actions, "pass"));
        d.setPlanned(get(actions, "plan"));
        d.setCompleted(get(actions, "complete"));
        d.setReleased(mapper.countReleaseDemands(ws, reqId, r.from, r.before));
        d.setReleaseCount(mapper.countReleases(ws, reqId, r.from, r.before));
        d.setClosed(mapper.countDemandClosed(ws, reqId, r.from, r.before));
        d.setCancelled(mapper.countDemandCancelled(ws, reqId, r.from, r.before));
        int prevCreated = mapper.countDemandCreated(ws, reqId, r.prevFrom, r.prevBefore);
        d.setCreatedDelta(d.getCreated() - prevCreated);
        d.setCompletedDelta(d.getCompleted() - get(prevActions, "complete"));
    }

    private void fillWork(ReviewTeamResponse.Work w, String ws, String reqId, Range r,
                          Map<String, Integer> prevCreatedTypes, Map<String, Integer> prevDoneTypes) {
        Map<String, Integer> createdTypes = counts(mapper.taskCreatedByType(ws, reqId, r.from, r.before));
        w.setCreated(sum(createdTypes));
        w.setStory(get(createdTypes, "story"));
        w.setTask(get(createdTypes, "task"));
        w.setBug(get(createdTypes, "bug"));
        w.setEpic(get(createdTypes, "epic"));
        w.setCreatedDelta(w.getCreated() - sum(prevCreatedTypes));

        Map<String, Integer> transitions = counts(mapper.transitionCounts(ws, reqId, r.from, r.before));
        w.setEnteredDoing(get(transitions, "doing"));
        w.setTestRequested(get(transitions, "test"));
        w.setEnteredTesting(get(transitions, "testing"));
        w.setTransitionEvents(w.getEnteredDoing() + w.getTestRequested() + w.getEnteredTesting());
        w.setTransitionItems(mapper.countTransitionItems(ws, reqId, r.from, r.before));

        Map<String, Integer> doneTypes = counts(mapper.taskDoneByType(ws, reqId, r.from, r.before));
        w.setCompleted(sum(doneTypes));
        w.setDoneStory(get(doneTypes, "story"));
        w.setDoneTask(get(doneTypes, "task"));
        w.setDoneBug(get(doneTypes, "bug"));
        w.setCompletedDelta(w.getCompleted() - sum(prevDoneTypes));
        w.setCancelled(mapper.countTaskCancelled(ws, reqId, r.from, r.before));
    }

    private void fillTests(ReviewTeamResponse.Tests t, String ws, String reqId, Range r) {
        t.setNewCases(mapper.countNewCases(ws, reqId, r.from, r.before));
        t.setNewDefects(mapper.countNewDefects(ws, reqId, r.from, r.before));
        Map<String, Integer> runs = counts(mapper.testRunCounts(ws, reqId, r.from, r.before));
        int passed = get(runs, "passed");
        int failed = get(runs, "failed");
        int blocked = get(runs, "blocked");
        int skipped = get(runs, "skipped");
        int total = passed + failed + blocked + skipped;
        t.setRuns(total);
        t.setPassed(passed);
        t.setFailed(failed);
        t.setBlocked(blocked);
        t.setSkipped(skipped);
        t.setPassRate(total == 0 ? 0 : (int) Math.round(passed * (double) PERCENT / total));
        t.setFixed(get(counts(mapper.taskDoneByType(ws, reqId, r.from, r.before)), "bug"));
        t.setPendingRetest(mapper.countPendingRetest(ws, reqId));
    }

    private void fillDocSummary(ReviewTeamResponse.DocSummary d, String ws, String reqId, Range r) {
        d.setCreated(mapper.countDocsCreated(ws, reqId, r.from, r.before));
        d.setUpdated(mapper.countDocUpdates(ws, reqId, r.from, r.before));
        d.setPublished(mapper.countDocsPublished(ws, reqId, r.from, r.before));
        d.setDraftBacklog(mapper.countDraftBacklog(ws, reqId, r.before));
    }

    private void fillPace(ReviewTeamResponse.Pace p, String ws, String reqId, Range r, int memberCount) {
        int[] daily = new int[7];
        for (ReviewTeamAggRow row : mapper.dailyCompleted(ws, reqId, r.from, r.before)) {
            LocalDate day = LocalDate.parse(row.getKey());
            if (!day.isBefore(r.start) && !day.isAfter(r.end)) {
                daily[day.getDayOfWeek().getValue() - 1] += n(row.getCount());
            }
        }
        List<Integer> days = new ArrayList<Integer>(7);
        for (int value : daily) {
            days.add(value);
        }
        p.setDaily(days);
        p.setStarted(mapper.countTransitionItems(ws, reqId, r.from, r.before));
        p.setMinutes(mapper.sumWeekMinutes(ws, reqId, r.from, r.before));
        int workdays = countWorkdays(r.start, r.end);
        int capacity = Math.max(1, memberCount) * workdays * WorkTime.MAX_MINUTES_PER_DAY;
        p.setCapacityMinutes(capacity);
        p.setUtilization(Math.min(999, (int) Math.round(p.getMinutes() * (double) PERCENT / capacity)));
        ReviewTeamAggRow timing = mapper.completionTiming(ws, reqId, r.from, r.before);
        int withDue = timing == null ? 0 : n(timing.getCount());
        int onTime = timing == null ? 0 : n(timing.getValue());
        p.setWithDue(withDue);
        p.setOnTime(onTime);
        p.setOnTimeRate(withDue == 0 ? 0 : (int) Math.round(onTime * (double) PERCENT / withDue));

        ReviewTeamDueRow due = mapper.dueOutcome(ws, reqId, r.start, r.end);
        int dueTotal = due == null ? 0 : n(due.getTotal());
        p.setDueTotal(dueTotal);
        p.setDueOnTime(due == null ? 0 : n(due.getOnTime()));
        p.setDueLate(due == null ? 0 : n(due.getLate()));
        p.setDueOpen(due == null ? 0 : n(due.getOpenCount()));
        p.setDueRate(dueTotal == 0 ? 0 : (int) Math.round(p.getDueOnTime() * (double) PERCENT / dueTotal));

        Map<String, Integer> plans = counts(mapper.testPlanStatusCounts(ws, reqId, r.start, r.end));
        int totalPlans = sum(plans);
        p.setTestPlanTotal(totalPlans);
        p.setTestPlanDone(get(plans, "done"));
    }

    /** 近 4 个周期同口径：工作项新增 / 完成 / 推进（按项去重），最后一位是当前查看周期。 */
    private void fillTrend(ReviewTeamResponse.Trend t, String ws, String reqId, Range current) {
        DateTimeFormatter label = DateTimeFormatter.ofPattern("MM-dd");
        for (int i = 3; i >= 0; i--) {
            /* 最早可选周（-52）向前不满 4 周时只返回已有周，避免 range() 钳位后重复同一周 */
            if (current.offset - i < -52) continue;
            Range w = range(current.offset - i);
            t.getLabels().add(w.start.format(label));
            t.getCreated().add(sum(counts(mapper.taskCreatedByType(ws, reqId, w.from, w.before))));
            t.getCompleted().add(sum(counts(mapper.taskDoneByType(ws, reqId, w.from, w.before))));
            t.getTransitions().add(mapper.countTransitionItems(ws, reqId, w.from, w.before));
        }
    }

    private void fillPool(ReviewTeamResponse.Pool pool, String ws, String reqId) {
        Map<String, Integer> demands = counts(mapper.demandsByStatus(ws, reqId));
        pool.setDemandReview(get(demands, "review"));
        pool.setDemandPass(get(demands, "pass"));
        pool.setDemandPlan(get(demands, "plan"));
        pool.setDemandDone(get(demands, "done"));
        Map<String, Integer> tasks = counts(mapper.tasksByColumn(ws, reqId));
        pool.setTaskBacklog(get(tasks, "backlog"));
        pool.setTaskDoing(get(tasks, "doing"));
        pool.setTaskTest(get(tasks, "test"));
        pool.setTaskTesting(get(tasks, "testing"));
        pool.setTaskOpen(sum(tasks));
    }

    private void fillReleases(ReviewTeamResponse.Releases rel, String ws, String reqId, Range r) {
        List<ReviewTeamPlanRow> plans = mapper.releasePlansInWeek(ws, reqId, r.from, r.before);
        rel.setPlanTotal(plans.size());
        int completed = 0;
        for (ReviewTeamPlanRow plan : plans) {
            if ("completed".equals(plan.getStatus())) {
                completed++;
            }
        }
        rel.setPlanCompleted(completed);
        rel.setPlanReadyOverdue(mapper.countReleaseOverdue(ws, reqId, LocalDateTime.now()));
        rel.setRolledBack(mapper.countRollbackReleases(ws, reqId, r.from, r.before));
        rel.setReleaseCount(mapper.countReleases(ws, reqId, r.from, r.before));
        rel.setDemandCount(mapper.countReleaseDemands(ws, reqId, r.from, r.before));
        for (ReviewTeamReleaseRow row : mapper.releasesInWeek(ws, reqId, r.from, r.before)) {
            ReviewTeamResponse.ReleaseItem item = new ReviewTeamResponse.ReleaseItem();
            item.setId(row.getId());
            item.setProjectName(row.getProjectName());
            item.setVersionName(row.getVersionName());
            item.setAt(dt(row.getAt()));
            item.setExecutor(row.getExecutor());
            item.setDemands(n(row.getDemands()));
            item.setTasks(n(row.getTasks()));
            item.setNote(row.getNote());
            rel.getItems().add(item);
        }
    }

    private void fillCompletions(ReviewTeamResponse.Completions c, String ws, String reqId, Range r,
                                 ReviewTeamResponse.Work work) {
        c.setTotal(work.getCompleted());
        c.setStory(work.getDoneStory());
        c.setTask(work.getDoneTask());
        c.setBug(work.getDoneBug());
        c.setReleased(mapper.countCompletedReleased(ws, reqId, r.from, r.before));
        int story = 0, task = 0, bug = 0;
        for (ReviewTeamCompletionRow row : mapper.completionRows(ws, reqId, r.from, r.before, 50)) {
            ReviewTeamResponse.CompletionItem item = new ReviewTeamResponse.CompletionItem();
            item.setTaskId(row.getTaskId());
            item.setTitle(row.getTitle());
            item.setType(row.getType());
            item.setTypeLabel(itemTypeLabel(row.getType()));
            item.setProjectName(row.getProjectName());
            item.setDemandTitle(row.getDemandTitle());
            item.setAt(dt(row.getAt()));
            item.setDueDate(row.getDueDate() == null ? null : row.getDueDate().toString());
            item.setMinutes(n(row.getMinutes()));
            item.setDurationDays(n(row.getDurationDays()));
            item.setOnTime(row.getOnTime() == null || row.getOnTime() == 1);
            item.setReleased(n(row.getReleased()) == 1);
            c.getItems().add(item);
            if ("story".equals(row.getType())) story++;
            else if ("bug".equals(row.getType())) bug++;
            else task++;
        }
        c.setMoreStory(Math.max(0, c.getStory() - story));
        c.setMoreTask(Math.max(0, c.getTask() - task));
        c.setMoreBug(Math.max(0, c.getBug() - bug));
    }

    private void fillQuality(ReviewTeamResponse.Quality q, String ws, String reqId, Range r,
                             List<WorkspaceMember> members) {
        ReviewTeamResponse.Tests tests = new ReviewTeamResponse.Tests();
        fillTests(tests, ws, reqId, r);
        q.setRuns(tests.getRuns());
        q.setPassRate(tests.getPassRate());
        q.setNewCases(tests.getNewCases());
        q.setDefects(tests.getNewDefects());
        q.setFixed(tests.getFixed());
        q.setPendingRetest(tests.getPendingRetest());
        q.setMinutes(mapper.sumTestMinutes(ws, reqId, r.from, r.before));
        q.setParticipants(mapper.countTestParticipants(ws, reqId, r.from, r.before));
        q.getResults().setPassed(tests.getPassed());
        q.getResults().setFailed(tests.getFailed());
        q.getResults().setBlocked(tests.getBlocked());
        q.getResults().setSkipped(tests.getSkipped());

        Map<String, Integer> runs = counts(mapper.testRunsByUser(ws, reqId, r.from, r.before));
        Map<String, Integer> passed = counts(mapper.testPassedByUser(ws, reqId, r.from, r.before));
        Map<String, Integer> cases = counts(mapper.newCasesByUser(ws, reqId, r.from, r.before));
        Map<String, Integer> defects = counts(mapper.defectsByUser(ws, reqId, r.from, r.before));
        Map<String, WorkspaceMember> byId = membersById(members);
        Map<String, MemberLabels> labels = memberLabels(ws, reqId, members);
        Set<String> ids = new LinkedHashSet<String>();
        ids.addAll(runs.keySet());
        ids.addAll(cases.keySet());
        ids.addAll(defects.keySet());
        for (String id : ids) {
            WorkspaceMember m = byId.get(id);
            ReviewTeamResponse.TestMember row = new ReviewTeamResponse.TestMember();
            row.setUserId(id);
            row.setName(m == null ? id : displayName(m));
            MemberLabels label = labels.get(id);
            row.setRoleCode(label == null ? "other" : label.code);
            row.setRoleTitle(label == null ? "成员" : label.title);
            row.setProjects(label == null ? "" : label.projects);
            int runCount = get(runs, id);
            row.setRuns(runCount);
            row.setPassRate(runCount == 0 ? 0 : (int) Math.round(get(passed, id) * (double) PERCENT / runCount));
            row.setNewCases(get(cases, id));
            row.setDefects(get(defects, id));
            q.getMembers().add(row);
        }
        Collections.sort(q.getMembers(), new Comparator<ReviewTeamResponse.TestMember>() {
            @Override
            public int compare(ReviewTeamResponse.TestMember a, ReviewTeamResponse.TestMember b) {
                return b.getRuns() - a.getRuns();
            }
        });

        for (ReviewTeamPlanRow plan : mapper.testPlansInWeek(ws, reqId, r.start, r.end)) {
            ReviewTeamResponse.TestPlanRow row = new ReviewTeamResponse.TestPlanRow();
            row.setId(plan.getId());
            row.setName(plan.getName());
            row.setStatus(plan.getStatus());
            int total = n(plan.getTotal());
            int passedCount = n(plan.getPassed());
            row.setTotal(total);
            row.setPassed(passedCount);
            row.setProgress(total == 0 ? 0 : (int) Math.round(passedCount * (double) PERCENT / total));
            row.setDue(plan.getPlannedEnd());
            row.setOverdueDays(overdueDays(plan.getPlannedEnd(), plan.getStatus()));
            q.getPlans().add(row);
        }

        ReviewTeamResponse.DefectPriority pri = q.getDefectsByPriority();
        pri.setClosed(tests.getFixed());
        for (ReviewTeamAggRow row : mapper.defectsByPriority(ws, reqId, r.from, r.before)) {
            int count = n(row.getCount());
            if ("P0".equals(row.getKey())) pri.setP0(count);
            else if ("P1".equals(row.getKey())) pri.setP1(count);
            else if ("P2".equals(row.getKey())) pri.setP2(count);
            else if ("P3".equals(row.getKey())) pri.setP3(count);
        }
    }

    private void fillDocs(ReviewTeamResponse.Docs d, String ws, String reqId, Range r) {
        d.setCreated(mapper.countDocsCreated(ws, reqId, r.from, r.before));
        d.setUpdated(mapper.countDocUpdates(ws, reqId, r.from, r.before));
        d.setPublished(mapper.countDocsPublished(ws, reqId, r.from, r.before));
        d.setDraftBacklog(mapper.countDraftBacklog(ws, reqId, r.before));
        LocalDateTime oldest = mapper.oldestDraft(ws, reqId, r.before);
        d.setOldestDraft(oldest == null ? null : oldest.toLocalDate().toString());

        Map<String, Integer> byType = counts(mapper.docsByType(ws, reqId, r.from, r.before));
        for (Map.Entry<String, Integer> entry : byType.entrySet()) {
            ReviewTeamResponse.CountRow row = new ReviewTeamResponse.CountRow();
            row.setKey(entry.getKey());
            row.setLabel(docTypeLabel(entry.getKey()));
            row.setCount(entry.getValue());
            d.getByType().add(row);
        }
        Collections.sort(d.getByType(), new Comparator<ReviewTeamResponse.CountRow>() {
            @Override
            public int compare(ReviewTeamResponse.CountRow a, ReviewTeamResponse.CountRow b) {
                return b.getCount() - a.getCount();
            }
        });

        Map<String, Integer> created = counts(mapper.docsCreatedByUser(ws, reqId, r.from, r.before));
        Map<String, Integer> updated = counts(mapper.docUpdatesByUser(ws, reqId, r.from, r.before));
        Map<String, WorkspaceMember> byId = membersById(activeMembers(ws));
        Map<String, MemberLabels> labels = memberLabels(ws, reqId, activeMembers(ws));
        Set<String> ids = new LinkedHashSet<String>();
        ids.addAll(created.keySet());
        ids.addAll(updated.keySet());
        for (String id : ids) {
            WorkspaceMember m = byId.get(id);
            ReviewTeamResponse.DocMember row = new ReviewTeamResponse.DocMember();
            row.setUserId(id);
            row.setName(m == null ? id : displayName(m));
            MemberLabels label = labels.get(id);
            row.setRoleCode(label == null ? "other" : label.code);
            row.setRoleTitle(label == null ? "成员" : label.title);
            row.setProjects(label == null ? "" : label.projects);
            row.setCreated(get(created, id));
            row.setUpdated(get(updated, id));
            row.setTotal(row.getCreated() + row.getUpdated());
            d.getMembers().add(row);
        }
        Collections.sort(d.getMembers(), new Comparator<ReviewTeamResponse.DocMember>() {
            @Override
            public int compare(ReviewTeamResponse.DocMember a, ReviewTeamResponse.DocMember b) {
                return b.getTotal() - a.getTotal();
            }
        });
        /* silent 在成员行汇总后补，见 applyRoleFilter 之前 */
    }

    /** 返回成员标签上下文，角色过滤时不再回查。 */
    private List<MemberRowCtx> fillMembers(List<ReviewTeamResponse.MemberRow> rows, String ws, String reqId,
                                           Range r, List<WorkspaceMember> members) {
        Map<String, Integer> created = counts(mapper.taskCreatedByActor(ws, reqId, r.from, r.before));
        Map<String, Integer> started = counts(mapper.taskStartedByOwner(ws, reqId, r.from, r.before));
        Map<String, Integer> done = counts(mapper.taskDoneByOwner(ws, reqId, r.from, r.before));
        Map<String, Integer> open = counts(mapper.taskOpenByOwner(ws, reqId));
        Map<String, Integer> minutes = counts(mapper.minutesByUser(ws, reqId, r.from, r.before));
        Map<String, Integer> overdue = counts(mapper.overdueByOwner(ws, reqId, LocalDate.now()));
        Map<String, Integer> blocked = counts(mapper.blockedByOwner(ws, reqId));
        Map<String, Integer> docsCreated = counts(mapper.docsCreatedByUser(ws, reqId, r.from, r.before));
        Map<String, Integer> docsUpdated = counts(mapper.docUpdatesByUser(ws, reqId, r.from, r.before));
        Map<String, Integer> testRuns = counts(mapper.testRunsByUser(ws, reqId, r.from, r.before));
        Map<String, Integer> testPassed = counts(mapper.testPassedByUser(ws, reqId, r.from, r.before));
        Map<String, Integer> cases = counts(mapper.newCasesByUser(ws, reqId, r.from, r.before));
        Map<String, Integer> defects = counts(mapper.defectsByUser(ws, reqId, r.from, r.before));
        Map<String, Integer> demandActions = counts(mapper.demandActionsByOperator(ws, reqId, r.from, r.before));
        Map<String, Integer> taskComments = counts(mapper.taskCommentsByAuthor(ws, reqId, r.from, r.before));
        Map<String, Integer> demandComments = counts(mapper.demandCommentsByAuthor(ws, reqId, r.from, r.before));
        Map<String, Integer> releases = counts(mapper.releaseExecutionsByUser(ws, reqId, r.from, r.before));
        Map<String, Integer> loads = loadPct(ws, reqId);
        Map<String, MemberLabels> labels = memberLabels(ws, reqId, members);

        List<MemberRowCtx> ctx = new ArrayList<MemberRowCtx>();
        for (WorkspaceMember m : members) {
            String id = m.getUserId();
            ReviewTeamResponse.MemberRow row = new ReviewTeamResponse.MemberRow();
            row.setUserId(id);
            row.setName(displayName(m));
            MemberLabels label = labels.get(id);
            row.setRoleCode(label == null ? "other" : label.code);
            row.setRoleTitle(label == null ? "成员" : label.title);
            row.setProjects(label == null ? "" : label.projects);
            row.setCreated(get(created, id));
            row.setStarted(get(started, id));
            row.setDone(get(done, id));
            row.setOpen(get(open, id));
            row.setMinutes(get(minutes, id));
            row.setLoad(get(loads, id));
            row.setOverdue(get(overdue, id));
            row.setBlocked(get(blocked, id));
            row.setDocs(get(docsCreated, id) + get(docsUpdated, id));
            boolean testParticipant = get(testRuns, id) > 0 || get(cases, id) > 0 || get(defects, id) > 0;
            row.setTestRuns(testParticipant ? get(testRuns, id) : -1);
            row.setTestDefects(testParticipant ? get(defects, id) : 0);
            int runCount = get(testRuns, id);
            row.setTestPassRate(runCount == 0 ? 0 : (int) Math.round(get(testPassed, id) * (double) PERCENT / runCount));
            row.setUnlogged(row.getMinutes() == 0 && (row.getDone() > 0 || row.getStarted() > 0));
            int activity = row.getCreated() + row.getStarted() + row.getDone() + row.getDocs()
                    + row.getMinutes() + get(testRuns, id) + get(cases, id) + get(defects, id)
                    + get(demandActions, id) + get(taskComments, id) + get(demandComments, id)
                    + get(releases, id);
            row.setIdle(activity == 0);

            MemberRowCtx c = new MemberRowCtx();
            c.row = row;
            c.testParticipant = testParticipant;
            ctx.add(c);
            rows.add(row);
        }
        Collections.sort(rows, new Comparator<ReviewTeamResponse.MemberRow>() {
            @Override
            public int compare(ReviewTeamResponse.MemberRow a, ReviewTeamResponse.MemberRow b) {
                if (a.getDone() != b.getDone()) return b.getDone() - a.getDone();
                if (a.getStarted() != b.getStarted()) return b.getStarted() - a.getStarted();
                return String.valueOf(a.getName()).compareTo(String.valueOf(b.getName()));
            }
        });
        return ctx;
    }

    private void fillProjects(List<ReviewTeamResponse.ProjectRow> rows, String ws, String reqId, Range r) {
        List<Requirement> projects = requirementMapper.selectAll(ws);
        Map<String, Requirement> byId = new HashMap<String, Requirement>();
        for (Requirement p : projects) {
            if (p.getArchivedAt() == null) {
                byId.put(p.getId(), p);
            }
        }
        Map<String, Integer> created = byProject(mapper.demandCreatedByProject(ws, r.from, r.before));
        Map<String, Integer> actions = new HashMap<String, Integer>();
        for (ReviewTeamAggRow row : mapper.demandActionsByProject(ws, r.from, r.before)) {
            if (!"pass".equals(row.getKey())) {
                continue;
            }
            actions.put(row.getProjectId(), n(row.getCount()));
        }
        Map<String, Integer> completed = new HashMap<String, Integer>();
        for (ReviewTeamAggRow row : mapper.demandActionsByProject(ws, r.from, r.before)) {
            if ("complete".equals(row.getKey())) {
                completed.put(row.getProjectId(), n(row.getCount()));
            }
        }
        Map<String, Integer> released = byProject(mapper.releasedDemandsByProject(ws, r.from, r.before));
        Map<String, Integer> tasksCreated = byProject(mapper.tasksCreatedByProject(ws, r.from, r.before));
        Map<String, Integer> tasksDone = byProject(mapper.tasksDoneByProject(ws, r.from, r.before));
        Map<String, Integer> minutes = byProject(mapper.minutesByProject(ws, r.from, r.before));
        Map<String, Integer> releaseOverdue = byProject(mapper.releaseOverdueByProject(ws, LocalDateTime.now()));
        Map<String, Integer> openDemands = byProject(mapper.demandOpenByProject(ws));

        for (Requirement p : projects) {
            if (p.getArchivedAt() != null) {
                continue;
            }
            if (reqId != null && !reqId.equals(p.getId())) {
                continue;
            }
            ReviewTeamResponse.ProjectRow row = new ReviewTeamResponse.ProjectRow();
            row.setReqId(p.getId());
            row.setName(p.getName());
            row.setDemandCreated(get(created, p.getId()));
            row.setDemandStarted(get(actions, p.getId()));
            row.setDemandCompleted(get(completed, p.getId()));
            row.setDemandReleased(get(released, p.getId()));
            row.setTaskCreated(get(tasksCreated, p.getId()));
            row.setTaskDone(get(tasksDone, p.getId()));
            row.setMinutes(get(minutes, p.getId()));
            if (get(releaseOverdue, p.getId()) > 0) {
                row.setStatusLabel("发布超期");
                row.setStatusTone("warn");
            } else if (row.getDemandReleased() > 0) {
                row.setStatusLabel("本周有发布");
                row.setStatusTone("ok");
            } else if (get(openDemands, p.getId()) > 0) {
                row.setStatusLabel(get(openDemands, p.getId()) + " 项未排期");
                row.setStatusTone("");
            } else {
                row.setStatusLabel("—");
                row.setStatusTone("");
            }
            boolean active = row.getDemandCreated() > 0 || row.getDemandStarted() > 0
                    || row.getDemandCompleted() > 0 || row.getDemandReleased() > 0
                    || row.getTaskCreated() > 0 || row.getTaskDone() > 0 || row.getMinutes() > 0;
            if (active || reqId != null) {
                rows.add(row);
            }
        }
        Collections.sort(rows, new Comparator<ReviewTeamResponse.ProjectRow>() {
            @Override
            public int compare(ReviewTeamResponse.ProjectRow a, ReviewTeamResponse.ProjectRow b) {
                if (a.getMinutes() != b.getMinutes()) return b.getMinutes() - a.getMinutes();
                return String.valueOf(a.getName()).compareTo(String.valueOf(b.getName()));
            }
        });
    }

    private void fillRisks(ReviewTeamResponse.Risks risk, String ws, String reqId, Range r,
                           List<ReviewTeamResponse.MemberRow> members) {
        LocalDate today = LocalDate.now();
        risk.setOverdue(mapper.countOverdueTasks(ws, reqId, today));
        risk.setBlocked(mapper.countBlockedTasks(ws, reqId));
        int overloaded = 0;
        String overloadSample = "";
        int unlogged = 0;
        String unloggedSample = "";
        for (ReviewTeamResponse.MemberRow row : members) {
            if (row.getLoad() > PERCENT) {
                overloaded++;
                if (overloadSample.isEmpty()) {
                    overloadSample = row.getName() + " " + row.getLoad() + "%";
                }
            }
            if (row.isUnlogged()) {
                unlogged++;
                if (unloggedSample.isEmpty()) {
                    unloggedSample = row.getName();
                }
            }
        }
        risk.setOverloaded(overloaded);
        risk.setOverloadSample(overloadSample);
        risk.setUnlogged(unlogged);
        risk.setUnloggedSample(unloggedSample);
        LocalDate nextFrom = r.start.plusWeeks(1);
        LocalDate nextTo = r.end.plusWeeks(1);
        risk.setNextLabel(today.isAfter(nextTo) ? "该周" : (today.isBefore(nextFrom) ? "下周" : "本周"));
        risk.setNextRange(nextFrom.format(RANGE_FMT) + " — " + nextTo.format(RANGE_FMT));
        risk.setNextDue(mapper.countTomorrowDue(ws, reqId, nextFrom, nextTo));
        risk.setNextMilestones(mapper.countNextMilestones(ws, reqId, nextFrom, nextTo));
        for (ReviewTeamDetailRow row : mapper.nextDueItems(ws, reqId, nextFrom, nextTo, 5)) {
            ReviewTeamResponse.DetailItem item = new ReviewTeamResponse.DetailItem();
            item.setKind("task");
            item.setId(row.getId());
            item.setType(row.getType());
            item.setTypeLabel(itemTypeLabel(row.getType()));
            item.setTitle(row.getTitle());
            item.setAt(row.getAt() == null ? null : row.getAt().toLocalDate().toString());
            String meta = row.getPerson() == null ? "" : row.getPerson();
            if (hasText(row.getProjectName())) {
                meta = meta.isEmpty() ? row.getProjectName() : meta + " · " + row.getProjectName();
            }
            if (hasText(row.getExtra())) {
                meta = meta.isEmpty() ? row.getExtra() : meta + " · " + row.getExtra();
            }
            item.setMeta(meta);
            risk.getNextItems().add(item);
        }
        risk.setP0(mapper.countP0Open(ws, reqId));
        risk.setPendingRelease(mapper.countPendingReleaseTasks(ws, reqId));
        risk.setReleaseOverdue(mapper.countReleaseOverdue(ws, reqId, LocalDateTime.now()));
        risk.setTestPlanOverdue(mapper.countTestPlanOverdue(ws, reqId, today));
        risk.setStale(mapper.countStale(ws, reqId, today.minusDays(STALE_DAYS)));

        List<ReviewTeamDetailRow> overdueRows = mapper.overdueSamples(ws, reqId, today, 1);
        if (!overdueRows.isEmpty()) {
            ReviewTeamDetailRow row = overdueRows.get(0);
            risk.setOverdueSample(row.getTitle() + " · " + (row.getExtra() == null ? "" : row.getExtra()));
        }
        List<ReviewTeamDetailRow> blockedRows = mapper.blockedSamples(ws, reqId, 1);
        if (!blockedRows.isEmpty()) {
            ReviewTeamDetailRow row = blockedRows.get(0);
            risk.setBlockedSample(row.getTitle() + " · " + (row.getExtra() == null ? "" : row.getExtra()));
        }
    }

    /** 无记录成员：沿用团队汇总口径，不随角色筛选重算；成员表只展示被筛到的人。 */
    private void fillIdle(ReviewTeamResponse resp) {
        int idle = 0;
        List<String> names = new ArrayList<String>();
        for (ReviewTeamResponse.MemberRow row : resp.getMembers()) {
            if (row.isIdle()) {
                idle++;
                if (names.size() < 2) {
                    names.add(row.getName());
                }
            }
        }
        resp.getRisks().setIdle(idle);
        if (!names.isEmpty()) {
            resp.getRisks().setIdleSample(String.join("、", names) + (idle > names.size() ? " 等" : ""));
        }
    }

    /* ==================== 角色过滤 ==================== */

    private void applyRoleFilter(ReviewTeamResponse resp, List<MemberRowCtx> memberCtx, String role) {
        /* silent：本周有完成 / 推进，但没有任何文档动作 */
        List<String> silent = new ArrayList<String>();
        for (MemberRowCtx c : memberCtx) {
            if ((c.row.getDone() > 0 || c.row.getStarted() > 0) && c.row.getDocs() == 0) {
                silent.add(c.row.getName());
            }
        }
        if (!"all".equals(role)) {
            List<ReviewTeamResponse.MemberRow> members = new ArrayList<ReviewTeamResponse.MemberRow>();
            for (ReviewTeamResponse.MemberRow row : resp.getMembers()) {
                if (role.equals(row.getRoleCode())) {
                    members.add(row);
                }
            }
            resp.setMembers(members);
            List<ReviewTeamResponse.TestMember> testRows = new ArrayList<ReviewTeamResponse.TestMember>();
            for (ReviewTeamResponse.TestMember row : resp.getQuality().getMembers()) {
                if (role.equals(row.getRoleCode())) {
                    testRows.add(row);
                }
            }
            resp.getQuality().setMembers(testRows);
            List<ReviewTeamResponse.DocMember> docRows = new ArrayList<ReviewTeamResponse.DocMember>();
            for (ReviewTeamResponse.DocMember row : resp.getDocs().getMembers()) {
                if (role.equals(row.getRoleCode())) {
                    docRows.add(row);
                }
            }
            resp.getDocs().setMembers(docRows);

            List<String> filtered = new ArrayList<String>();
            Set<String> allowed = new HashSet<String>();
            for (MemberRowCtx c : memberCtx) {
                if (role.equals(c.row.getRoleCode())) {
                    allowed.add(c.row.getName());
                }
            }
            for (String name : silent) {
                if (allowed.contains(name)) {
                    filtered.add(name);
                }
            }
            silent = filtered;
        }
        resp.getDocs().setSilent(silent);
    }

    /* ==================== 明细 ==================== */

    private int total(String ws, String reqId, Range r, String key) {
        if ("dem-created".equals(key)) return mapper.countDemandCreated(ws, reqId, r.from, r.before);
        if ("dem-passed".equals(key)) return get(counts(mapper.demandActionCounts(ws, reqId, r.from, r.before)), "pass");
        if ("dem-planned".equals(key)) return get(counts(mapper.demandActionCounts(ws, reqId, r.from, r.before)), "plan");
        if ("dem-completed".equals(key)) return get(counts(mapper.demandActionCounts(ws, reqId, r.from, r.before)), "complete");
        if ("dem-released".equals(key)) return mapper.countReleaseDemands(ws, reqId, r.from, r.before);
        if ("dem-closed".equals(key)) return mapper.countDemandClosed(ws, reqId, r.from, r.before);
        if ("dem-cancelled".equals(key)) return mapper.countDemandCancelled(ws, reqId, r.from, r.before);
        if ("wi-created".equals(key)) return sum(counts(mapper.taskCreatedByType(ws, reqId, r.from, r.before)));
        if ("wi-doing".equals(key)) return get(counts(mapper.transitionCounts(ws, reqId, r.from, r.before)), "doing");
        if ("wi-test".equals(key)) return get(counts(mapper.transitionCounts(ws, reqId, r.from, r.before)), "test");
        if ("wi-testing".equals(key)) return get(counts(mapper.transitionCounts(ws, reqId, r.from, r.before)), "testing");
        if ("wi-done".equals(key)) return sum(counts(mapper.taskDoneByType(ws, reqId, r.from, r.before)));
        if ("wi-cancelled".equals(key)) return mapper.countTaskCancelled(ws, reqId, r.from, r.before);
        if ("test-cases".equals(key)) return mapper.countNewCases(ws, reqId, r.from, r.before);
        if ("test-passed".equals(key)) return get(counts(mapper.testRunCounts(ws, reqId, r.from, r.before)), "passed");
        if ("test-failed".equals(key)) return get(counts(mapper.testRunCounts(ws, reqId, r.from, r.before)), "failed");
        if ("test-blocked".equals(key)) return get(counts(mapper.testRunCounts(ws, reqId, r.from, r.before)), "blocked");
        if ("test-skipped".equals(key)) return get(counts(mapper.testRunCounts(ws, reqId, r.from, r.before)), "skipped");
        if ("test-fixed".equals(key)) return get(counts(mapper.taskDoneByType(ws, reqId, r.from, r.before)), "bug");
        if ("test-retest".equals(key)) return mapper.countPendingRetest(ws, reqId);
        if ("doc-created".equals(key)) return mapper.countDocsCreated(ws, reqId, r.from, r.before);
        if ("doc-updated".equals(key)) return mapper.countDocUpdates(ws, reqId, r.from, r.before);
        if ("doc-published".equals(key)) return mapper.countDocsPublished(ws, reqId, r.from, r.before);
        if ("doc-draft".equals(key)) return mapper.countDraftBacklog(ws, reqId, r.before);
        if ("due-ontime".equals(key)) return dueOutcome(ws, reqId, r).getOnTime();
        if ("due-late".equals(key)) return dueOutcome(ws, reqId, r).getLate();
        if ("due-open".equals(key)) return dueOutcome(ws, reqId, r).getOpenCount();
        throw AppException.badRequest("未知的周回顾统计项：" + key);
    }

    private List<ReviewTeamDetailRow> rows(String ws, String reqId, Range r, String key, int limit) {
        if ("dem-created".equals(key)) return mapper.demandCreatedItems(ws, reqId, r.from, r.before, limit);
        if ("dem-passed".equals(key)) return mapper.demandLogItems(ws, reqId, r.from, r.before, "pass", limit);
        if ("dem-planned".equals(key)) return mapper.demandLogItems(ws, reqId, r.from, r.before, "plan", limit);
        if ("dem-completed".equals(key)) return mapper.demandLogItems(ws, reqId, r.from, r.before, "complete", limit);
        if ("dem-released".equals(key)) return mapper.demandReleasedItems(ws, reqId, r.from, r.before, limit);
        if ("dem-closed".equals(key)) return mapper.demandClosedItems(ws, reqId, r.from, r.before, limit);
        if ("dem-cancelled".equals(key)) return mapper.demandCancelledItems(ws, reqId, r.from, r.before, limit);
        if ("wi-created".equals(key)) return mapper.taskCreatedItems(ws, reqId, r.from, r.before, limit);
        if ("wi-doing".equals(key)) return mapper.taskTransitionItems(ws, reqId, r.from, r.before, "doing", limit);
        if ("wi-test".equals(key)) return mapper.taskTransitionItems(ws, reqId, r.from, r.before, "test", limit);
        if ("wi-testing".equals(key)) return mapper.taskTransitionItems(ws, reqId, r.from, r.before, "testing", limit);
        if ("wi-done".equals(key)) return mapper.taskCompletedItems(ws, reqId, r.from, r.before, null, limit);
        if ("wi-cancelled".equals(key)) return mapper.taskCancelledItems(ws, reqId, r.from, r.before, limit);
        if ("test-cases".equals(key)) return mapper.caseCreatedItems(ws, reqId, r.from, r.before, limit);
        if ("test-passed".equals(key)) return mapper.caseRunItems(ws, reqId, r.from, r.before, "passed", limit);
        if ("test-failed".equals(key)) return mapper.caseRunItems(ws, reqId, r.from, r.before, "failed", limit);
        if ("test-blocked".equals(key)) return mapper.caseRunItems(ws, reqId, r.from, r.before, "blocked", limit);
        if ("test-skipped".equals(key)) return mapper.caseRunItems(ws, reqId, r.from, r.before, "skipped", limit);
        if ("test-fixed".equals(key)) return mapper.taskCompletedItems(ws, reqId, r.from, r.before, "bug", limit);
        if ("test-retest".equals(key)) return mapper.pendingRetestItems(ws, reqId, limit);
        if ("doc-created".equals(key)) return mapper.docCreatedItems(ws, reqId, r.from, r.before, limit);
        if ("doc-updated".equals(key)) return mapper.docUpdatedItems(ws, reqId, r.from, r.before, limit);
        if ("doc-published".equals(key)) return mapper.docPublishedItems(ws, reqId, r.from, r.before, limit);
        if ("doc-draft".equals(key)) return mapper.draftItems(ws, reqId, r.before, limit);
        if ("due-ontime".equals(key)) return mapper.dueItems(ws, reqId, r.start, r.end, "ontime", limit);
        if ("due-late".equals(key)) return mapper.dueItems(ws, reqId, r.start, r.end, "late", limit);
        if ("due-open".equals(key)) return mapper.dueItems(ws, reqId, r.start, r.end, "open", limit);
        throw AppException.badRequest("未知的周回顾统计项：" + key);
    }

    private ReviewTeamDueRow dueOutcome(String ws, String reqId, Range r) {
        ReviewTeamDueRow row = mapper.dueOutcome(ws, reqId, r.start, r.end);
        if (row == null) {
            row = new ReviewTeamDueRow();
        }
        row.setTotal(n(row.getTotal()));
        row.setOnTime(n(row.getOnTime()));
        row.setLate(n(row.getLate()));
        row.setOpenCount(n(row.getOpenCount()));
        return row;
    }

    private List<ReviewTeamResponse.DetailItem> toItems(List<ReviewTeamDetailRow> rows) {
        List<ReviewTeamResponse.DetailItem> items = new ArrayList<ReviewTeamResponse.DetailItem>();
        for (ReviewTeamDetailRow row : rows) {
            ReviewTeamResponse.DetailItem item = new ReviewTeamResponse.DetailItem();
            item.setKind(row.getKind());
            item.setId(row.getId());
            item.setType(row.getType());
            item.setTypeLabel(typeLabel(row.getKind(), row.getType()));
            item.setTitle(row.getTitle());
            item.setAt(dt(row.getAt()));
            StringBuilder meta = new StringBuilder();
            if (row.getProjectName() != null && !row.getProjectName().isEmpty()) {
                meta.append(row.getProjectName());
            }
            if (row.getPerson() != null && !row.getPerson().isEmpty()) {
                if (meta.length() > 0) meta.append(" · ");
                meta.append(row.getPerson());
            }
            if (row.getExtra() != null && !row.getExtra().isEmpty()) {
                if (meta.length() > 0) meta.append(" · ");
                meta.append(row.getExtra());
            }
            item.setMeta(meta.toString());
            item.setTone(tone(row.getKind(), row.getType(), row.getExtra()));
            items.add(item);
        }
        return items;
    }

    /* ==================== 辅助 ==================== */

    private void fillProjectLabel(ReviewTeamResponse resp, String ws, String reqId) {
        resp.setReqId(reqId);
        if (reqId == null) {
            return;
        }
        for (Requirement p : requirementMapper.selectAll(ws)) {
            if (reqId.equals(p.getId())) {
                resp.setReqName(p.getName());
                return;
            }
        }
    }

    private List<WorkspaceMember> activeMembers(String ws) {
        List<WorkspaceMember> rows = new ArrayList<WorkspaceMember>();
        for (WorkspaceMember m : memberMapper.selectByWorkspace(ws)) {
            if (!ProjectAccessService.isViewer(m.getRole())) {
                rows.add(m);
            }
        }
        Collections.sort(rows, new Comparator<WorkspaceMember>() {
            @Override
            public int compare(WorkspaceMember a, WorkspaceMember b) {
                return String.valueOf(displayName(a)).compareTo(String.valueOf(displayName(b)));
            }
        });
        return rows;
    }

    private Map<String, WorkspaceMember> membersById(List<WorkspaceMember> members) {
        Map<String, WorkspaceMember> map = new HashMap<String, WorkspaceMember>();
        for (WorkspaceMember m : members) {
            map.put(m.getUserId(), m);
        }
        return map;
    }

    private Map<String, MemberLabels> memberLabels(String ws, String reqId, List<WorkspaceMember> members) {
        Map<String, List<ProjectMemberRole>> roles = new HashMap<String, List<ProjectMemberRole>>();
        for (ProjectMemberRole role : roleMapper.selectByWorkspace(ws)) {
            List<ProjectMemberRole> list = roles.get(role.getUserId());
            if (list == null) {
                list = new ArrayList<ProjectMemberRole>();
                roles.put(role.getUserId(), list);
            }
            list.add(role);
        }
        Map<String, String> projectNames = new HashMap<String, String>();
        for (Requirement p : requirementMapper.selectAll(ws)) {
            projectNames.put(p.getId(), p.getName());
        }
        Map<String, Set<String>> memberProjects = new HashMap<String, Set<String>>();
        for (Task task : taskMapper.selectAll(ws)) {
            if ("done".equals(task.getBoardColumn()) || "canceled".equals(task.getBoardColumn())) {
                continue;
            }
            if (reqId != null && !reqId.equals(task.getReqId())) {
                continue;
            }
            String uid = task.getOwnerUserId();
            if (uid == null) {
                continue;
            }
            Set<String> set = memberProjects.get(uid);
            if (set == null) {
                set = new LinkedHashSet<String>();
                memberProjects.put(uid, set);
            }
            if (task.getReqId() != null) {
                set.add(task.getReqId());
            }
        }

        Map<String, MemberLabels> map = new HashMap<String, MemberLabels>();
        for (WorkspaceMember m : members) {
            MemberLabels label = new MemberLabels();
            String title = null;
            List<ProjectMemberRole> rows = roles.get(m.getUserId());
            if (rows != null) {
                for (ProjectMemberRole row : rows) {
                    if (reqId != null && reqId.equals(row.getProjectId()) && hasText(row.getRoleTitle())) {
                        title = row.getRoleTitle();
                        break;
                    }
                }
                if (title == null) {
                    for (ProjectMemberRole row : rows) {
                        if (hasText(row.getRoleTitle())) {
                            title = row.getRoleTitle();
                            break;
                        }
                    }
                }
            }
            if (title == null) {
                title = hasText(m.getJobTitle()) ? m.getJobTitle() : "成员";
            }
            label.title = title;
            label.code = roleCode(title);
            Set<String> ids = new LinkedHashSet<String>();
            if (rows != null) {
                for (ProjectMemberRole row : rows) {
                    if (reqId == null || reqId.equals(row.getProjectId())) {
                        ids.add(row.getProjectId());
                    }
                }
            }
            Set<String> owned = memberProjects.get(m.getUserId());
            if (owned != null) {
                ids.addAll(owned);
            }
            List<String> names = new ArrayList<String>();
            for (String id : ids) {
                String name = projectNames.get(id);
                if (name != null) {
                    names.add(name);
                }
            }
            if (names.size() > 3) {
                label.projects = String.join("、", names.subList(0, 3)) + " 等";
            } else {
                label.projects = String.join("、", names);
            }
            map.put(m.getUserId(), label);
        }
        return map;
    }

    /** 负载口径与管理页一致：剩余预估 / 到最晚截止日的工作日容量，容量最多折算 22 个工作日。 */
    private Map<String, Integer> loadPct(String ws, String reqId) {
        Map<String, Load> loads = new HashMap<String, Load>();
        Map<String, String> idsByName = new HashMap<String, String>();
        for (WorkspaceMember m : activeMembers(ws)) {
            idsByName.put(displayName(m), m.getUserId());
        }
        LocalDate today = LocalDate.now();
        Map<String, TimeAgg> timeByTask = new HashMap<String, TimeAgg>();
        for (TimeAgg agg : timeLogMapper.sumStageByTaskByWorkspace(ws)) {
            if (agg != null && agg.getTaskId() != null) {
                timeByTask.put(agg.getTaskId(), agg);
            }
        }
        for (Task task : taskMapper.selectAll(ws)) {
            if ("done".equals(task.getBoardColumn()) || "canceled".equals(task.getBoardColumn())) {
                continue;
            }
            if (reqId != null && !reqId.equals(task.getReqId())) {
                continue;
            }
            String key = task.getOwnerUserId();
            if (!hasText(key) && hasText(task.getOwner())) {
                key = idsByName.get(task.getOwner().trim());
            }
            if (!hasText(key)) {
                continue;
            }
            Load load = loads.get(key);
            if (load == null) {
                load = new Load();
                loads.put(key, load);
            }
            TimeAgg agg = timeByTask.get(task.getId());
            int estimate = task.getEstimateMinutes() == null ? 0 : Math.max(0, task.getEstimateMinutes());
            int actual = agg == null || agg.getTotalMinutes() == null ? 0 : Math.max(0, agg.getTotalMinutes());
            load.remaining += Math.max(0, estimate - actual);
            if (isTestLike(task)) {
                int testEstimate = task.getTestEstimateMinutes() == null ? 0 : Math.max(0, task.getTestEstimateMinutes());
                int tested = agg == null || agg.getTestMinutes() == null ? 0 : Math.max(0, agg.getTestMinutes());
                load.remaining += Math.max(0, testEstimate - Math.min(tested, testEstimate));
            }
            if (task.getDueDate() != null && (load.latestDue == null || task.getDueDate().isAfter(load.latestDue))) {
                load.latestDue = task.getDueDate();
            }
        }
        Map<String, Integer> result = new HashMap<String, Integer>();
        for (Map.Entry<String, Load> entry : loads.entrySet()) {
            Load load = entry.getValue();
            int workdays = workdays(load.latestDue, today);
            int capacity = workdays * WorkTime.MAX_MINUTES_PER_DAY;
            result.put(entry.getKey(), capacity <= 0 ? 0
                    : (int) Math.round(load.remaining * (double) PERCENT / capacity));
        }
        return result;
    }

    private static boolean isTestLike(Task task) {
        String col = task.getBoardColumn();
        if ("test".equals(col) || "testing".equals(col)) {
            return true;
        }
        return task.getTestFinishedAt() == null
                && (task.getTestStartedAt() != null || task.getTestRequestedAt() != null);
    }

    private static int workdays(LocalDate latestDue, LocalDate today) {
        if (latestDue == null) {
            return DEFAULT_WORKDAYS;
        }
        int days = 0;
        for (LocalDate date = today; !date.isAfter(latestDue) && days < MAX_WORKDAYS; date = date.plusDays(1)) {
            if (WorkTime.isWorkday(date)) {
                days++;
            }
        }
        return Math.max(1, Math.min(MAX_WORKDAYS, days));
    }

    private int overdueDays(String plannedEnd, String status) {
        if (plannedEnd == null || "done".equals(status)) {
            return 0;
        }
        try {
            LocalDate due = LocalDate.parse(plannedEnd);
            return Math.max(0, (int) Duration.between(due.atStartOfDay(), LocalDate.now().atStartOfDay()).toDays());
        } catch (RuntimeException e) {
            return 0;
        }
    }

    private int countWorkdays(LocalDate start, LocalDate end) {
        int days = 0;
        for (LocalDate date = start; !date.isAfter(end); date = date.plusDays(1)) {
            if (WorkTime.isWorkday(date)) {
                days++;
            }
        }
        return Math.max(1, days);
    }

    private Range range(Integer weekOffset) {
        LocalDate today = LocalDate.now();
        LocalDate monday = today.minusDays(today.getDayOfWeek().getValue() - 1);
        int offset = weekOffset == null ? -1 : Math.max(-52, Math.min(0, weekOffset));
        Range r = new Range();
        r.offset = offset;
        r.start = monday.plusWeeks(offset);
        r.end = r.start.plusDays(6);
        r.beforeDate = r.end.plusDays(1);
        r.from = r.start.atStartOfDay();
        r.before = r.beforeDate.atStartOfDay();
        r.prevFrom = r.start.minusWeeks(1).atStartOfDay();
        r.prevBefore = r.start.atStartOfDay();
        r.label = offset == 0 ? "本周" : (offset == -1 ? "上周" : "该周期");
        return r;
    }

    private static String normalizeReqId(String reqId) {
        return reqId == null || reqId.trim().isEmpty() ? null : reqId.trim();
    }

    private static String normalizeRole(String role) {
        if (role == null) {
            return "all";
        }
        String value = role.trim().toLowerCase();
        if ("dev".equals(value) || "test".equals(value) || "pm".equals(value)
                || "design".equals(value) || "lead".equals(value)) {
            return value;
        }
        return "all";
    }

    private static String roleCode(String title) {
        String t = title == null ? "" : title.toLowerCase();
        /* 职能优先：产品经理归产品、测试经理归测试；「负责人 / 主管」才是管理口径。
           先把明确的职能词判完，再把「经理」当兜底，避免产品经理被吞进负责人。 */
        if (t.contains("负责") || t.contains("主管") || t.contains("lead")) return "lead";
        if (t.contains("测试") || t.contains("qa") || t.contains("质量")) return "test";
        if (t.contains("设计") || t.contains("ui") || t.contains("ux") || t.contains("交互")) return "design";
        if (t.contains("产品") || t.contains("需求") || t.contains("pm") || t.contains("运营")) return "pm";
        if (t.contains("开发") || t.contains("研发") || t.contains("前端") || t.contains("后端")
                || t.contains("技术") || t.contains("工程") || t.contains("dev")) return "dev";
        if (t.contains("经理")) return "lead";
        return "other";
    }

    private static String displayName(WorkspaceMember m) {
        String name = m.getDisplayName() == null ? null : m.getDisplayName().trim();
        if (name == null || name.isEmpty()) {
            name = m.getUsername() == null ? null : m.getUsername().trim();
        }
        return name == null || name.isEmpty() ? m.getUserId() : name;
    }

    private static boolean hasText(String value) {
        return value != null && !value.trim().isEmpty();
    }

    private static String dt(LocalDateTime value) {
        return value == null ? null : value.format(DATE_TIME);
    }

    private static String itemTypeLabel(String type) {
        if ("story".equals(type)) return "故事";
        if ("task".equals(type)) return "任务";
        if ("bug".equals(type)) return "缺陷";
        if ("epic".equals(type)) return "史诗";
        return "工作项";
    }

    private static String docTypeLabel(String type) {
        if ("requirement".equals(type)) return "产品需求";
        if ("technical".equals(type)) return "技术方案";
        if ("acceptance".equals(type)) return "测试验收";
        return "其他";
    }

    private static String typeLabel(String kind, String type) {
        if ("demand".equals(kind)) return type == null ? "需求" : type;
        if ("task".equals(kind)) return itemTypeLabel(type);
        if ("doc".equals(kind)) return docTypeLabel(type);
        if ("case".equals(kind)) {
            if ("passed".equals(type)) return "通过";
            if ("failed".equals(type)) return "未通过";
            if ("blocked".equals(type)) return "阻塞";
            if ("skipped".equals(type)) return "跳过";
            return "用例";
        }
        return "";
    }

    private static String tone(String kind, String type, String extra) {
        if ("case".equals(kind) && "failed".equals(type)) return "bad";
        if ("case".equals(kind) && "blocked".equals(type)) return "warn";
        if ("task".equals(kind) && extra != null && extra.contains("延期")) return "warn";
        if ("doc".equals(kind) && "draft".equals(extra)) return "warn";
        return "";
    }

    private static Map<String, Integer> counts(List<ReviewTeamAggRow> rows) {
        Map<String, Integer> map = new LinkedHashMap<String, Integer>();
        for (ReviewTeamAggRow row : rows) {
            if (row.getKey() != null) {
                map.put(row.getKey(), n(row.getCount()));
            }
        }
        return map;
    }

    private static Map<String, Integer> byProject(List<ReviewTeamAggRow> rows) {
        Map<String, Integer> map = new HashMap<String, Integer>();
        for (ReviewTeamAggRow row : rows) {
            if (row.getProjectId() != null) {
                map.put(row.getProjectId(), n(row.getCount()));
            }
        }
        return map;
    }

    private static int get(Map<String, Integer> map, String key) {
        Integer value = map.get(key);
        return value == null ? 0 : value;
    }

    private static int sum(Map<String, Integer> map) {
        int total = 0;
        for (Integer value : map.values()) {
            total += value == null ? 0 : value;
        }
        return total;
    }

    private static int n(Integer value) {
        return value == null ? 0 : value;
    }

    private static final class Range {
        int offset;
        LocalDate start;
        LocalDate end;
        LocalDate beforeDate;
        LocalDateTime from;
        LocalDateTime before;
        LocalDateTime prevFrom;
        LocalDateTime prevBefore;
        String label;
    }

    private static final class Load {
        int remaining;
        LocalDate latestDue;
    }

    private static final class MemberLabels {
        String title;
        String code;
        String projects;
    }

    private static final class MemberRowCtx {
        ReviewTeamResponse.MemberRow row;
        boolean testParticipant;
    }
}
