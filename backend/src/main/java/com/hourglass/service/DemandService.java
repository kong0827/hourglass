package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.common.Ids;
import com.hourglass.common.Nos;
import com.hourglass.common.Texts;
import com.hourglass.dto.DemandGanttItem;
import com.hourglass.dto.DemandMovePreview;
import com.hourglass.dto.DemandGanttPage;
import com.hourglass.dto.DemandStage;
import com.hourglass.dto.DemandTimeline;
import com.hourglass.dto.DemandActionRequest;
import com.hourglass.dto.DemandBoardResponse;
import com.hourglass.dto.DemandPage;
import com.hourglass.dto.DemandQuery;
import com.hourglass.dto.DemandSaveRequest;
import com.hourglass.entity.Category;
import com.hourglass.entity.Demand;
import com.hourglass.entity.ProjectVersion;
import com.hourglass.entity.Requirement;
import com.hourglass.entity.Task;
import com.hourglass.entity.TestCase;
import com.hourglass.mapper.CategoryMapper;
import com.hourglass.mapper.DemandMapper;
import com.hourglass.mapper.ProjectVersionMapper;
import com.hourglass.mapper.RequirementDocMapper;
import com.hourglass.mapper.RequirementMapper;
import com.hourglass.mapper.TaskMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * M2 需求池（T2.1 / T2.4 / T2.5）：CRUD + 状态机 + WSJF。
 *
 * <p>状态机：review（待评审）→ pass（已通过）/ closed（已关闭）；pass → plan（已排期，选目标版本）；
 * plan → done（已完成，完成条件满足时自动进入，证据失效自动退回，见 DemandCompletionService）；
 * closed 按关闭前阶段回 review/pass；pass → unpass 撤回评审；plan → unplan 退回已通过并解绑版本。
 * 评审流转仅空间主可执行；排期/调期/撤排/取消/恢复由管理角色执行，全部动作写 demand_log 留痕。
 * WSJF =（业务价值+时间紧迫度+风险降低）÷ 工作量，四分量齐全才算，禁止手填结果。
 */
@Service
public class DemandService {

    private static final int MAX_PAGE_SIZE = 100;

    private final DemandMapper demandMapper;
    private final RequirementMapper reqMapper;
    private final ProjectVersionMapper versionMapper;
    private final TaskMapper taskMapper;
    private final NotificationEventService notificationEvents;
    private final RequirementDocMapper docMapper;
    private final ProjectAccessService projectAccess;
    private final AttachmentService attachmentService;
    private final com.hourglass.mapper.MailDeliveryMapper mailDeliveryMapper;
    private final com.hourglass.mapper.TestCaseMapper caseMapper;
    private final CategoryMapper categoryMapper;
    private final DeliveryScopeLock deliveryLock;
    private final ReleasePermissionService releasePermission;
    /** 删除不可逆：需求自身的流转日志会一起清掉，必须在删除前写独立墓碑 */
    private final DeletionTraceService deletionTrace;
    private final NumberSeqService numberSeq;
    private final DemandWatchService demandWatch;
    @org.springframework.beans.factory.annotation.Autowired
    private com.hourglass.mapper.VersionTaskMapper versionTaskMapper;
    /** 排期带入版本与手工调整同一份任务审计格式 */
    @org.springframework.beans.factory.annotation.Autowired
    private TaskAuditLogger taskAudit;
    @org.springframework.beans.factory.annotation.Autowired
    private TaskPublicationService publications;
    @org.springframework.beans.factory.annotation.Autowired
    private com.hourglass.mapper.ReleaseMapper releases;
    /** 需求删除后，其下工作项的用例关联也要解除（工作项本身保留但会失去 demand_id） */
    @org.springframework.beans.factory.annotation.Autowired
    private com.hourglass.mapper.TestCaseTaskMapper caseTaskMapper;
    /** 人工判定是需求的追加式记录，需求删除时必须一起清理 */
    @org.springframework.beans.factory.annotation.Autowired
    private com.hourglass.mapper.DemandDeliveryJudgementMapper judgementMapper;
    /** 评论区强归属需求：需求硬删除时一起清理，评论转出的工作项保留 */
    @org.springframework.beans.factory.annotation.Autowired
    private com.hourglass.mapper.DemandCommentMapper demandCommentMapper;
    /** 列表/详情回填提交人显示名：只按 createdBy 查名，不做任何推断 */
    @org.springframework.beans.factory.annotation.Autowired
    private com.hourglass.mapper.UserMapper userMapper;
    private static final com.fasterxml.jackson.databind.ObjectMapper JSON = new com.fasterxml.jackson.databind.ObjectMapper();

    public DemandService(DemandMapper demandMapper, RequirementMapper reqMapper,
                         ProjectVersionMapper versionMapper, TaskMapper taskMapper,
                         NotificationEventService notificationEvents, RequirementDocMapper docMapper,
                         ProjectAccessService projectAccess, AttachmentService attachmentService,
                         com.hourglass.mapper.MailDeliveryMapper mailDeliveryMapper,
                         com.hourglass.mapper.TestCaseMapper caseMapper, CategoryMapper categoryMapper,
                         DeliveryScopeLock deliveryLock, ReleasePermissionService releasePermission,
                         DeletionTraceService deletionTrace, NumberSeqService numberSeq,
                         DemandWatchService demandWatch) {
        this.demandMapper = demandMapper;
        this.reqMapper = reqMapper;
        this.versionMapper = versionMapper;
        this.taskMapper = taskMapper;
        this.notificationEvents = notificationEvents;
        this.docMapper = docMapper;
        this.projectAccess = projectAccess;
        this.attachmentService = attachmentService;
        this.mailDeliveryMapper = mailDeliveryMapper;
        this.caseMapper = caseMapper;
        this.categoryMapper = categoryMapper;
        this.deliveryLock = deliveryLock;
        this.releasePermission = releasePermission;
        this.deletionTrace = deletionTrace;
        this.numberSeq = numberSeq;
        this.demandWatch = demandWatch;
    }

    /** 列表模式分页：筛选/排序/分页全在 SQL，counts 忽略 status 与列内阶段条件 */
    public DemandPage page(String workspaceId, String userId, DemandQuery query) {
        prepare(workspaceId, userId, query);
        normalizeFilters(query);
        query.setOffset(Math.max(0, query.getOffset()));
        query.setLimit(Math.max(1, Math.min(MAX_PAGE_SIZE, query.getLimit())));

        Map<String, Integer> counts = countByStatus(query);
        int total = query.getDeliveryStage() != null ? demandMapper.countPage(query)
                : query.getStatus() == null ? sumCounts(counts) : countOf(counts, query.getStatus());
        List<Demand> items = total <= query.getOffset()
                ? new java.util.ArrayList<Demand>()
                : demandMapper.selectPage(query);
        for (Demand d : items) {
            fillWsjf(d);
            d.setCanSchedule(releasePermission.canManageProject(userId, workspaceId, d.getReqId()));
        }
        fillCreatorNames(items);

        DemandPage page = new DemandPage();
        page.setTotal(total);
        page.setOffset(query.getOffset());
        page.setLimit(query.getLimit());
        page.setItems(items);
        page.setHasMore(query.getOffset() + items.size() < total);
        page.setCounts(counts);
        return page;
    }

    /** 兼容旧调用：只按项目取整块看板 */
    public DemandBoardResponse board(String workspaceId, String userId, String reqId, int limit) {
        DemandQuery base = new DemandQuery();
        base.setReqId(Texts.trimToNull(reqId));
        base.setLimit(limit);
        return board(workspaceId, userId, base);
    }

    /**
     * 看板：每个状态一列，只取首屏 limit 条；其余由 /api/demands/page 滚动加载。
     * 搜索/优先级/类型/模块条件与列表共用 DemandQuery，服务端过滤后列计数即匹配数；
     * totalAll 始终是该项目的未筛选总数，用于展示「匹配 M / N」。
     */
    public DemandBoardResponse board(String workspaceId, String userId, DemandQuery base) {
        prepare(workspaceId, userId, base);
        normalizeFilters(base);
        int safeLimit = Math.max(1, Math.min(MAX_PAGE_SIZE, base.getLimit() <= 0 ? 50 : base.getLimit()));
        base.setLimit(safeLimit);
        /* 列头计数不随阶段筛选变化：筛选只作用于该阶段所属的列，另一列仍展示全部 */
        DemandQuery countScope = copyOf(base);
        countScope.setDeliveryStage(null);
        Map<String, Integer> counts = countByStatus(countScope);

        DemandBoardResponse resp = new DemandBoardResponse();
        resp.setCounts(counts);
        resp.setTotalAll(boardTotalAll(base));
        resp.setFacets(boardFacets(base));
        resp.setStageCounts(deliveryStageCounts(base, "plan"));
        resp.setDoneStageCounts(deliveryStageCounts(base, "done"));
        for (String status : DEMAND_STATUSES) {
            DemandQuery q = copyOf(base);
            q.setStatus(status);
            q.setOffset(0);
            q.setLimit(safeLimit);
            // 阶段只从已排期 / 已完成派生；其余状态恒为 NULL，带进其他列会把整列清空。
            // 待开工/推进中只筛已排期列，待发布/已交付只筛已完成列，避免另一列被筛成空。
            if (!"plan".equals(status) && !"done".equals(status)) {
                q.setDeliveryStage(null);
            } else if (q.getDeliveryStage() != null && !stageBelongsTo(status, q.getDeliveryStage())) {
                q.setDeliveryStage(null);
            }
            int matched = q.getDeliveryStage() != null ? demandMapper.countPage(q) : countOf(counts, status);
            List<Demand> items = matched == 0 ? new java.util.ArrayList<Demand>() : demandMapper.selectPage(q);
            for (Demand d : items) {
                fillWsjf(d);
                d.setCanSchedule(releasePermission.canManageProject(userId, workspaceId, d.getReqId()));
            }
            fillCreatorNames(items);
            DemandBoardResponse.Column col = new DemandBoardResponse.Column();
            col.setItems(items);
            col.setMatched(matched);
            col.setHasMore(matched > items.size());
            resp.getColumns().put(status, col);
        }
        return resp;
    }

    private static final String[] DEMAND_STATUSES = {"review", "pass", "plan", "done", "closed"};
    private static final String[] DELIVERY_STAGES = {"waiting", "active", "donePending", "delivered"};

    /** 主状态工作页：页签总量不受当前筛选影响，指标和分页卡片响应当前筛选。 */
    public com.hourglass.dto.DemandWorkpageResponse workpage(String workspaceId, String userId, DemandQuery query) {
        String status = validStatus(query.getStatus());
        if (status == null) {
            throw AppException.badRequest("请选择有效的主状态");
        }
        query.setStatus(status);
        DemandPage page = page(workspaceId, userId, query);

        DemandQuery mainScope = copyOf(query);
        clearWorkFilters(mainScope);
        Map<String, Integer> statusCounts = countByStatus(mainScope);
        mainScope.setStatus(status);

        com.hourglass.dto.DemandWorkpageResponse out = new com.hourglass.dto.DemandWorkpageResponse();
        out.setPage(page);
        out.setStatusCounts(statusCounts);
        out.setStageCounts(deliveryStageCounts(mainScope, status));
        Map<String, Object> metrics = demandMapper.workpageMetrics(query);
        out.setMetrics(metrics == null ? new LinkedHashMap<String, Object>() : metrics);

        DemandQuery versionsQuery = copyOf(query);
        versionsQuery.setStatus("done".equals(status) ? "done" : "plan");
        versionsQuery.setDeliveryStage(null);
        versionsQuery.setVersionId(null);
        List<Map<String, Object>> versions = demandMapper.selectWorkpageVersions(versionsQuery);
        versions.sort((a, b) -> {
            boolean aNone = "__none".equals(String.valueOf(a.get("versionId")));
            boolean bNone = "__none".equals(String.valueOf(b.get("versionId")));
            if (aNone || bNone) {
                return aNone == bNone ? 0 : aNone ? 1 : -1;
            }
            int byName = com.hourglass.common.VersionOrdering.compareDesc(
                    String.valueOf(a.get("versionName")), String.valueOf(b.get("versionName")));
            return byName != 0 ? byName : String.valueOf(a.get("versionId")).compareTo(String.valueOf(b.get("versionId")));
        });
        out.setVersions(versions);
        return out;
    }

