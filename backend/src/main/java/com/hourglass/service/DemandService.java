package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.common.Ids;
import com.hourglass.common.Texts;
import com.hourglass.dto.DemandGanttItem;
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
    @org.springframework.beans.factory.annotation.Autowired
    private com.hourglass.mapper.VersionTaskMapper versionTaskMapper;
    @org.springframework.beans.factory.annotation.Autowired
    private TaskPublicationService publications;
    @org.springframework.beans.factory.annotation.Autowired
    private com.hourglass.mapper.ReleaseMapper releases;
    private static final com.fasterxml.jackson.databind.ObjectMapper JSON = new com.fasterxml.jackson.databind.ObjectMapper();

    public DemandService(DemandMapper demandMapper, RequirementMapper reqMapper,
                         ProjectVersionMapper versionMapper, TaskMapper taskMapper,
                         NotificationEventService notificationEvents, RequirementDocMapper docMapper,
                         ProjectAccessService projectAccess, AttachmentService attachmentService,
                         com.hourglass.mapper.MailDeliveryMapper mailDeliveryMapper,
                         com.hourglass.mapper.TestCaseMapper caseMapper, CategoryMapper categoryMapper,
                         DeliveryScopeLock deliveryLock, ReleasePermissionService releasePermission,
                         DeletionTraceService deletionTrace) {
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
        Map<String, Integer> counts = countByStatus(base);

        DemandBoardResponse resp = new DemandBoardResponse();
        resp.setCounts(counts);
        resp.setTotalAll(boardTotalAll(base));
        resp.setFacets(boardFacets(base));
        resp.setStageCounts(deliveryStageCounts(base));
        for (String status : DEMAND_STATUSES) {
            DemandQuery q = copyOf(base);
            q.setStatus(status);
            q.setOffset(0);
            q.setLimit(safeLimit);
            int matched = "plan".equals(status) && q.getDeliveryStage() != null
                    ? demandMapper.countPage(q) : countOf(counts, status);
            List<Demand> items = matched == 0 ? new java.util.ArrayList<Demand>() : demandMapper.selectPage(q);
            for (Demand d : items) {
                fillWsjf(d);
                d.setCanSchedule(releasePermission.canManageProject(userId, workspaceId, d.getReqId()));
            }
            DemandBoardResponse.Column col = new DemandBoardResponse.Column();
            col.setItems(items);
            col.setMatched(matched);
            col.setHasMore(matched > items.size());
            resp.getColumns().put(status, col);
        }
        return resp;
    }

    private static final String[] DEMAND_STATUSES = {"review", "pass", "plan", "closed"};
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
        mainScope.setStatus("plan");

        com.hourglass.dto.DemandWorkpageResponse out = new com.hourglass.dto.DemandWorkpageResponse();
        out.setPage(page);
        out.setStatusCounts(statusCounts);
        out.setStageCounts(deliveryStageCounts(mainScope));
        Map<String, Object> metrics = demandMapper.workpageMetrics(query);
        out.setMetrics(metrics == null ? new LinkedHashMap<String, Object>() : metrics);

        DemandQuery versionsQuery = copyOf(query);
        versionsQuery.setStatus("plan");
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
        query.setCloseStage(validChoice(query.getCloseStage(), new String[]{"review", "pass", "plan"}));
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

    private Map<String, Integer> deliveryStageCounts(DemandQuery query) {
        DemandQuery scope = copyOf(query);
        scope.setStatus("plan");
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
        for (String stage : DELIVERY_STAGES) {
            all += countOf(counts, stage);
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
        Demand d = requireDemand(workspaceId, id);
        fillWsjf(d);
        return d;
    }

    /** 读取前校验项目可见范围（不可见按不存在处理） */
    public Demand getVisible(String workspaceId, String userId, String id) {
        Demand d = get(workspaceId, id);
        projectAccess.assertView(workspaceId, userId, d.getReqId());
        d.setCanSchedule(releasePermission.canManageProject(userId, workspaceId, d.getReqId()));
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
        demandMapper.insert(d);
        logChange(d, userId, "create", null, null, null);
        return getVisible(workspaceId, userId, d.getId());
    }

    /** 仅待评审状态可编辑（进入流转后以评审结论为准；被拒需求 reopen 后可再改） */
    @Transactional
    public Demand update(String userId, String workspaceId, String id, DemandSaveRequest req) {
        Demand initial = requireDemand(workspaceId, id);
        projectAccess.assertView(workspaceId, userId, initial.getReqId());
        projectAccess.assertWrite(workspaceId, userId, initial.getReqId());
        String projectId = reqIdOf(req);
        requireProject(workspaceId, projectId);
        if (!projectId.equals(initial.getReqId())) {
            throw AppException.badRequest("需求所属项目不能直接修改");
        }
        deliveryLock.lockProjects(workspaceId, initial.getReqId());
        Demand d = requireDemandForUpdate(workspaceId, id);
        projectAccess.assertWriteForUpdate(workspaceId, userId, d.getReqId());
        requireRevision(d, req.getRevision(), true);
        if (!"review".equals(d.getStatus())) {
            throw AppException.badRequest("需求已进入流转（" + statusName(d.getStatus()) + "），不能直接编辑");
        }
        if (!initial.getReqId().equals(d.getReqId())) {
            throw AppException.conflict("需求所属项目已变更，请刷新后重试");
        }
        Map<String, Object> before = snapshot(d);
        applyFields(d, req);
        save(d);
        logChange(d, userId, "update", null, null, before);
        notifyCreator(d, userId, "需求「" + d.getTitle() + "」已被编辑",
                "需求内容有更新（仍处于待评审）");
        return getVisible(workspaceId, userId, id);
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
            if ("released".equals(v.getStatus()) || v.getReleasedAt() != null) {
                throw AppException.badRequest("不能排入已发布版本");
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

    /** 关闭不级联任务；保留原目标，恢复到已通过时必须重新排期。 */
    @Transactional
    public Demand cancel(String userId, String workspaceId, String id, DemandActionRequest body) {
        Demand d = scheduleDemand(userId, workspaceId, id, body);
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
        deletionTrace.recordDelete(workspaceId, userId, "demand_delete", "demand", id, d.getTitle(),
                "删除需求「" + d.getTitle() + "」（"
                        + (d.getReqId() == null ? "未归属项目" : "项目 " + d.getReqId())
                        + "；解除 " + linkedTasks.size() + " 项任务关联，需求流转日志一并清理）");
        attachmentService.deleteByTarget(workspaceId, id, AttachmentService.KIND_DEMAND);
        mailDeliveryMapper.deleteByReferenceIds(java.util.Collections.singletonList(id));
        docMapper.deleteDemandLinksByDemand(workspaceId, id);
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
        demandMapper.deleteById(workspaceId, id);
        notifyCreator(d, userId, "需求「" + d.getTitle() + "」已被删除",
                "需求已从需求池删除，关联任务已解绑");
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
        data.put("versionId", d.getVersionId());
        data.put("versionName", name);
        data.put("plannedStart", d.getPlannedStart() == null ? null : d.getPlannedStart().toString());
        data.put("plannedEnd", d.getPlannedEnd() == null ? null : d.getPlannedEnd().toString());
        data.put("expectDate", d.getExpectDate() == null ? null : d.getExpectDate().toString());
        data.put("priority", d.getPriority());
        data.put("status", d.getStatus());
        data.put("closeReason", d.getCloseReason());
        data.put("closeStage", d.getCloseStage());
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
            throw AppException.badRequest("模块不存在：" + categoryId);
        }
        if (!projectId.equals(cat.getProjectId())) {
            throw AppException.badRequest("模块不属于该项目");
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
        if (d.getCreatedBy() == null || d.getCreatedBy().equals(actorId)) {
            return;
        }
        notificationEvents.notifyLinked(d.getCreatedBy(), d.getWorkspaceId(),
                UserNotificationPreferenceService.DEMAND_STATUS,
                "需求「" + d.getTitle() + "」" + action,
                detail == null ? "需求状态已变更为：" + action : Texts.cut(detail, 400),
                "demand", d.getId(), d.getReqId());
    }

    /** 编辑/删除：提交人不是操作者时告知，避免自己的需求被改动却毫不知情 */
    private void notifyCreator(Demand d, String actorId, String title, String body) {
        if (d.getCreatedBy() == null || d.getCreatedBy().equals(actorId)) {
            return;
        }
        notificationEvents.notifyLinked(d.getCreatedBy(), d.getWorkspaceId(),
                UserNotificationPreferenceService.DEMAND_STATUS, title, body,
                "demand", d.getId(), d.getReqId());
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
        return action;
    }
}