    /**
     * 甘特：分页口径与列表一致，只对当前页做批量聚合，避免逐条查询。
     * 阶段时间只取真实记录（流转日志/关联文档/工作项/用例/版本），缺记录不推算。
     */
    public DemandGanttPage gantt(String workspaceId, String userId, DemandQuery query) {
        DemandPage page = page(workspaceId, userId, query);
        DemandGanttPage out = new DemandGanttPage();
        out.setTotal(page.getTotal());
        out.setOffset(page.getOffset());
        out.setLimit(page.getLimit());
        out.setHasMore(page.isHasMore());
        out.setCounts(page.getCounts());

        List<Demand> demands = page.getItems();
        if (demands.isEmpty()) {
            return out;
        }
        List<String> ids = new ArrayList<String>();
        for (Demand d : demands) {
            ids.add(d.getId());
        }

        Map<String, Map<String, Object>> logs = indexRows(demandMapper.selectLogTimeline(workspaceId, ids));
        boolean seeAllDrafts = ProjectAccessService.isPrivileged(projectAccess.roleOf(workspaceId, userId));
        Map<String, Map<String, Object>> docs = indexRows(demandMapper.selectDocTimeline(
                workspaceId, ids, query.getViewerId(), userId, seeAllDrafts));
        Map<String, Map<String, Object>> tasks = indexRows(demandMapper.selectTaskTimeline(workspaceId, ids));
        Map<String, Map<String, Object>> taskStarts = indexRows(demandMapper.selectTaskStartTimeline(workspaceId, ids));
        Map<String, Map<String, Object>> tests = indexRows(demandMapper.selectTestTimeline(workspaceId, ids));
        Map<String, Map<String, Object>> releaseDates = indexRows(demandMapper.selectDemandReleaseTimeline(workspaceId, ids));
        Map<String, List<com.hourglass.entity.VersionRelease>> history = new LinkedHashMap<String, List<com.hourglass.entity.VersionRelease>>();
        java.util.Set<String> capturedTaskIds = new java.util.TreeSet<String>();
        for (com.hourglass.entity.VersionRelease record : demandMapper.selectActualRecords(workspaceId, ids)) {
            java.util.Set<String> capturedDemandIds = new java.util.HashSet<String>();
            for (com.hourglass.entity.VersionReleaseItem item : record.getItems()) {
                if (ids.contains(item.getDemandId())) {
                    capturedDemandIds.add(item.getDemandId());
                    capturedTaskIds.add(item.getTaskId());
                }
            }
            for (String demandId : capturedDemandIds)
                history.computeIfAbsent(demandId, key -> new ArrayList<com.hourglass.entity.VersionRelease>()).add(record);
        }
        List<com.hourglass.entity.VersionRelease> publicationRecords = new ArrayList<com.hourglass.entity.VersionRelease>();
        List<String> capturedIds = new ArrayList<String>(capturedTaskIds);
        for (int from = 0; from < capturedIds.size(); from += 500)
            publicationRecords.addAll(releases.selectPublicationRecords(workspaceId,
                    capturedIds.subList(from, Math.min(from + 500, capturedIds.size()))));

        LocalDate today = LocalDate.now();
        for (Demand d : demands) {
            DemandGanttItem item = new DemandGanttItem();
            item.setDemand(d);
            item.setTimeline(timelineOf(d, logs.get(d.getId()), docs.get(d.getId()),
                    tasks.get(d.getId()), taskStarts.get(d.getId()), tests.get(d.getId()),
                    releaseDates.get(d.getId()), today));
            List<com.hourglass.entity.VersionRelease> actual = history.getOrDefault(d.getId(), java.util.Collections.emptyList());
            item.getTimeline().setReleaseRecords(actual);
            java.util.Set<String> taskIds = new java.util.HashSet<String>();
            for (com.hourglass.entity.VersionRelease record : actual) {
                for (com.hourglass.entity.VersionReleaseItem captured : record.getItems())
                    if (d.getId().equals(captured.getDemandId()) && "success".equals(record.getResult())
                            && "production".equals(record.getEnvironment())
                            && ("published".equals(captured.getDisposition()) || "rolled_back".equals(captured.getDisposition()))
                            && captured.getTaskId() != null) taskIds.add(captured.getTaskId());
            }
            for (String taskId : taskIds) {
                TaskPublicationService.PublicationSummary summary = publications.project(taskId, publicationRecords);
                if ("effective".equals(summary.getPublicationState()))
                    item.getTimeline().setProductionEffectiveTaskCount(item.getTimeline().getProductionEffectiveTaskCount() + 1);
                else if ("partial".equals(summary.getPublicationState()))
                    item.getTimeline().setProductionPartialTaskCount(item.getTimeline().getProductionPartialTaskCount() + 1);
                else if ("unknown".equals(summary.getPublicationState()))
                    item.getTimeline().setPublicationUnknownTaskCount(item.getTimeline().getPublicationUnknownTaskCount() + 1);
            }
            out.getItems().add(item);
        }
        return out;
    }

    private static Map<String, Map<String, Object>> indexRows(List<Map<String, Object>> rows) {
        return indexRows(rows, "demandId");
    }

    private static Map<String, Map<String, Object>> indexRows(List<Map<String, Object>> rows, String key) {
        Map<String, Map<String, Object>> out = new LinkedHashMap<String, Map<String, Object>>();
        if (rows == null) {
            return out;
        }
        for (Map<String, Object> row : rows) {
            Object id = row.get(key);
            if (id != null) {
                out.put(String.valueOf(id), row);
            }
        }
        return out;
    }

    private DemandTimeline timelineOf(Demand d, Map<String, Object> log, Map<String, Object> doc,
                                      Map<String, Object> task, Map<String, Object> taskStart,
                                      Map<String, Object> test, Map<String, Object> release,
                                      LocalDate today) {
        DemandTimeline timeline = new DemandTimeline();
        List<DemandStage> stages = timeline.getStages();
        String status = d.getStatus();
        LocalDate created = d.getCreatedAt() == null ? today : d.getCreatedAt().toLocalDate();
        LocalDateTime passTime = toDateTime(value(log, "passAt"));
        LocalDateTime rejTime = toDateTime(value(log, "rejAt"));
        LocalDateTime reopenTime = toDateTime(value(log, "reviewReopenAt"));
        LocalDate passAt = passTime == null ? null : passTime.toLocalDate();
        LocalDate rejAt = rejTime == null ? null : rejTime.toLocalDate();
        LocalDate planAt = toDate(value(log, "planAt"));
        LocalDate replanAt = toDate(value(log, "replanAt"));
        LocalDate cancelAt = toDate(value(log, "cancelAt"));
        boolean canceled = "closed".equals(status) || "canceled".equals(status) || "rej".equals(status);
        /* 已关闭的需求停表：仍在进行的阶段收在关闭日，不再一路画到今天 */
        LocalDate horizon = canceled && cancelAt != null ? cancelAt
                : canceled && rejAt != null && "review".equals(d.getCloseStage()) ? rejAt : today;

        /* 评审整段计算：创建 → 最后一次通过；待评审算到今天；已拒绝停在最后一次拒绝 */
        LocalDate reviewEnd;
        boolean reviewOpen;
        if ("review".equals(status)) {
            reviewEnd = today;
            reviewOpen = true;
        } else if ("rej".equals(status) || ("closed".equals(status) && "rej".equals(d.getCloseReason())
                && "review".equals(d.getCloseStage()))) {
            reviewEnd = rejAt == null ? horizon : rejAt;
            reviewOpen = rejAt == null;
        } else if (canceled) {
            /* 取消前最后一次评审结论（通过或拒绝）之后没被撤回 / 重新打开，评审就停在结论日；
               否则是在评审中被取消，停在取消日 */
            LocalDateTime verdict = later(passTime, rejTime);
            if (verdict != null && (reopenTime == null || reopenTime.isBefore(verdict))) {
                reviewEnd = verdict.toLocalDate();
            } else if (verdict == null && planAt != null) {
                reviewEnd = planAt;
            } else {
                reviewEnd = horizon;
            }
            reviewOpen = false;
        } else {
            reviewEnd = passAt != null ? passAt : (planAt != null ? planAt : today);
            reviewOpen = passAt == null && planAt == null;
        }
        addStage(stages, "review", created, reviewEnd, reviewOpen, false);

        /* 排期段只看有没有排过：撤排 / 取消 / 恢复后仍是真实记录，调期把段尾推到最新一次决定 */
        LocalDate scheduleAt = planAt;
        if (replanAt != null && (scheduleAt == null || replanAt.isAfter(scheduleAt))) {
            scheduleAt = replanAt;
        }
        if (scheduleAt != null) {
            /* 撤排后又重新评审通过时最后一次通过晚于排期：拿不到那次排期之前的通过日，只标排期决定那一天 */
            LocalDate planStart = passAt == null ? created : passAt;
            if (planStart.isAfter(scheduleAt)) {
                planStart = scheduleAt;
            }
            addStage(stages, "plan", planStart, scheduleAt, false, planStart.isEqual(scheduleAt));
        }

        int docCount = intValue(value(doc, "docCount"));
        int docPublished = intValue(value(doc, "docPublished"));
        timeline.setDocCount(docCount);
        timeline.setDocPublished(docPublished);
        LocalDate docStart = toDate(value(doc, "docStart"));
        if (docStart != null) {
            boolean designRunning = docPublished < docCount;
            addStage(stages, "design", docStart,
                    stageEnd(designRunning, toDate(value(doc, "docEnd")), horizon),
                    designRunning && !canceled, false);
        }

        int taskCount = intValue(value(task, "taskCount"));
        int taskDone = intValue(value(task, "taskDone"));
        int taskOpen = intValue(value(task, "taskOpen"));
        timeline.setTaskCount(taskCount);
        timeline.setTaskDone(taskDone);
        /* 开发段起点取真实开工日（首次离开待处理 / 首次计时），计划开始日期不参与 */
        LocalDate devStart = toDate(value(taskStart, "devStart"));
        LocalDate devEnd = toDate(value(task, "devEnd"));
        boolean devRunning = taskOpen > 0;
        if (devStart != null) {
            addStage(stages, "dev", devStart, stageEnd(devRunning, devEnd, horizon),
                    devRunning && !canceled, false);
        }

        int caseCount = intValue(value(test, "caseCount"));
        int caseUntested = intValue(value(test, "caseUntested"));
        int caseFailed = intValue(value(test, "caseFailed"));
        int casePending = caseUntested + caseFailed;
        timeline.setCaseCount(caseCount);
        timeline.setCaseUntested(caseUntested);
        timeline.setCaseFailed(caseFailed);
        timeline.setCasePending(casePending);
        LocalDate testStart = toDate(value(test, "testStart"));
        LocalDate testEnd = toDate(value(test, "testEnd"));
        /* 工作项测试列的实际测试窗口与用例执行记录合并：任一来源都能撑起测试阶段 */
        LocalDate taskTestStart = toDate(value(task, "testStart"));
        LocalDate taskTestEnd = toDate(value(task, "testEnd"));
        if (taskTestStart != null && (testStart == null || taskTestStart.isBefore(testStart))) {
            testStart = taskTestStart;
        }
        if (taskTestEnd != null && (testEnd == null || taskTestEnd.isAfter(testEnd))) {
            testEnd = taskTestEnd;
        }
        boolean testRunning = casePending > 0 || intValue(value(task, "testOpen")) > 0;
        if (testStart != null) {
            addStage(stages, "test", testStart, stageEnd(testRunning, testEnd, horizon),
                    testRunning && !canceled, false);
        }

        /* 完成点取开发与测试的较晚收口；仍有未执行或未通过用例时不算完成 */
        LocalDate lastWork = devEnd;
        if (testEnd != null && (lastWork == null || testEnd.isAfter(lastWork))) {
            lastWork = testEnd;
        }
        LocalDate completeAt = null;
        if (taskCount > 0 && taskDone >= taskCount && casePending == 0) {
            completeAt = lastWork == null ? horizon : lastWork;
            addStage(stages, "complete", completeAt, completeAt, false, true);
        }

        /* 发布点只取成功产品发布条目的不可变需求快照，调期 / 撤排 / 取消不抹去实际证据。 */
        LocalDate releasedAt = toDate(value(release, "releasedAt"));
        if (releasedAt != null) {
            LocalDate releaseStart = completeAt != null ? completeAt : (lastWork == null ? releasedAt : lastWork);
            if (releaseStart.isAfter(releasedAt)) {
                releaseStart = releasedAt;
            }
            addStage(stages, "release", releaseStart, releasedAt, false, releaseStart.isEqual(releasedAt));
        }

        LocalDate start = null;
        LocalDate end = null;
        for (DemandStage stage : stages) {
            if (start == null || stage.getStart().isBefore(start)) {
                start = stage.getStart();
            }
            if (end == null || stage.getEnd().isAfter(end)) {
                end = stage.getEnd();
            }
        }
        timeline.setStart(start);
        timeline.setEnd(end);
        timeline.setDays(start == null || end == null ? 0
                : (int) (java.time.temporal.ChronoUnit.DAYS.between(start, end) + 1));
        return timeline;
    }

    private static void addStage(List<DemandStage> stages, String name, LocalDate start, LocalDate end,
                                 boolean open, boolean point) {
        if (start == null) {
            return;
        }
        if (end == null || end.isBefore(start)) {
            end = start;
        }
        DemandStage stage = new DemandStage();
        stage.setStage(name);
        stage.setStart(start);
        stage.setEnd(end);
        stage.setOpen(open);
        stage.setPoint(point);
        stages.add(stage);
    }

    private static Object value(Map<String, Object> row, String key) {
        return row == null ? null : row.get(key);
    }

    /* 仍在进行（或没有收尾记录）的阶段画到 horizon；已取消时 horizon 是取消日，取消后才落的收尾记录照实保留 */
    private static LocalDate stageEnd(boolean running, LocalDate recordedEnd, LocalDate horizon) {
        if (recordedEnd == null) {
            return horizon;
        }
        if (!running) {
            return recordedEnd;
        }
        return recordedEnd.isAfter(horizon) ? recordedEnd : horizon;
    }

    private static LocalDateTime later(LocalDateTime a, LocalDateTime b) {
        if (a == null) {
            return b;
        }
        return b == null || a.isAfter(b) ? a : b;
    }

    private static LocalDateTime toDateTime(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof LocalDateTime) {
            return (LocalDateTime) value;
        }
        if (value instanceof java.sql.Timestamp) {
            return ((java.sql.Timestamp) value).toLocalDateTime();
        }
        if (value instanceof java.util.Date) {
            return new java.sql.Timestamp(((java.util.Date) value).getTime()).toLocalDateTime();
        }
        if (value instanceof LocalDate) {
            return ((LocalDate) value).atStartOfDay();
        }
        String text = String.valueOf(value);
        if (text.length() < 10) {
            return null;
        }
        return text.length() >= 19
                ? LocalDateTime.parse(text.substring(0, 19).replace(' ', 'T'))
                : LocalDate.parse(text.substring(0, 10)).atStartOfDay();
    }

    private static LocalDate toDate(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof LocalDate) {
            return (LocalDate) value;
        }
        if (value instanceof LocalDateTime) {
            return ((LocalDateTime) value).toLocalDate();
        }
        if (value instanceof java.sql.Date) {
            return ((java.sql.Date) value).toLocalDate();
        }
        if (value instanceof java.sql.Timestamp) {
            return ((java.sql.Timestamp) value).toLocalDateTime().toLocalDate();
        }
        if (value instanceof java.util.Date) {
            return new java.sql.Date(((java.util.Date) value).getTime()).toLocalDate();
        }
        String text = String.valueOf(value);
        return text.length() < 10 ? null : LocalDate.parse(text.substring(0, 10));
    }

    private static int intValue(Object value) {
        if (value instanceof Number) {
            return ((Number) value).intValue();
        }
        if (value == null) {
            return 0;
        }
        try {
            return Integer.parseInt(String.valueOf(value));
        } catch (NumberFormatException ex) {
            return 0;
        }
    }


    private void prepare(String workspaceId, String userId, DemandQuery query) {
        query.setWorkspaceId(workspaceId);
        if (query.getReqId() != null) {
            requireProject(workspaceId, query.getReqId());
            projectAccess.assertView(workspaceId, userId, query.getReqId());
        }
        query.setViewerId(projectAccess.viewerScope(workspaceId, userId));
    }

    private String validStatus(String status) {
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

    private void normalizeFilters(DemandQuery query) {
        query.setStatus(validStatus(query.getStatus()));
        query.setDeliveryStage(validChoice(query.getDeliveryStage(), DELIVERY_STAGES));
        query.setCloseReason(validChoice(query.getCloseReason(), new String[]{"rej", "cancel", "dup"}));
        query.setCloseStage(validChoice(query.getCloseStage(), new String[]{"review", "pass", "plan", "done"}));
        query.setFocus(validChoice(query.getFocus(), new String[]{"high", "dueSoon", "risk"}));
        query.setVersionId(Texts.trimToNull(query.getVersionId()));
    }

    private static String validChoice(String value, String[] choices) {
        String text = Texts.trimToNull(value);
        if (text == null) {
            return null;
        }
        for (String choice : choices) {
            if (choice.equals(text)) {
                return text;
            }
        }
        return null;
    }

    private static void clearWorkFilters(DemandQuery query) {
        query.setStatus(null);
        query.setDeliveryStage(null);
        query.setVersionId(null);
        query.setCloseReason(null);
        query.setCloseStage(null);
        query.setFocus(null);
        query.setQ(null);
        query.setPris(new ArrayList<String>());
        query.setKinds(new ArrayList<String>());
        query.setCats(new ArrayList<String>());
        query.setReqs(new ArrayList<String>());
    }

    /** 阶段分组：待开工/推进中属于已排期，待发布/已交付属于已完成。 */
    private static boolean stageBelongsTo(String status, String stage) {
        if ("plan".equals(status)) {
            return "waiting".equals(stage) || "active".equals(stage);
        }
        if ("done".equals(status)) {
            return "donePending".equals(stage) || "delivered".equals(stage);
        }
        return false;
    }

    private Map<String, Integer> deliveryStageCounts(DemandQuery query, String status) {        DemandQuery scope = copyOf(query);
        scope.setStatus(status);
        scope.setDeliveryStage(null);
        Map<String, Integer> counts = new LinkedHashMap<String, Integer>();
        for (String stage : DELIVERY_STAGES) {
            counts.put(stage, 0);
        }
        for (Map<String, Object> row : demandMapper.countGroupByDeliveryStage(scope)) {
            Object stage = row.get("stage");
            if (stage != null && counts.containsKey(String.valueOf(stage))) {
                counts.put(String.valueOf(stage), intValue(row.get("cnt")));
            }
        }
        int all = 0;
        if ("plan".equals(status)) {
            all += countOf(counts, "waiting") + countOf(counts, "active");
        } else if ("done".equals(status)) {
            all += countOf(counts, "donePending") + countOf(counts, "delivered");
        }
        counts.put("all", all);
        return counts;
    }

    /** 看板范围（项目/可见性）不变，去掉搜索与筛选后的总数；用于「匹配 M / N」的 N */
    private int boardTotalAll(DemandQuery query) {
        DemandQuery all = copyOf(query);
        all.setStatus(null);
        all.setDeliveryStage(null);
        all.setVersionId(null);
        all.setCloseReason(null);
        all.setCloseStage(null);
        all.setFocus(null);
        all.setQ(null);
        all.setPris(new java.util.ArrayList<String>());
        all.setKinds(new java.util.ArrayList<String>());
        all.setCats(new java.util.ArrayList<String>());
        all.setReqs(new java.util.ArrayList<String>());
        return sumCounts(countByStatus(all));
    }

    /** 看板筛选项计数：保留项目/可见性与搜索词，去掉三个筛选维度，一次分组后在内存聚合 */
    private Map<String, Map<String, Integer>> boardFacets(DemandQuery query) {
        DemandQuery scope = copyOf(query);
        scope.setStatus(null);
        scope.setDeliveryStage(null);
        scope.setVersionId(null);
        scope.setCloseReason(null);
        scope.setCloseStage(null);
        scope.setFocus(null);
        scope.setPris(new java.util.ArrayList<String>());
        scope.setKinds(new java.util.ArrayList<String>());
        scope.setCats(new java.util.ArrayList<String>());
        scope.setReqs(new java.util.ArrayList<String>());
        Map<String, Integer> pris = new java.util.LinkedHashMap<String, Integer>();
        Map<String, Integer> kinds = new java.util.LinkedHashMap<String, Integer>();
        Map<String, Integer> cats = new java.util.LinkedHashMap<String, Integer>();
        List<Map<String, Object>> rows = demandMapper.countGroupByFacets(scope);
        if (rows != null) {
            for (Map<String, Object> row : rows) {
                Object cnt = row.get("cnt");
                int n = cnt == null ? 0 : ((Number) cnt).intValue();
                addFacet(pris, row.get("pri"), n);
                addFacet(kinds, row.get("kind"), n);
                addFacet(cats, row.get("cat"), n);
            }
        }
        Map<String, Map<String, Integer>> facets = new java.util.LinkedHashMap<String, Map<String, Integer>>();
        facets.put("pris", pris);
        facets.put("kinds", kinds);
        facets.put("cats", cats);
        return facets;
    }

    private static void addFacet(Map<String, Integer> bucket, Object key, int n) {
        String k = key == null ? "" : String.valueOf(key);
        Integer old = bucket.get(k);
        bucket.put(k, (old == null ? 0 : old) + n);
    }

    private Map<String, Integer> countByStatus(DemandQuery query) {
        DemandQuery countsQuery = copyOf(query);
        countsQuery.setStatus(null);
        countsQuery.setDeliveryStage(null);
        Map<String, Integer> counts = new java.util.LinkedHashMap<String, Integer>();
        for (String status : DEMAND_STATUSES) {
            counts.put(status, 0);
        }
        for (Map<String, Object> row : demandMapper.countGroupByStatus(countsQuery)) {
            Object status = row.get("status");
            Object cnt = row.get("cnt");
            if (status != null) {
                counts.put(String.valueOf(status), cnt == null ? 0 : ((Number) cnt).intValue());
            }
        }
        counts.put("all", sumCounts(counts));
        return counts;
    }

    private int countOf(Map<String, Integer> counts, String status) {
        Integer n = counts.get(status);
        return n == null ? 0 : n;
    }

    private int sumCounts(Map<String, Integer> counts) {
        int sum = 0;
        for (String status : DEMAND_STATUSES) {
            sum += countOf(counts, status);
        }
        return sum;
    }

    private DemandQuery copyOf(DemandQuery src) {
        DemandQuery q = new DemandQuery();
        q.setWorkspaceId(src.getWorkspaceId());
        q.setReqId(src.getReqId());
        q.setStatus(src.getStatus());
        q.setDeliveryStage(src.getDeliveryStage());
        q.setVersionId(src.getVersionId());
        q.setCloseReason(src.getCloseReason());
        q.setCloseStage(src.getCloseStage());
        q.setFocus(src.getFocus());
        q.setQ(src.getQ());
        q.setPris(src.getPris());
        q.setKinds(src.getKinds());
        q.setCats(src.getCats());
        q.setReqs(src.getReqs());
        q.setSort(src.getSort());
        q.setOffset(src.getOffset());
        q.setLimit(src.getLimit());
        q.setViewerId(src.getViewerId());
        return q;
    }

    public Demand get(String workspaceId, String id) {
        DemandQuery detailQuery = new DemandQuery();
        detailQuery.setWorkspaceId(workspaceId);
        Demand d = demandMapper.selectDetail(detailQuery, id);
        if (d == null || !workspaceId.equals(d.getWorkspaceId())) {
            throw AppException.notFound("需求不存在：" + id);
        }
        fillWsjf(d);
        fillCreatorNames(java.util.Collections.singletonList(d));
        return d;
    }

    /** 读取前校验项目可见范围（不可见按不存在处理） */
    public Demand getVisible(String workspaceId, String userId, String id) {
        Demand d = get(workspaceId, id);
        projectAccess.assertView(workspaceId, userId, d.getReqId());
        boolean canManage = releasePermission.canManageProject(userId, workspaceId, d.getReqId());
        d.setCanSchedule(canManage);
        d.setCanJudgeDelivery(canManage);
        return d;
    }

    public com.hourglass.dto.PageResult<Map<String, Object>> logs(String workspaceId, String userId, String id,
                                                                   int offset, int limit) {
        Demand d = requireDemand(workspaceId, id);
        projectAccess.assertView(workspaceId, userId, d.getReqId());
        int safeOffset = Math.max(0, offset);
        int safeLimit = Math.max(1, Math.min(MAX_PAGE_SIZE, limit));
        int total = demandMapper.countLogs(workspaceId, id);
        List<Map<String, Object>> items = total <= safeOffset ? new ArrayList<Map<String, Object>>()
                : demandMapper.selectLogs(workspaceId, id, safeOffset, safeLimit);
        return com.hourglass.dto.PageResult.of(items, total, safeOffset, safeLimit);
    }

    public com.hourglass.dto.PageResult<Task> tasks(String workspaceId, String userId, String id,
                                                     int offset, int limit) {
        Demand d = requireDemand(workspaceId, id);
        projectAccess.assertView(workspaceId, userId, d.getReqId());
        int safeOffset = Math.max(0, offset);
        int safeLimit = Math.max(1, Math.min(100, limit));
        int total = taskMapper.countActiveByDemand(workspaceId, id);
        List<Task> items = total <= safeOffset ? new ArrayList<Task>()
                : demandMapper.selectDemandTasks(workspaceId, id, safeOffset, safeLimit);
        versionTaskMapper.enrichTasks(workspaceId, items);
        publications.enrichTasks(workspaceId, items);
        return com.hourglass.dto.PageResult.of(items, total, safeOffset, safeLimit);
    }

    /** 排期后二次确认的候选：需求名下、尚未绑定目标版本的工作项；只读，权限同需求详情。 */
    public com.hourglass.dto.PageResult<Task> versionTaskCandidates(String workspaceId, String userId, String id,
                                                                     String versionIdRaw, int offset, int limit) {
        Demand d = requireDemand(workspaceId, id);
        projectAccess.assertView(workspaceId, userId, d.getReqId());
        String versionId = Texts.trimToNull(versionIdRaw);
        if (versionId == null) {
            throw AppException.badRequest("请指定目标版本");
        }
        /* 只读路径不取写锁；前提与写入同口径，过期页面尽早失败 */
        if (!"plan".equals(d.getStatus())) {
            throw AppException.badRequest("只有已排期需求可以带入工作项");
        }
        if (!versionId.equals(d.getVersionId())) {
            throw AppException.conflict("目标版本与需求当前排期不一致，请刷新后重试");
        }
        ProjectVersion v = versionMapper.selectById(versionId);
        if (v == null || !workspaceId.equals(v.getWorkspaceId()) || !d.getReqId().equals(v.getReqId())) {
            throw AppException.badRequest("目标版本不存在或不属于该需求所在项目：" + versionId);
        }
        int safeOffset = Math.max(0, offset);
        int safeLimit = Math.max(1, Math.min(MAX_PAGE_SIZE, limit));
        /* 内容冻结与写入拒绝同口径：有成功正式发布即无可带入项，避免弹窗勾选后才报错 */
        if (taskMapper.hasVersionFormalRelease(workspaceId, versionId)) {
            return com.hourglass.dto.PageResult.of(new ArrayList<Task>(), 0, safeOffset, safeLimit);
        }
        int total = demandMapper.countVersionCandidates(workspaceId, id, versionId);
        List<Task> items = total <= safeOffset ? new ArrayList<Task>()
                : demandMapper.selectVersionCandidates(workspaceId, id, versionId, safeOffset, safeLimit);
        versionTaskMapper.enrichTasks(workspaceId, items);
        publications.enrichTasks(workspaceId, items);
        return com.hourglass.dto.PageResult.of(items, total, safeOffset, safeLimit);
    }

    /**
     * 排期带入：只允许写入需求当前目标版本，任务必须属于该需求；已绑定项跳过。
     * 批量操作仍逐条写 task_log，任何一项状态变化都会回滚整批。
     */
    @Transactional
    public Map<String, Object> bindVersionTasks(String userId, String workspaceId, String id,
                                                com.hourglass.dto.DemandVersionTaskRequest body) {
        Demand initial = requireDemand(workspaceId, id);
        projectAccess.assertView(workspaceId, userId, initial.getReqId());
        releasePermission.assertManageProject(userId, workspaceId, initial.getReqId());
        deliveryLock.lockProjects(workspaceId, initial.getReqId());
        Demand d = requireDemandForUpdate(workspaceId, id);
        if (!java.util.Objects.equals(initial.getReqId(), d.getReqId())) {
            throw AppException.conflict("需求所属项目已变更，请刷新后重试");
        }
        projectAccess.assertView(workspaceId, userId, d.getReqId());
        releasePermission.assertManageProjectForUpdate(userId, workspaceId, d.getReqId());
        if (!"plan".equals(d.getStatus())) {
            throw AppException.badRequest("只有已排期需求可以带入工作项");
        }
        String versionId = Texts.trimToNull(body == null ? null : body.getVersionId());
        if (versionId == null || !versionId.equals(d.getVersionId())) {
            throw AppException.conflict("目标版本与需求当前排期不一致，请刷新后重试");
        }
        ProjectVersion version = versionMapper.selectByIdForUpdate(workspaceId, versionId);
        if (version == null || !d.getReqId().equals(version.getReqId())) {
            throw AppException.badRequest("目标版本不存在或不属于该需求所在项目：" + versionId);
        }
        if ("released".equals(version.getStatus()) || version.getReleasedAt() != null
                || "closed".equals(version.getStatus()) || "canceled".equals(version.getStatus())) {
            throw AppException.badRequest("不能把工作项加入已发布、已关闭或已取消的版本");
        }
        if (!taskMapper.selectVersionFormalSuccessIdsForScope(workspaceId, versionId).isEmpty()) {
            throw AppException.badRequest("版本已有成功正式发布记录，内容成员关系已冻结");
        }
        java.util.LinkedHashSet<String> selected = new java.util.LinkedHashSet<String>();
        if (body != null && body.getTaskIds() != null) {
            for (String raw : body.getTaskIds()) {
                String taskId = Texts.trimToNull(raw);
                if (taskId != null) {
                    selected.add(taskId);
                }
            }
        }
        if (selected.isEmpty()) {
            throw AppException.badRequest("请选择要加入版本的工作项");
        }
        if (selected.size() > 500) {
            throw AppException.badRequest("单个版本最多关联 500 个工作项");
        }
        String reason = "需求「" + d.getTitle() + "」排期带入版本";
        /* 同批任务的版本集合高度重复：版本名只查一次，避免逐条审计放大查询 */
        Map<String, String> versionNameCache = new java.util.HashMap<String, String>();
        versionNameCache.put(versionId, version.getName());
        int added = 0;
        int skipped = 0;
        for (String taskId : selected) {
            Task task = deliveryLock.lockTask(workspaceId, taskId);
            if (task.getDeletedAt() != null || !d.getReqId().equals(task.getReqId())
                    || !id.equals(task.getDemandId())) {
                throw AppException.badRequest("工作项不存在、已删除或不属于该需求：" + taskId);
            }
            List<String> current = taskMapper.selectTaskVersionsForScope(workspaceId, taskId);
            if (current.contains(versionId)) {
                skipped++;
                continue;
            }
            if (versionTaskMapper.insertBatch(workspaceId, versionId,
                    java.util.Collections.singletonList(taskId)) != 1
                    || taskMapper.touchDeliveryRevision(workspaceId, taskId) != 1) {
                throw new AppException(409, "任务版本关系已变化，请刷新后重试");
            }
            List<String> after = new ArrayList<String>(current);
            after.add(versionId);
            java.util.Collections.sort(after);
            Map<String, Object> afterState = versionState(workspaceId, after, versionNameCache);
            afterState.put("inheritanceSource", "demand-batch");
            afterState.put("demandId", id);
            taskAudit.logChange(userId, workspaceId, taskId, "version_change",
                    "需求排期带入版本：" + version.getName(),
                    versionState(workspaceId, current, versionNameCache), afterState, reason);
            added++;
        }
        if (added > 0) {
            versionMapper.touchRevision(workspaceId, versionId);
        }
        Map<String, Object> out = new LinkedHashMap<String, Object>();
        out.put("versionId", versionId);
        out.put("versionName", version.getName());
        out.put("added", added);
        out.put("skipped", skipped);
        return out;
    }

    private Map<String, Object> versionState(String workspaceId, List<String> versionIds,
                                             Map<String, String> nameCache) {
        java.util.TreeSet<String> sorted = new java.util.TreeSet<String>(versionIds);
        List<String> names = new ArrayList<String>();
        for (String versionId : sorted) {
            String name = nameCache.get(versionId);
            if (name == null) {
                ProjectVersion v = versionMapper.selectById(versionId);
                name = v == null ? versionId : v.getName();
                nameCache.put(versionId, name);
            }
            names.add(name);
        }
        Map<String, Object> state = new LinkedHashMap<String, Object>();
        state.put("versionIds", new ArrayList<String>(sorted));
        state.put("versionNames", names);
        return state;
    }

    @Transactional
    public Demand create(String userId, String workspaceId, DemandSaveRequest req) {
        requireProject(workspaceId, reqIdOf(req));
        projectAccess.assertWrite(workspaceId, userId, reqIdOf(req));
        Demand d = new Demand();
        d.setId(Ids.gen("D"));
        d.setWorkspaceId(workspaceId);
        d.setReqId(reqIdOf(req));
        applyFields(d, req);
        d.setStatus("review");
        d.setCreatedBy(userId);
        d.setRevision(0L);
        insertWithNo(d);
        logChange(d, userId, "create", null, null, null);
        demandWatch.addWatchers(d, userId, req.getWatcherIds());
        if (d.getReviewerUserId() != null && !d.getReviewerUserId().equals(userId)) {
            notificationEvents.notifyLinked(d.getReviewerUserId(), workspaceId,
                    UserNotificationPreferenceService.DEMAND_STATUS,
                    "需求「" + d.getTitle() + "」指派你评审",
                    "请到「我的工作 → 待我评审」处理", "demand", d.getId(), d.getReqId());
        }
        return getVisible(workspaceId, userId, d.getId());
    }

    /**
     * 并发提需求会抢到同一个项目内编号，由唯一键 uk_demand_no 拒绝后重算重试。
     * 失败的 INSERT 不会让 InnoDB 事务失效，与工作项编号同一口径。
     * 取号走 number_seq（sql/87）：删除需求不回收编号，重试时序列继续前进。
     */
    private void insertWithNo(Demand d) {
        for (int attempt = 0; attempt < 3; attempt++) {
            d.setDemandNo(numberSeq.nextDemand(d.getWorkspaceId(), d.getReqId()));
            try {
                demandMapper.insert(d);
                return;
            } catch (org.springframework.dao.DuplicateKeyException e) {
                String message = e.getMessage();
                if (message == null || !message.contains("uk_demand_no")) {
                    throw e;
                }
            }
        }
        throw AppException.badRequest("需求编号生成冲突，请重试");
    }

    /**
     * 待评审可整单编辑；已通过 / 已排期只补录说明类内容；
     * 已完成允许补正文与优先级（标题、描述、模块、验收标准），但版本与计划日期仍由排期维护；
     * 已关闭需先恢复。
     * 编辑时可同时更换所属项目：与列表行内迁移同一套守卫（双方写权限、无目标版本与发布记录、
     * 工作项整体随迁、编号按目标项目重排）。
     */
    @Transactional
    public Demand update(String userId, String workspaceId, String id, DemandSaveRequest req) {
        Demand initial = requireDemand(workspaceId, id);
        projectAccess.assertView(workspaceId, userId, initial.getReqId());
        projectAccess.assertWrite(workspaceId, userId, initial.getReqId());
        String projectId = reqIdOf(req);
        Requirement targetProject = projectId.equals(initial.getReqId())
                ? null : requireMoveTarget(workspaceId, userId, projectId);
        if (targetProject == null) {
            requireProject(workspaceId, projectId);
            deliveryLock.lockProjects(workspaceId, initial.getReqId());
        } else {
            deliveryLock.lockProjects(workspaceId, initial.getReqId(), projectId);
            requireTargetOpenForUpdate(workspaceId, projectId);
        }
        Demand d = requireDemandForUpdate(workspaceId, id);
        projectAccess.assertWriteForUpdate(workspaceId, userId, d.getReqId());
        if (targetProject != null) {
            projectAccess.assertWriteForUpdate(workspaceId, userId, projectId);
        }
        requireRevision(d, req.getRevision(), true);
        boolean fullEdit = "review".equals(d.getStatus());
        if (!fullEdit) {
            requireQuickEditable(d);
        }
        List<Task> linkedTasks = java.util.Collections.emptyList();
        List<TestCase> linkedCases = java.util.Collections.emptyList();
        int docLinks = 0, releaseCount = 0;
        if (targetProject != null) {
            linkedTasks = requireMigratableTasks(d, workspaceId, id);
            linkedCases = caseMapper.selectByDemandForUpdate(workspaceId, id);
            docLinks = docMapper.countLinksByDemand(workspaceId, id);
            releaseCount = releases.selectDemandRecords(workspaceId, id).size();
        }
        if (!initial.getReqId().equals(d.getReqId())) {
            throw AppException.conflict("需求所属项目已变更，请刷新后重试");
        }
        Map<String, Object> before = snapshot(d);
        String oldReviewer = d.getReviewerUserId();
        String moveNote = null, oldProjectName = null, newProjectName = null;
        if (targetProject != null) {
            oldProjectName = projectName(d.getReqId());
            newProjectName = projectName(projectId);
            boolean categoryCleared = dropStaleCategory(req, workspaceId, projectId);
            moveNote = clearScheduleForMove(d)
                    + moveToProject(d, projectId, oldProjectName, newProjectName)
                    + (categoryCleared ? "；原分类不属于目标项目，已清空" : "");
        }
        if (fullEdit) {
            applyFields(d, req);
        } else {
            applyContentFields(d, req);
            if ("done".equals(d.getStatus())) {
                /* 完成态只放行文本类修正：标题与优先级可改，版本、计划日期与项目不动 */
                if (req.getTitle() != null) {
                    String title = Texts.trimToNull(req.getTitle());
                    if (title == null) {
                        throw AppException.badRequest("需求标题不能为空");
                    }
                    d.setTitle(Texts.cut(title, 80));
                }
                if (req.getPriority() != null) {
                    validatePriority(req.getPriority());
                    d.setPriority(req.getPriority());
                }
            }
        }
        save(d);
        /* 评审人是新增能力：只在创建 / 待评审整单编辑时变更，换人时定向通知 */
        if (fullEdit && !java.util.Objects.equals(oldReviewer, d.getReviewerUserId())
                && d.getReviewerUserId() != null && !d.getReviewerUserId().equals(userId)) {
            notificationEvents.notifyLinked(d.getReviewerUserId(), workspaceId,
                    UserNotificationPreferenceService.DEMAND_STATUS,
                    "需求「" + d.getTitle() + "」指派你评审",
                    "请到「我的工作 → 待我评审」处理", "demand", d.getId(), d.getReqId());
        }
        if (targetProject != null) {
            moveNote += moveLinkedTasks(userId, workspaceId, id, linkedTasks, projectId,
                    oldProjectName, newProjectName);
            moveNote += moveLinkedCases(workspaceId, linkedCases, projectId);
            if (docLinks > 0) {
                moveNote += "；关联文档 " + docLinks + " 份留在原项目";
            }
            if (releaseCount > 0) {
                moveNote += "；历史发布记录 " + releaseCount + " 条保留在原项目";
            }
        }
        /* 迁移与列表行内同一动作码，时间线不再出现「更新 / 变更所属项目」两种标签 */
        logChange(d, userId, targetProject != null ? "move" : "update", moveNote, null, before);
        if (targetProject != null) {
            notifyCreator(d, userId, "需求「" + d.getTitle() + "」所属项目已变更",
                    "从「" + oldProjectName + "」移至「" + newProjectName + "」");
        } else {
            notifyCreator(d, userId, "需求「" + d.getTitle() + "」已被编辑",
                    fullEdit ? "需求内容有更新（仍处于待评审）"
                            : "done".equals(d.getStatus())
                            ? "需求内容有更新（已完成，排期与交付证据未变）"
                            : "需求内容有更新（" + statusName(d.getStatus()) + "，标题与排期未变）");
        }
        return getVisible(workspaceId, userId, id);
    }

    /** 换项目：改归属并按目标项目重排项目内编号，返回时间线备注 */
    private String moveToProject(Demand d, String targetReqId, String oldName, String targetName) {
        Integer oldNo = d.getDemandNo();
        d.setReqId(targetReqId);
        d.setDemandNo(numberSeq.nextDemand(d.getWorkspaceId(), targetReqId));
        return "所属项目：" + oldName + " → " + targetName
                + (oldNo != null && oldNo > 0
                ? "；编号：" + Nos.demand(oldNo) + " → " + Nos.demand(d.getDemandNo()) : "");
    }

    /**
     * 迁移时整单保存会带上来旧项目的分类：直接置空并留一句说明，
     * 与列表行内迁移同口径，避免客户端拿到「分类不属于该项目」这种实现细节。
     */
    private boolean dropStaleCategory(DemandSaveRequest req, String workspaceId, String targetReqId) {
        String categoryId = Texts.trimToNull(req.getCategoryId());
        if (categoryId == null) {
            return false;
        }
        Category cat = categoryMapper.selectById(workspaceId, categoryId);
        if (cat != null && targetReqId.equals(cat.getProjectId())) {
            return false;
        }
        req.setCategoryId(null);
        return true;
    }

    private String projectName(String reqId) {
        Requirement r = reqMapper.selectById(reqId);
        return r == null || r.getName() == null ? reqId : r.getName();
    }

    /** 目标项目必须存在、未归档且当前用户可写；迁移前后都要做，避免越权把需求搬进只读项目 */
    private Requirement requireMoveTarget(String workspaceId, String userId, String targetReqId) {
        Requirement target = requireProject(workspaceId, targetReqId);
        if (target.getArchivedAt() != null) {
            throw AppException.badRequest("不能移入已归档项目");
        }
        projectAccess.assertView(workspaceId, userId, targetReqId);
        projectAccess.assertWrite(workspaceId, userId, targetReqId);
        return target;
    }

    /** 归档不抢交付锁：预检读可能早于并发归档提交，持锁后用当前读复查一次 */
    private void requireTargetOpenForUpdate(String workspaceId, String targetReqId) {
        Requirement target = reqMapper.selectByIdForUpdate(workspaceId, targetReqId);
        if (target == null) {
            throw AppException.notFound("项目不存在：" + targetReqId);
        }
        if (target.getArchivedAt() != null) {
            throw AppException.badRequest("不能移入已归档项目");
        }
    }

    /**
     * 更换所属项目前的只读预览：统计随迁与留存的关联，并复用迁移守卫给出阻断原因。
     * 前端用它在第二道确认里把影响讲清楚；不加锁，真正迁移时仍会按当前数据重新校验。
     */
    public DemandMovePreview previewMove(String userId, String workspaceId, String id, String targetReqIdRaw) {
        Demand d = requireDemand(workspaceId, id);
        projectAccess.assertView(workspaceId, userId, d.getReqId());
        projectAccess.assertWrite(workspaceId, userId, d.getReqId());
        String targetReqId = Texts.trimToNull(targetReqIdRaw);
        if (targetReqId == null) {
            throw AppException.badRequest("请选择目标项目");
        }
        if (targetReqId.equals(d.getReqId())) {
            throw AppException.badRequest("目标项目与当前所属项目相同");
        }
        Requirement target = requireMoveTarget(workspaceId, userId, targetReqId);
        DemandMovePreview p = new DemandMovePreview();
        p.setTargetReqId(targetReqId);
        p.setTargetName(target.getName() == null ? targetReqId : target.getName());
        if (!"review".equals(d.getStatus()) && !"pass".equals(d.getStatus())
                && !"plan".equals(d.getStatus())) {
            p.getBlockers().add("只有待评审、已通过或已排期的需求可以更换所属项目");
        }
        List<Task> linked = taskMapper.selectTasksByDemandForScope(workspaceId, id);
        for (Task t : linked) {
            if (t.getDeletedAt() != null) {
                p.setTrashedTasks(p.getTrashedTasks() + 1);
                continue;
            }
            if (!com.hourglass.common.Consts.COL_BACKLOG.equals(t.getBoardColumn())
                    && !com.hourglass.common.Consts.COL_CANCELED.equals(t.getBoardColumn())) {
                p.setStartedTasks(p.getStartedTasks() + 1);
            }
        }
        p.setTasks(linked.size() - p.getTrashedTasks());
        try {
            requireNoIrreversibleEvidence(linked, workspaceId);
        } catch (AppException e) {
            p.getBlockers().add(e.getMessage());
        }
        p.setCases(caseMapper.countByDemandRef(workspaceId, id));
        p.setPlanLinks(caseMapper.countPlanCasesByDemand(workspaceId, id));
        p.setDocLinks(docMapper.countLinksByDemand(workspaceId, id));
        p.setReleases(releases.selectDemandRecords(workspaceId, id).size());
        if (d.getVersionId() != null) {
            p.setVersionName(d.getVersionName() == null || d.getVersionName().isEmpty()
                    ? d.getVersionId() : d.getVersionName());
        }
        return p;
    }

    /**
     * 项目归属决定权限、模块和统计口径。需求下的工作项（含已开工）与主归口用例整体随迁；
     * 工作项上的版本绑定、用例关联与缺陷发现版本跨项目不成立，迁移时自动解除并留痕
     * （见 {@link #moveLinkedTasks}）；文档关联与历史发布记录保留在源项目。
     * 只有发布记录、冻结的版本成员关系与跨项目史诗子任务不能回退。
     */
    private List<Task> requireMigratableTasks(Demand d, String workspaceId, String id) {
        if (!"review".equals(d.getStatus()) && !"pass".equals(d.getStatus())
                && !"plan".equals(d.getStatus())) {
            throw AppException.badRequest("只有待评审、已通过或已排期的需求可以更换所属项目");
        }
        List<Task> linked = taskMapper.selectTasksByDemandForScope(workspaceId, id);
        requireNoIrreversibleEvidence(linked, workspaceId);
        return linked;
    }

    /** 目标版本属于源项目：迁移时按撤销排期处理（回已通过、清目标版本与计划日期） */
    private String clearScheduleForMove(Demand d) {
        if (d.getVersionId() == null) {
            return "";
        }
        String oldName = d.getVersionName() == null || d.getVersionName().isEmpty()
                ? d.getVersionId() : d.getVersionName();
        d.setStatus("pass");
        clearSchedule(d);
        return "；原排期已撤销（目标版本「" + oldName + "」不属于目标项目）";
    }

    /**
     * 级联迁移的唯一阻断项：工作项已有发布记录（含人工发布标记），或仍绑定在已关闭 / 已取消的版本上
     * （版本成员关系已冻结，解除会改写历史）；史诗仍有迁移集合之外的子任务时也不能迁。
     * 回收站工作项不构成交付事实，但仍随需求迁移，避免恢复后跨项目悬空。
     */
    private void requireNoIrreversibleEvidence(List<Task> linked, String workspaceId) {
        if (linked.isEmpty()) {
            return;
        }
        java.util.Set<String> linkedIds = new java.util.HashSet<String>();
        List<String> activeIds = new ArrayList<String>();
        for (Task t : linked) {
            linkedIds.add(t.getId());
            if (t.getDeletedAt() == null) {
                activeIds.add(t.getId());
            }
        }
        Map<String, String> blockers = new LinkedHashMap<String, String>();
        if (!activeIds.isEmpty()) {
            for (com.hourglass.dto.TaskMoveBlocker b : taskMapper.selectMoveBlockers(workspaceId, activeIds)) {
                String reason = moveBlockerText(b.getReason());
                if (reason == null) {
                    continue;
                }
                /* 同一工作项既有发布记录又在冻结版本里时，先报不可回退程度更高的发布记录 */
                if (com.hourglass.dto.TaskMoveBlocker.PUBLISH.equals(b.getReason())
                        || !blockers.containsKey(b.getTaskId())) {
                    blockers.put(b.getTaskId(), reason);
                }
            }
        }
        for (Task t : linked) {
            if (!"epic".equals(t.getItemType())) {
                continue;
            }
            for (String childId : taskMapper.selectEpicChildIdsForScope(workspaceId, t.getId())) {
                if (!linkedIds.contains(childId)) {
                    blockers.put(t.getId(), "史诗仍有其他子任务（含回收站）");
                    break;
                }
            }
        }
        if (blockers.isEmpty()) {
            return;
        }
        Task first = null;
        for (Task t : linked) {
            if (blockers.containsKey(t.getId())) {
                first = t;
                break;
            }
        }
        String title = first == null || first.getTitle() == null ? "" : first.getTitle();
        throw AppException.badRequest("工作项「" + title + "」" + blockers.get(first.getId())
                + "，不能随需求迁移；请先处理后再更换所属项目");
    }

    private String moveBlockerText(String reason) {
        if (com.hourglass.dto.TaskMoveBlocker.PUBLISH.equals(reason)) {
            return "已有发布记录或人工发布标记";
        }
        if (com.hourglass.dto.TaskMoveBlocker.FROZEN.equals(reason)) {
            return "仍绑定已关闭或已取消的版本（成员关系已冻结）";
        }
        return null;
    }

    /**
     * 需求迁移时把关联工作项（含已开工与回收站）一并挪到目标项目：按目标项目重排编号，清掉不属于
     * 目标项目的分类，解除跨项目的 Epic 归属与文档引用；版本绑定与缺陷发现版本跨项目不成立，一并解除
     * 并在工作项时间线留痕。主归口用例随迁时验证关联保持，其余用例的关联在这里解除。
     * 工时记录跟着工作项走，统计口径随之转移。
     */
    private String moveLinkedTasks(String userId, String workspaceId, String demandId, List<Task> linked,
                                   String targetReqId, String oldName, String targetName) {
        if (linked.isEmpty()) {
            return "";
        }
        java.util.Set<String> moving = new java.util.HashSet<String>();
        List<String> movingIds = new ArrayList<String>();
        for (Task t : linked) {
            moving.add(t.getId());
            movingIds.add(t.getId());
        }
        /* 解除前先取关系快照：逐项时间线要说清楚解除了哪些版本、几条用例 */
        Map<String, List<String>> versionsByTask = new LinkedHashMap<String, List<String>>();
        for (com.hourglass.dto.TaskVersionBinding row
                : versionTaskMapper.selectVersionRowsByTaskIds(workspaceId, movingIds)) {
            List<String> names = versionsByTask.get(row.getTaskId());
            if (names == null) {
                names = new ArrayList<String>();
                versionsByTask.put(row.getTaskId(), names);
            }
            names.add(row.getVersionName() == null || row.getVersionName().isEmpty()
                    ? row.getVersionId() : row.getVersionName());
        }
        /* 主归口用例会随需求一起迁移，它们的验证关联保持有效；只有仍留在原项目的用例才需要解除 */
        Map<String, Integer> strayCaseByTask = new LinkedHashMap<String, Integer>();
        for (com.hourglass.dto.CaseTaskLink link : caseTaskMapper.selectLinksByTaskIds(workspaceId, movingIds)) {
            if (demandId.equals(link.getDemandId())) {
                continue;
            }
            Integer count = strayCaseByTask.get(link.getTaskId());
            strayCaseByTask.put(link.getTaskId(), count == null ? 1 : count + 1);
        }
        int categoryCleared = 0, epicCleared = 0, docCleared = 0;
        int versionDetached = 0, caseDetached = 0, foundVersionCleared = 0;
        for (Task t : linked) {
            String oldNo = Nos.workItem(t.getItemNo());
            StringBuilder detail = new StringBuilder("随需求迁移：所属项目「")
                    .append(oldName).append("」→「").append(targetName).append("」");
            String categoryId = Texts.trimToNull(t.getCategoryId());
            if (categoryId != null) {
                Category cat = categoryMapper.selectById(workspaceId, categoryId);
                if (cat == null || !targetReqId.equals(cat.getProjectId())) {
                    t.setCategoryId("");
                    categoryCleared++;
                }
            }
            if (t.getEpicId() != null && !moving.contains(t.getEpicId())) {
                t.setEpicId(null);
                epicCleared++;
            }
            if (t.getReqDocId() != null) {
                /* 文档挂在源项目，跨项目引用不成立：与单条工作项换项目时「旧文档自动失效」同一语义 */
                t.setReqDocId(null);
                docCleared++;
            }
            List<String> boundVersions = versionsByTask.get(t.getId());
            if (boundVersions != null && !boundVersions.isEmpty()) {
                detail.append("；解除版本关联：").append(String.join("、", boundVersions));
                versionDetached += boundVersions.size();
            }
            Integer caseCount = strayCaseByTask.get(t.getId());
            if (caseCount != null && caseCount > 0) {
                detail.append("；解除原项目用例关联 ").append(caseCount).append(" 条");
                caseDetached += caseCount;
            }
            if (t.getFoundVersionId() != null) {
                ProjectVersion found = versionMapper.selectById(t.getFoundVersionId());
                String foundName = found == null || found.getName() == null
                        ? t.getFoundVersionId() : found.getName();
                detail.append("；清空缺陷发现版本「").append(foundName).append("」（不属于目标项目）");
                t.setFoundVersionId(null);
                foundVersionCleared++;
            }
            t.setReqId(targetReqId);
            t.setVersionCheck(null);
            if (TaskSupport.updateWithNo(taskMapper, t) != 1) {
                throw AppException.conflict("工作项「" + t.getTitle() + "」已被其他人修改，请刷新后重试");
            }
            String newNo = Nos.workItem(t.getItemNo());
            if (!newNo.isEmpty()) {
                detail.append("；编号 ").append(oldNo.isEmpty() ? "未取号" : oldNo).append("→").append(newNo);
            }
            taskAudit.log(userId, workspaceId, t.getId(), "update", Texts.cut(detail.toString(), 250));
        }
        /* 关系行统一批量解除：此时已确认没有发布记录与冻结版本，删除不会改写历史 */
        if (versionDetached > 0) {
            versionTaskMapper.deleteByTaskIds(workspaceId, movingIds);
        }
        if (caseDetached > 0) {
            caseTaskMapper.deleteLinksByTaskIdsExcludingDemand(workspaceId, movingIds, demandId);
        }
        StringBuilder note = new StringBuilder("；随迁 " + linked.size() + " 项工作项");
        if (versionDetached > 0) {
            note.append("（解除 ").append(versionDetached).append(" 条版本关联）");
        }
        if (caseDetached > 0) {
            note.append("（解除 ").append(caseDetached).append(" 条原项目用例关联）");
        }
        if (foundVersionCleared > 0) {
            note.append("（清空 ").append(foundVersionCleared).append(" 项缺陷发现版本）");
        }
        if (categoryCleared > 0) {
            note.append("（").append(categoryCleared).append(" 项分类不属于目标项目，已清空）");
        }
        if (epicCleared > 0) {
            note.append("（").append(epicCleared).append(" 项解除原 Epic 归属）");
        }
        if (docCleared > 0) {
            note.append("（").append(docCleared).append(" 项解除原文档关联）");
        }
        return note.toString();
    }

    /**
     * 用例的主归口是需求：需求换项目时，挂在它名下的用例一并换项目并按目标项目重新取号。
     * 原项目的目录节点与测试计划圈选不属于目标项目：目录回到未归类，计划圈选解除，均写入需求时间线。
     */
    private String moveLinkedCases(String workspaceId, List<TestCase> cases, String targetReqId) {
        if (cases.isEmpty()) {
            return "";
        }
        List<String> caseIds = new ArrayList<String>();
        for (TestCase c : cases) {
            caseIds.add(c.getId());
        }
        int moduleCleared = 0;
        for (TestCase c : cases) {
            c.setReqId(targetReqId);
            c.setCaseNo(numberSeq.nextCase(workspaceId, targetReqId));
            if (c.getModuleId() != null) {
                Category cat = categoryMapper.selectById(workspaceId, c.getModuleId());
                if (cat == null || !targetReqId.equals(cat.getProjectId())) {
                    c.setModuleId(null);
                    c.setModule(null);
                    moduleCleared++;
                }
            }
            if (caseMapper.update(c) != 1) {
                throw AppException.conflict("用例「" + c.getTitle() + "」已被其他人修改，请刷新后重试");
            }
        }
        int planDetached = caseMapper.deletePlanCasesByCaseIds(caseIds);
        StringBuilder note = new StringBuilder("；随迁 ").append(cases.size()).append(" 条用例并重新取号");
        if (planDetached > 0) {
            note.append("（解除 ").append(planDetached).append(" 条测试计划圈选）");
        }
        if (moduleCleared > 0) {
            note.append("（").append(moduleCleared).append(" 条用例目录不属于目标项目，已清空）");
        }
        return note.toString();
    }

    /** 列表行内编辑：优先级不推进状态，未关闭且仍有项目写权限即可改。 */
    @Transactional
    public Demand quickPriority(String userId, String workspaceId, String id, DemandActionRequest body) {
        Demand d = writableDemandForQuick(userId, workspaceId, id, body);
        requireQuickEditable(d);
        String priority = body == null ? null : Texts.trimToNull(body.getPriority());
        if (priority == null) {
            throw AppException.badRequest("请选择优先级");
        }
        validatePriority(priority);
        if (priority.equals(d.getPriority())) {
            return getVisible(workspaceId, userId, id);
        }
        String old = d.getPriority() == null ? "未设置" : d.getPriority();
        Map<String, Object> before = snapshot(d);
        d.setPriority(priority);
        save(d);
        logChange(d, userId, "priority", "优先级：" + old + " → " + priority, null, before);
        demandWatch.notifyWatchers(d, userId, UserNotificationPreferenceService.DEMAND_WATCH,
                "需求「" + d.getTitle() + "」优先级已调整", old + " → " + priority, null);
        return getVisible(workspaceId, userId, id);
    }

    /** 列表行内编辑：期望交付可清空，同样不推进状态；已完成需求不再调整交付承诺。 */
    @Transactional
    public Demand quickExpectDate(String userId, String workspaceId, String id, DemandActionRequest body) {
        Demand d = writableDemandForQuick(userId, workspaceId, id, body);
        requireQuickEditable(d);
        if ("done".equals(d.getStatus())) {
            throw AppException.badRequest("已完成需求不能直接修改期望交付");
        }
        LocalDate expectDate = body == null ? null : body.getExpectDate();
        if (java.util.Objects.equals(expectDate, d.getExpectDate())) {
            return getVisible(workspaceId, userId, id);
        }
        String old = d.getExpectDate() == null ? "未设置" : d.getExpectDate().toString();
        String next = expectDate == null ? "已清空" : expectDate.toString();
        Map<String, Object> before = snapshot(d);
        d.setExpectDate(expectDate);
        save(d);
        logChange(d, userId, "expect", "期望交付：" + old + " → " + next, null, before);
        demandWatch.notifyWatchers(d, userId, UserNotificationPreferenceService.DEMAND_WATCH,
                "需求「" + d.getTitle() + "」期望交付已调整", old + " → " + next, null);
        return getVisible(workspaceId, userId, id);
    }

    /** 列表行内编辑：目标版本跟随排期权限，只允许已排期需求调整，版本仍需同项目且未发布。 */
    @Transactional
    public Demand quickVersion(String userId, String workspaceId, String id, DemandActionRequest body) {
        Demand initial = requireDemand(workspaceId, id);
        projectAccess.assertView(workspaceId, userId, initial.getReqId());
        releasePermission.assertManageProject(userId, workspaceId, initial.getReqId());
        deliveryLock.lockProjects(workspaceId, initial.getReqId());
        Demand d = requireDemandForUpdate(workspaceId, id);
        if (!java.util.Objects.equals(initial.getReqId(), d.getReqId())) {
            throw AppException.conflict("需求所属项目已变更，请刷新后重试");
        }
        projectAccess.assertView(workspaceId, userId, d.getReqId());
        releasePermission.assertManageProjectForUpdate(userId, workspaceId, d.getReqId());
        requireRevision(d, body == null ? null : body.getRevision(), true);
        if (!"plan".equals(d.getStatus())) {
            throw AppException.badRequest("只有已排期需求可以调整目标版本");
        }
        String versionId = body == null ? null : Texts.trimToNull(body.getVersionId());
        ProjectVersion target = null;
        if (versionId != null) {
            target = demandMapper.selectScheduleVersion(workspaceId, d.getReqId(), versionId);
            if (target == null || !workspaceId.equals(target.getWorkspaceId())
                    || !d.getReqId().equals(target.getReqId())) {
                throw AppException.badRequest("目标版本不存在或不属于该需求所在项目：" + versionId);
            }
            if ("released".equals(target.getStatus()) || target.getReleasedAt() != null
                    || "closed".equals(target.getStatus()) || "canceled".equals(target.getStatus())) {
                throw AppException.badRequest("不能选择已发布、已关闭或已取消的版本");
            }
        }
        if (java.util.Objects.equals(versionId, d.getVersionId())) {
            return getVisible(workspaceId, userId, id);
        }
        /* 换 / 清目标版本属于调期，原因必填，与 replan 留痕口径一致 */
        String reason = requireReason(body, "replan");
        String oldName = d.getVersionName() != null ? d.getVersionName()
                : (d.getVersionId() == null ? "未指定" : d.getVersionId());
        String nextName = target == null ? "未指定" : target.getName();
        Map<String, Object> before = snapshot(d);
        d.setVersionId(versionId);
        d.setVersionName(target == null ? null : target.getName());
        d.setReviewNote(reason);
        save(d);
        logChange(d, userId, "version", "目标版本：" + oldName + " → " + nextName, reason, before);
        notifyStatus(d, userId, "目标版本已调整", "目标版本：" + nextName + "；" + reason);
        return getVisible(workspaceId, userId, id);
    }

    /**
     * 列表行内更换所属项目：待评审 / 已通过 / 已排期的需求可迁移，关联工作项（含已开工）一次级联迁移。
     * 需求级文档 / 用例 / 发布记录、目标版本，以及工作项级发布记录与冻结版本成员关系仍阻断。
     */
    @Transactional
    public Demand move(String userId, String workspaceId, String id, DemandActionRequest body) {
        Demand initial = requireDemand(workspaceId, id);
        projectAccess.assertView(workspaceId, userId, initial.getReqId());
        projectAccess.assertWrite(workspaceId, userId, initial.getReqId());
        String targetReqId = body == null ? null : Texts.trimToNull(body.getReqId());
        if (targetReqId == null) {
            throw AppException.badRequest("请选择目标项目");
        }
        if (targetReqId.equals(initial.getReqId())) {
            return getVisible(workspaceId, userId, id);
        }
        requireMoveTarget(workspaceId, userId, targetReqId);
        deliveryLock.lockProjects(workspaceId, initial.getReqId(), targetReqId);
        requireTargetOpenForUpdate(workspaceId, targetReqId);
        Demand d = requireDemandForUpdate(workspaceId, id);
        if (!java.util.Objects.equals(initial.getReqId(), d.getReqId())) {
            throw AppException.conflict("需求所属项目已变更，请刷新后重试");
        }
        projectAccess.assertWriteForUpdate(workspaceId, userId, d.getReqId());
        projectAccess.assertWriteForUpdate(workspaceId, userId, targetReqId);
        requireRevision(d, body == null ? null : body.getRevision(), true);
        List<Task> linkedTasks = requireMigratableTasks(d, workspaceId, id);
        List<TestCase> linkedCases = caseMapper.selectByDemandForUpdate(workspaceId, id);
        int docLinks = docMapper.countLinksByDemand(workspaceId, id);
        int releaseCount = releases.selectDemandRecords(workspaceId, id).size();
        Category category = d.getCategoryId() == null ? null : categoryMapper.selectById(workspaceId, d.getCategoryId());
        boolean categoryCleared = d.getCategoryId() != null
                && (category == null || !targetReqId.equals(category.getProjectId()));
        Requirement oldProject = reqMapper.selectById(d.getReqId());
        String oldName = oldProject == null || oldProject.getName() == null ? d.getReqId() : oldProject.getName();
        String targetName = projectName(targetReqId);
        Integer oldNo = d.getDemandNo();
        Map<String, Object> before = snapshot(d);
        String scheduleNote = clearScheduleForMove(d);
        d.setReqId(targetReqId);
        d.setDemandNo(numberSeq.nextDemand(workspaceId, targetReqId));
        if (categoryCleared) {
            d.setCategoryId(null);
        }
        Long oldRevision = d.getRevision();
        if (demandMapper.updateProject(d) != 1) {
            throw AppException.conflict("需求已被其他人修改，请刷新后重试");
        }
        d.setRevision(oldRevision + 1);
        String taskNote = moveLinkedTasks(userId, workspaceId, id, linkedTasks, targetReqId, oldName, targetName)
                + moveLinkedCases(workspaceId, linkedCases, targetReqId)
                + (docLinks > 0 ? "；关联文档 " + docLinks + " 份留在原项目" : "")
                + (releaseCount > 0 ? "；历史发布记录 " + releaseCount + " 条保留在原项目" : "");
        logChange(d, userId, "move", "所属项目：" + oldName + " → " + targetName
                + (categoryCleared ? "；原分类不属于目标项目，已清空" : "")
                + scheduleNote
                + (oldNo != null && oldNo > 0
                ? "；编号：" + Nos.demand(oldNo) + " → " + Nos.demand(d.getDemandNo()) : "")
                + taskNote, null, before);
        notifyCreator(d, userId, "需求「" + d.getTitle() + "」所属项目已变更",
                "从「" + oldName + "」移至「" + targetName + "」");
        return getVisible(workspaceId, userId, id);
    }

    private Demand writableDemandForQuick(String userId, String workspaceId, String id, DemandActionRequest body) {
        Demand d = requireDemand(workspaceId, id);
        projectAccess.assertView(workspaceId, userId, d.getReqId());
        projectAccess.assertWrite(workspaceId, userId, d.getReqId());
        requireRevision(d, body == null ? null : body.getRevision(), true);
        return d;
    }

    private void requireQuickEditable(Demand d) {
        if (!"review".equals(d.getStatus()) && !"pass".equals(d.getStatus())
                && !"plan".equals(d.getStatus()) && !"done".equals(d.getStatus())) {
            throw AppException.badRequest("已关闭的需求不能直接修改，请先恢复");
        }
    }

    @Transactional
    public Demand pass(String userId, String workspaceId, String id, DemandActionRequest body) {
        Demand d = reviewDemand(userId, workspaceId, id, body);
        requireStatus(d, "review", "pass");
        Map<String, Object> before = snapshot(d);
        d.setStatus("pass");
        d.setCloseReason(null);
        d.setCloseStage(null);
        d.setReviewNote(Texts.cut(Texts.trimToNull(noteOf(body)), 500));
        save(d);
        logChange(d, userId, "pass", d.getReviewNote(), d.getReviewNote(), before);
        notifyStatus(d, userId, "评审通过", d.getReviewNote());
        return getVisible(workspaceId, userId, id);
    }

    @Transactional
    public Demand reject(String userId, String workspaceId, String id, DemandActionRequest body) {
        Demand d = reviewDemand(userId, workspaceId, id, body);
        requireStatus(d, "review", "rej");
        Map<String, Object> before = snapshot(d);
        String note = Texts.trimToNull(noteOf(body));
        if (note == null) {
            throw AppException.badRequest("请填写拒绝原因");
        }
        d.setStatus("closed");
        d.setCloseReason("rej");
        d.setCloseStage("review");
        d.setReviewNote(Texts.cut(note, 500));
        save(d);
        logChange(d, userId, "rej", d.getReviewNote(), d.getReviewNote(), before);
        notifyStatus(d, userId, "评审拒绝", d.getReviewNote());
        return getVisible(workspaceId, userId, id);
    }

    /**
     * 认领评审：把「待评审且未指派」的需求写成本人评审。
     * 不走整单 update，避免这次操作顺带覆盖 description/reviewNote 等字段；
     * 状态与“未指派”都放进 SQL 条件，并发认领只有一人成功，其余按冲突提示刷新。
     */
    @Transactional
    public Demand claimReview(String userId, String workspaceId, String id) {
        Demand d = requireDemand(workspaceId, id);
        projectAccess.assertView(workspaceId, userId, d.getReqId());
        projectAccess.assertWrite(workspaceId, userId, d.getReqId());
        if (!"review".equals(d.getStatus())) {
            throw AppException.badRequest("只有待评审的需求可以认领，当前状态：" + statusName(d.getStatus()));
        }
        if (userId.equals(d.getCreatedBy())) {
            throw AppException.badRequest("不能认领自己提交的需求");
        }
        if (d.getReviewerUserId() != null) {
            /* 重复认领按成功返回，避免用户双击后看到“已有人认领”的假冲突 */
            if (d.getReviewerUserId().equals(userId)) {
                return getVisible(workspaceId, userId, id);
            }
            throw AppException.conflict("该需求已有评审人，请刷新后重试");
        }
        Map<String, Object> before = snapshot(d);
        if (demandMapper.claimReviewer(workspaceId, id, userId) != 1) {
            throw AppException.conflict("需求状态或评审人已变化，请刷新后重试");
        }
        Demand claimed = requireDemand(workspaceId, id);
        logChange(claimed, userId, "claim", "认领评审", null, before);
        notifyCreator(claimed, userId, "需求「" + claimed.getTitle() + "」已有评审人",
                "评审人已认领，需求继续停留在待评审；你可在需求详情查看进度");
        return getVisible(workspaceId, userId, id);
    }

    /** 首次排期只变更需求目标，不修改关联任务的日期或版本。 */
    @Transactional
    public Demand plan(String userId, String workspaceId, String id, DemandActionRequest body) {
        return schedule(userId, workspaceId, id, body, false);
    }

    /** 调期仍保持 plan；日期可清空，原因必填。 */
    @Transactional
    public Demand replan(String userId, String workspaceId, String id, DemandActionRequest body) {
        return schedule(userId, workspaceId, id, body, true);
    }

    private Demand schedule(String userId, String workspaceId, String id, DemandActionRequest body, boolean replan) {
        Demand d = scheduleDemand(userId, workspaceId, id, body);
        String action = replan ? "replan" : "plan";
        requireStatus(d, replan ? "plan" : "pass", action);
        String reason = replan ? requireReason(body, action) : Texts.cut(Texts.trimToNull(noteOf(body)), 500);
        String versionId = Texts.trimToNull(body.getVersionId());
        ProjectVersion v = null;
        if (versionId != null) {
            v = demandMapper.selectScheduleVersion(workspaceId, d.getReqId(), versionId);
            if (v == null || !workspaceId.equals(v.getWorkspaceId()) || !d.getReqId().equals(v.getReqId())) {
                throw AppException.badRequest("目标版本不存在或不属于该需求所在项目：" + versionId);
            }
            if ("released".equals(v.getStatus()) || v.getReleasedAt() != null
                    || "closed".equals(v.getStatus()) || "canceled".equals(v.getStatus())) {
                throw AppException.badRequest("不能排入已发布、已关闭或已取消的版本");
            }
        }
        validateDates(body.getPlannedStart(), body.getPlannedEnd());
        validatePriority(body.getPriority());
        Map<String, Object> before = snapshot(d);
        d.setStatus("plan");
        d.setVersionId(versionId);
        d.setVersionName(v == null ? null : v.getName());
        d.setPlannedStart(body.getPlannedStart());
        d.setPlannedEnd(body.getPlannedEnd());
        if (body.getPriority() != null) {
            d.setPriority(body.getPriority());
        }
        if (body.getExpectDate() != null) {
            d.setExpectDate(body.getExpectDate());
        }
        d.setReviewNote(reason);
        save(d);
        String text = (v == null ? (replan ? "调整排期，目标未指定" : "已排期，目标未指定")
                : (replan ? "调整排期" : "排入版本") + " " + v.getName())
                + (reason == null ? "" : "：" + reason);
        logChange(d, userId, action, text, reason, before);
        notifyStatus(d, userId, replan ? "已调期" : "已排期", (v == null ? "目标未指定" : "目标版本：" + v.getName())
                + (reason == null ? "" : "；" + reason));
        return getVisible(workspaceId, userId, id);
    }

    /** 撤回评审：已通过 → 待评审（审批点错了可退回重评） */
    @Transactional
    public Demand unpass(String userId, String workspaceId, String id, DemandActionRequest body) {
        Demand d = reviewDemand(userId, workspaceId, id, body);
        requireStatus(d, "pass", "unpass");
        Map<String, Object> before = snapshot(d);
        d.setStatus("review");
        d.setReviewNote(Texts.cut(Texts.trimToNull(noteOf(body)), 500));
        save(d);
        logChange(d, userId, "unpass", d.getReviewNote(), d.getReviewNote(), before);
        notifyStatus(d, userId, "撤回评审", d.getReviewNote());
        return getVisible(workspaceId, userId, id);
    }

    /** 撤排清需求计划，不自动修改任务。 */
    @Transactional
    public Demand unplan(String userId, String workspaceId, String id, DemandActionRequest body) {
        Demand d = scheduleDemand(userId, workspaceId, id, body);
        requireStatus(d, "plan", "unplan");
        String reason = requireReason(body, "unplan");
        Map<String, Object> before = snapshot(d);
        String oldVersionName = d.getVersionName() == null ? d.getVersionId() : d.getVersionName();
        d.setStatus("pass");
        clearSchedule(d);
        d.setReviewNote(reason);
        save(d);
        logChange(d, userId, "unplan", "撤销排期"
                + (oldVersionName == null ? "" : "（原版本 " + oldVersionName + "）")
                + "：" + reason, reason, before);
        notifyStatus(d, userId, "撤销排期", "需求已退回已通过，可重新选择目标版本；关联任务不变");
        return getVisible(workspaceId, userId, id);
    }

    /** 关闭不级联任务；保留原目标，恢复到已通过时必须重新排期。已完成只能由证据失效自动退回，不能直接关闭。 */
    @Transactional
    public Demand cancel(String userId, String workspaceId, String id, DemandActionRequest body) {
        Demand d = scheduleDemand(userId, workspaceId, id, body);
        if ("done".equals(d.getStatus())) {
            throw AppException.badRequest("已完成需求不能直接关闭；完成状态由证据自动判定，"
                    + "需先撤回证据（工作项重开、用例失败或发布回滚）让需求退回已排期");
        }
        if (!"review".equals(d.getStatus()) && !"pass".equals(d.getStatus())
                && !"plan".equals(d.getStatus()) && !"rej".equals(d.getStatus())) {
            throw AppException.badRequest("只有有效状态的需求可以关闭");
        }
        String reason = requireReason(body, "cancel");
        String closeReason = body == null ? null : Texts.trimToNull(body.getCloseReason());
        if (closeReason == null) {
            closeReason = "cancel";
        }
        Map<String, Object> before = snapshot(d);
        d.setCloseStage("rej".equals(d.getStatus()) ? "review" : d.getStatus());
        d.setStatus("closed");
        d.setCloseReason(closeReason);
        d.setReviewNote(reason);
        save(d);
        logChange(d, userId, "cancel", "关闭需求：" + reason, reason, before);
        notifyStatus(d, userId, "已关闭", "原因：" + reason + "；关联任务不变");
        return getVisible(workspaceId, userId, id);
    }

    @Transactional
    public Demand restore(String userId, String workspaceId, String id, DemandActionRequest body) {
        Demand d = scheduleDemand(userId, workspaceId, id, body);
        requireStatus(d, "closed", "restore");
        String reason = requireReason(body, "restore");
        Map<String, Object> before = snapshot(d);
        String target = "review".equals(d.getCloseStage()) ? "review" : "pass";
        d.setStatus(target);
        d.setCloseReason(null);
        d.setCloseStage(null);
        if ("pass".equals(target)) {
            clearSchedule(d);
        }
        d.setReviewNote(reason);
        save(d);
        logChange(d, userId, "restore", "恢复需求：" + reason, reason, before);
        notifyStatus(d, userId, "已恢复", "需求回到" + statusName(target)
                + ("pass".equals(target) ? "，请重新排期" : "") + "；关联任务不变");
        return getVisible(workspaceId, userId, id);
    }

    private void clearSchedule(Demand d) {
        d.setVersionId(null);
        d.setVersionName(null);
        d.setPlannedStart(null);
        d.setPlannedEnd(null);
    }

    /** 兼容原评审重开入口：评审不通过的关闭需求回到待评审。 */
    @Transactional
    public Demand reopen(String userId, String workspaceId, String id, DemandActionRequest body) {
        Demand d = reviewDemand(userId, workspaceId, id, body);
        requireStatus(d, "closed", "reopen");
        if (!"rej".equals(d.getCloseReason())) {
            throw AppException.badRequest("只有评审不通过的需求可以重新打开");
        }
        Map<String, Object> before = snapshot(d);
        d.setStatus("review");
        d.setCloseReason(null);
        d.setCloseStage(null);
        d.setReviewNote(Texts.cut(Texts.trimToNull(noteOf(body)), 500));
        save(d);
        logChange(d, userId, "reopen", d.getReviewNote(), d.getReviewNote(), before);
        notifyStatus(d, userId, "重新打开", d.getReviewNote());
        return getVisible(workspaceId, userId, id);
    }

    @Transactional
    public void delete(String userId, String workspaceId, String id) {
        Demand observed = requireDemand(workspaceId, id);
        // 与任务改绑/发布同序：项目互斥锁 → 按 ID 锁关联任务 → 当前读需求。
        deliveryLock.lockProjects(workspaceId, observed.getReqId());
        List<Task> linkedTasks = taskMapper.selectTasksByDemandForScope(workspaceId, id);
        Demand d = requireDemandForUpdate(workspaceId, id);
        if (!java.util.Objects.equals(observed.getReqId(), d.getReqId())
                || !java.util.Objects.equals(observed.getRevision(), d.getRevision())) {
            throw AppException.conflict("需求已被其他人修改，请刷新后重试");
        }
        projectAccess.assertWriteForUpdate(workspaceId, userId, d.getReqId());
        if (!releases.selectDemandRecords(workspaceId, id).isEmpty()) {
            throw AppException.badRequest("需求已有正式发布历史，不能删除，请保留或取消以维护历史证据");
        }
        /* 关注行随需求一起删除，收件人必须在清表前取出，否则删完就找不到该通知谁 */
        List<String> watcherIds = demandWatch.watcherIds(workspaceId, id);
        deletionTrace.recordDelete(workspaceId, userId, "demand_delete", "demand", id, d.getTitle(),
                "删除需求「" + d.getTitle() + "」（"
                        + (d.getReqId() == null ? "未归属项目" : "项目 " + d.getReqId())
                        + "；解除 " + linkedTasks.size() + " 项任务关联，需求流转日志一并清理）");
        attachmentService.deleteByTarget(workspaceId, id, AttachmentService.KIND_DEMAND);
        mailDeliveryMapper.deleteByReferenceIds(java.util.Collections.singletonList(id));
        docMapper.deleteDemandLinksByDemand(workspaceId, id);
        /* 工作项失去需求归口后，用例—工作项关联也不再成立；必须在解绑任务前按 demand_id 清理 */
        caseTaskMapper.deleteByDemand(workspaceId, id);
        /* 需求没了，任务上的 demand_id 必须一起解绑，否则编辑任务会被"关联需求不存在"拦住 */
        taskMapper.clearDemandRef(workspaceId, id);
        java.util.List<String> affectedTaskIds = new java.util.ArrayList<String>(linkedTasks.size());
        for (Task t : linkedTasks) {
            affectedTaskIds.add(t.getId());
        }
        deletionTrace.logTaskCascade(workspaceId, userId, affectedTaskIds,
                "关联需求「" + d.getTitle() + "」已删除，自动解除关联");
        /* 测试用例上的选填关联同样解绑 */
        caseMapper.clearDemandRefs(workspaceId, id);
        /* 条目本身要删，留着它自己的流转日志只会变成查不到主人的孤儿行 */
        demandMapper.deleteLogsByDemand(workspaceId, id);
        judgementMapper.deleteByDemand(workspaceId, id);
        demandCommentMapper.deleteByDemand(workspaceId, id);
        /* 评论行已清空，评论上的附件失去宿主：按失主清理（记录随事务，文件提交后删） */
        attachmentService.deleteOrphanDemandCommentAttachments(workspaceId);
        demandWatch.clear(workspaceId, id);
        demandMapper.deleteById(workspaceId, id);
        /* 需求已硬删除：通知不带详情深链，避免通知中心点开一片空白 */
        String title = "需求「" + d.getTitle() + "」已被删除";
        String body = "需求已从需求池删除，关联任务已解绑";
        java.util.Set<String> notified = new java.util.HashSet<String>();
        if (d.getCreatedBy() != null && !d.getCreatedBy().equals(userId)) {
            notificationEvents.notifyLinked(d.getCreatedBy(), workspaceId,
                    UserNotificationPreferenceService.DEMAND_STATUS, title, body,
                    null, null, d.getReqId());
            notified.add(d.getCreatedBy());
        }
        demandWatch.notifyWatchers(watcherIds, d, userId,
                UserNotificationPreferenceService.DEMAND_WATCH, title, body, notified, false);
    }

    /* ------------------------------------------------------------------ */

    private Demand reviewDemand(String userId, String workspaceId, String id, DemandActionRequest body) {
        Demand d = requireDemand(workspaceId, id);
        projectAccess.assertView(workspaceId, userId, d.getReqId());
        projectAccess.assertWrite(workspaceId, userId, d.getReqId());
        // 老评审调用可不带 revision；SQL 始终使用读取到的旧值做 CAS。
        requireRevision(d, body == null ? null : body.getRevision(), false);
        return d;
    }

    private Demand scheduleDemand(String userId, String workspaceId, String id, DemandActionRequest body) {
        Demand initial = requireDemand(workspaceId, id);
        projectAccess.assertView(workspaceId, userId, initial.getReqId());
        releasePermission.assertManageProject(userId, workspaceId, initial.getReqId());
        deliveryLock.lockProjects(workspaceId, initial.getReqId());
        Demand d = requireDemandForUpdate(workspaceId, id);
        if (!java.util.Objects.equals(initial.getReqId(), d.getReqId())) {
            throw AppException.conflict("需求所属项目已变更，请刷新后重试");
        }
        projectAccess.assertView(workspaceId, userId, d.getReqId());
        releasePermission.assertManageProjectForUpdate(userId, workspaceId, d.getReqId());
        requireRevision(d, body == null ? null : body.getRevision(), true);
        return d;
    }

    private void requireRevision(Demand d, Long revision, boolean required) {
        if (revision == null) {
            if (required) {
                throw AppException.badRequest("请携带需求 revision，刷新后重试");
            }
            return;
        }
        if (!revision.equals(d.getRevision())) {
            throw AppException.conflict("需求已被其他人修改，请刷新后重试");
        }
    }

    /** SQL 自身的 revision 条件是最后防线；零行不得写成功日志或通知。 */
    private void save(Demand d) {
        Long oldRevision = d.getRevision();
        if (oldRevision == null || demandMapper.update(d) != 1) {
            throw AppException.conflict("需求已被其他人修改，请刷新后重试");
        }
        d.setRevision(oldRevision + 1);
    }

    private String requireReason(DemandActionRequest body, String action) {
        String reason = Texts.trimToNull(noteOf(body));
        if (reason == null) {
            throw AppException.badRequest("请填写" + actionName(action) + "原因");
        }
        if (reason.length() > 500) {
            throw AppException.badRequest("原因不能超过 500 字");
        }
        return reason;
    }

    private void validateDates(LocalDate start, LocalDate end) {
        if (start != null && end != null && start.isAfter(end)) {
            throw AppException.badRequest("计划开始日期不能晚于计划结束日期");
        }
    }

    private void validatePriority(String priority) {
        if (priority != null && !priority.matches("P[0-3]")) {
            throw AppException.badRequest("优先级不合法");
        }
    }

    private Map<String, Object> snapshot(Demand d) {
        Map<String, Object> data = new LinkedHashMap<String, Object>();
        String name = d.getVersionName();
        if (d.getVersionId() != null && name == null) {
            ProjectVersion version = versionMapper.selectById(d.getVersionId());
            name = version == null ? d.getVersionId() : version.getName();
        }
        data.put("reqId", d.getReqId());
        data.put("categoryId", d.getCategoryId());
        data.put("versionId", d.getVersionId());
        data.put("versionName", name);
        data.put("plannedStart", d.getPlannedStart() == null ? null : d.getPlannedStart().toString());
        data.put("plannedEnd", d.getPlannedEnd() == null ? null : d.getPlannedEnd().toString());
        data.put("expectDate", d.getExpectDate() == null ? null : d.getExpectDate().toString());
        data.put("priority", d.getPriority());
        data.put("status", d.getStatus());
        data.put("closeReason", d.getCloseReason());
        data.put("closeStage", d.getCloseStage());
        data.put("reviewerUserId", d.getReviewerUserId());
        data.put("revision", d.getRevision());
        return data;
    }

    private void logChange(Demand d, String userId, String action, String text, String reason,
                           Map<String, Object> before) {
        Map<String, Object> data = new LinkedHashMap<String, Object>();
        data.put("before", before);
        data.put("after", snapshot(d));
        data.put("reason", reason);
        try {
            demandMapper.insertChangeLog(d.getWorkspaceId(), d.getId(), action, text, userId,
                    JSON.writeValueAsString(data));
        } catch (com.fasterxml.jackson.core.JsonProcessingException ex) {
            throw new IllegalStateException("需求变更日志序列化失败", ex);
        }
    }

    /** 创建时必须挂在一个项目下（需求池按项目归属） */
    private String reqIdOf(DemandSaveRequest req) {
        String reqId = Texts.trimToNull(req.getReqId());
        if (reqId == null) {
            throw AppException.badRequest("请选择所属项目");
        }
        return reqId;
    }

    private void applyFields(Demand d, DemandSaveRequest req) {
        d.setTitle(req.getTitle().trim());
        d.setDescription(Texts.trimToNull(req.getDescription()));
        d.setSource(Texts.trimToNull(req.getSource()));
        d.setItemKind(req.getItemKind() == null ? "新功能" : req.getItemKind());
        d.setCategoryId(validCategoryId(d.getWorkspaceId(), d.getReqId(), req.getCategoryId()));
        d.setPriority(req.getPriority() == null ? "P2" : req.getPriority());
        d.setExpectDate(req.getExpectDate());
        validateDates(req.getPlannedStart(), req.getPlannedEnd());
        validatePriority(req.getPriority());
        d.setPlannedStart(req.getPlannedStart());
        d.setPlannedEnd(req.getPlannedEnd());
        d.setAcceptText(Texts.trimToNull(req.getAcceptText()));
        d.setWsjfBusiness(req.getWsjfBusiness());
        d.setWsjfUrgency(req.getWsjfUrgency());
        d.setWsjfRisk(req.getWsjfRisk());
        d.setWsjfEffort(req.getWsjfEffort());
        d.setReviewerUserId(validReviewerId(d.getWorkspaceId(), d.getReqId(), req.getReviewerUserId()));
        fillWsjf(d);
    }

    /** 评审人必须对项目可见且不是查看者；空值表示未指派，继续走公共可认领队列 */
    private String validReviewerId(String workspaceId, String projectId, String raw) {
        String reviewerId = Texts.trimToNull(raw);
        if (reviewerId == null) {
            return null;
        }
        String role = projectAccess.roleOf(workspaceId, reviewerId);
        if (role == null) {
            throw AppException.badRequest("评审人不是该空间成员");
        }
        if ("viewer".equals(role)) {
            throw AppException.badRequest("查看者不能作为评审人");
        }
        if (!projectAccess.canWrite(workspaceId, reviewerId, projectId)) {
            throw AppException.badRequest("评审人需要该项目的写权限，否则无法通过或拒绝需求");
        }
        return reviewerId;
    }

    /** 已进入流转时的内容补录：只动说明与分类字段，标题、项目、类型、优先级和日期保持原值 */
    private void applyContentFields(Demand d, DemandSaveRequest req) {
        d.setDescription(Texts.trimToNull(req.getDescription()));
        d.setSource(Texts.trimToNull(req.getSource()));
        d.setCategoryId(validCategoryId(d.getWorkspaceId(), d.getReqId(), req.getCategoryId()));
        d.setAcceptText(Texts.trimToNull(req.getAcceptText()));
        d.setWsjfBusiness(req.getWsjfBusiness());
        d.setWsjfUrgency(req.getWsjfUrgency());
        d.setWsjfRisk(req.getWsjfRisk());
        d.setWsjfEffort(req.getWsjfEffort());
        fillWsjf(d);
    }

    /** 模块可选；非空时必须属于需求所属项目的模块字典，null 表示未指定（列可空） */
    private String validCategoryId(String workspaceId, String projectId, String raw) {
        String categoryId = Texts.trimToNull(raw);
        if (categoryId == null) {
            return null;
        }
        Category cat = categoryMapper.selectById(workspaceId, categoryId);
        if (cat == null) {
            throw AppException.badRequest("分类不存在：" + categoryId);
        }
        if (!projectId.equals(cat.getProjectId())) {
            throw AppException.badRequest("分类不属于该项目");
        }
        return categoryId;
    }

    private Requirement requireProject(String workspaceId, String reqId) {
        Requirement req = reqMapper.selectById(reqId);
        if (req == null || !workspaceId.equals(req.getWorkspaceId())) {
            throw AppException.notFound("项目不存在：" + reqId);
        }
        return req;
    }

    private Demand requireDemand(String workspaceId, String id) {
        Demand d = demandMapper.selectById(id);
        if (d == null || !workspaceId.equals(d.getWorkspaceId())) {
            throw AppException.notFound("需求不存在：" + id);
        }
        return d;
    }

    private Demand requireDemandForUpdate(String workspaceId, String id) {
        Demand d = demandMapper.selectByIdForUpdate(workspaceId, id);
        if (d == null || !workspaceId.equals(d.getWorkspaceId())) {
            throw AppException.notFound("需求不存在：" + id);
        }
        return d;
    }

    private void requireStatus(Demand d, String expected, String action) {
        if (!expected.equals(d.getStatus())) {
            throw AppException.badRequest("只有「" + statusName(expected) + "」的需求可以"
                    + actionName(action) + "，当前状态：" + statusName(d.getStatus()));
        }
    }

    private String noteOf(DemandActionRequest body) {
        return body == null ? null : body.getNote();
    }

    private void notifyStatus(Demand d, String actorId, String action, String detail) {
        String title = "需求「" + d.getTitle() + "」" + action;
        String body = detail == null ? "需求状态已变更为：" + action : Texts.cut(detail, 400);
        java.util.Set<String> notified = new java.util.HashSet<String>();
        if (d.getCreatedBy() != null && !d.getCreatedBy().equals(actorId)) {
            notificationEvents.notifyLinked(d.getCreatedBy(), d.getWorkspaceId(),
                    UserNotificationPreferenceService.DEMAND_STATUS, title, body,
                    "demand", d.getId(), d.getReqId());
            notified.add(d.getCreatedBy());
        }
        demandWatch.notifyWatchers(d, actorId, UserNotificationPreferenceService.DEMAND_WATCH,
                title, body, notified);
    }

    /** 编辑/删除：提交人不是操作者时告知，避免自己的需求被改动却毫不知情 */
    private void notifyCreator(Demand d, String actorId, String title, String body) {
        java.util.Set<String> notified = new java.util.HashSet<String>();
        if (d.getCreatedBy() != null && !d.getCreatedBy().equals(actorId)) {
            notificationEvents.notifyLinked(d.getCreatedBy(), d.getWorkspaceId(),
                    UserNotificationPreferenceService.DEMAND_STATUS, title, body,
                    "demand", d.getId(), d.getReqId());
            notified.add(d.getCreatedBy());
        }
        demandWatch.notifyWatchers(d, actorId, UserNotificationPreferenceService.DEMAND_WATCH,
                title, body, notified);
    }

    private void fillWsjf(Demand d) {
        if (d.getWsjfBusiness() != null && d.getWsjfUrgency() != null
                && d.getWsjfRisk() != null && d.getWsjfEffort() != null && d.getWsjfEffort() > 0) {
            d.setWsjfScore(Math.round((d.getWsjfBusiness() + d.getWsjfUrgency() + d.getWsjfRisk())
                    * 10f / d.getWsjfEffort()) / 10d);
        } else {
            /* 字段被清空时同步清分，避免旧分数残留 */
            d.setWsjfScore(null);
        }
    }

    /** 批量回填提交人显示名：一次查齐当前页涉及的用户，避免逐行查库 */
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
        if (ids.isEmpty() || userMapper == null) {
            return;
        }
        Map<String, String> names = new java.util.HashMap<String, String>();
        for (com.hourglass.entity.AppUser user : userMapper.selectByIds(new ArrayList<String>(ids))) {
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

    private String statusName(String status) {
        if ("review".equals(status)) {
            return "待评审";
        }
        if ("pass".equals(status)) {
            return "已通过";
        }
        if ("plan".equals(status)) {
            return "已排期";
        }
        if ("done".equals(status)) {
            return "已完成";
        }
        if ("closed".equals(status)) {
            return "已关闭";
        }
        if ("rej".equals(status)) {
            return "已拒绝";
        }
        if ("canceled".equals(status)) {
            return "已取消";
        }
        return status;
    }

    private String actionName(String action) {
        if ("pass".equals(action)) {
            return "通过";
        }
        if ("rej".equals(action)) {
            return "拒绝";
        }
        if ("plan".equals(action)) {
            return "排期";
        }
        if ("reopen".equals(action)) {
            return "重新打开";
        }
        if ("unpass".equals(action)) {
            return "撤回评审";
        }
        if ("unplan".equals(action)) {
            return "撤销排期";
        }
        if ("replan".equals(action)) {
            return "调期";
        }
        if ("cancel".equals(action)) {
            return "取消";
        }
        if ("restore".equals(action)) {
            return "恢复";
        }
        if ("complete".equals(action)) {
            return "自动完成";
        }
        if ("auto_reopen".equals(action)) {
            return "自动退回";
        }
        return action;
    }
}
