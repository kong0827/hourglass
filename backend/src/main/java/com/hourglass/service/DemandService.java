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
 * <p>状态机：review（待评审）→ pass（已通过）/ rej（已拒绝）；pass → plan（已排期，选目标版本）；
 * rej → reopen 回 review；pass → unpass 撤回评审；plan → unplan 退回已通过并解绑版本。
 * 评审流转仅空间主可执行，全部动作写 demand_log 留痕。
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

    public DemandService(DemandMapper demandMapper, RequirementMapper reqMapper,
                         ProjectVersionMapper versionMapper, TaskMapper taskMapper,
                         NotificationEventService notificationEvents, RequirementDocMapper docMapper,
                         ProjectAccessService projectAccess, AttachmentService attachmentService,
                         com.hourglass.mapper.MailDeliveryMapper mailDeliveryMapper,
                         com.hourglass.mapper.TestCaseMapper caseMapper, CategoryMapper categoryMapper) {
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
    }

    /** 列表模式分页：筛选/排序/分页全在 SQL，counts 忽略 status 条件 */
    public DemandPage page(String workspaceId, String userId, DemandQuery query) {
        prepare(workspaceId, userId, query);
        query.setStatus(validStatus(query.getStatus()));
        query.setOffset(Math.max(0, query.getOffset()));
        query.setLimit(Math.max(1, Math.min(MAX_PAGE_SIZE, query.getLimit())));

        Map<String, Integer> counts = countByStatus(query);
        int total = query.getStatus() == null
                ? sumCounts(counts)
                : countOf(counts, query.getStatus());
        List<Demand> items = total <= query.getOffset()
                ? new java.util.ArrayList<Demand>()
                : demandMapper.selectPage(query);
        for (Demand d : items) {
            fillWsjf(d);
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

    /** 看板：每个状态一列，只取首屏 limit 条；其余由 /api/demands/page 滚动加载 */
    public DemandBoardResponse board(String workspaceId, String userId, String reqId, int limit) {
        DemandQuery base = new DemandQuery();
        base.setReqId(Texts.trimToNull(reqId));
        prepare(workspaceId, userId, base);
        int safeLimit = Math.max(1, Math.min(MAX_PAGE_SIZE, limit <= 0 ? 50 : limit));
        Map<String, Integer> counts = countByStatus(base);

        DemandBoardResponse resp = new DemandBoardResponse();
        resp.setCounts(counts);
        for (String status : DEMAND_STATUSES) {
            DemandQuery q = copyOf(base);
            q.setStatus(status);
            q.setOffset(0);
            q.setLimit(safeLimit);
            int matched = countOf(counts, status);
            List<Demand> items = matched == 0 ? new java.util.ArrayList<Demand>() : demandMapper.selectPage(q);
            for (Demand d : items) {
                fillWsjf(d);
            }
            DemandBoardResponse.Column col = new DemandBoardResponse.Column();
            col.setItems(items);
            col.setMatched(matched);
            col.setHasMore(matched > items.size());
            resp.getColumns().put(status, col);
        }
        return resp;
    }

    private static final String[] DEMAND_STATUSES = {"review", "pass", "plan", "rej"};

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
        List<String> versionIds = new ArrayList<String>();
        for (Demand d : demands) {
            ids.add(d.getId());
            if (d.getVersionId() != null) {
                versionIds.add(d.getVersionId());
            }
        }

        Map<String, Map<String, Object>> logs = indexRows(demandMapper.selectLogTimeline(workspaceId, ids));
        boolean seeAllDrafts = ProjectAccessService.isPrivileged(projectAccess.roleOf(workspaceId, userId));
        Map<String, Map<String, Object>> docs = indexRows(demandMapper.selectDocTimeline(
                workspaceId, ids, query.getViewerId(), userId, seeAllDrafts));
        Map<String, Map<String, Object>> tasks = indexRows(demandMapper.selectTaskTimeline(workspaceId, ids));
        Map<String, Map<String, Object>> tests = indexRows(demandMapper.selectTestTimeline(workspaceId, ids));
        Map<String, Map<String, Object>> versions = versionIds.isEmpty()
                ? new LinkedHashMap<String, Map<String, Object>>()
                : indexRows(demandMapper.selectVersionTimeline(workspaceId, versionIds), "id");

        LocalDate today = LocalDate.now();
        for (Demand d : demands) {
            DemandGanttItem item = new DemandGanttItem();
            item.setDemand(d);
            item.setTimeline(timelineOf(d, logs.get(d.getId()), docs.get(d.getId()),
                    tasks.get(d.getId()), tests.get(d.getId()),
                    d.getVersionId() == null ? null : versions.get(d.getVersionId()), today));
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
                                      Map<String, Object> task, Map<String, Object> test,
                                      Map<String, Object> version, LocalDate today) {
        DemandTimeline timeline = new DemandTimeline();
        List<DemandStage> stages = timeline.getStages();
        String status = d.getStatus();
        LocalDate created = d.getCreatedAt() == null ? today : d.getCreatedAt().toLocalDate();
        LocalDate passAt = toDate(value(log, "passAt"));
        LocalDate rejAt = toDate(value(log, "rejAt"));
        LocalDate planAt = toDate(value(log, "planAt"));

        /* 评审整段计算：创建 → 最后一次通过；待评审算到今天；已拒绝停在最后一次拒绝 */
        LocalDate reviewEnd;
        boolean reviewOpen;
        if ("review".equals(status)) {
            reviewEnd = today;
            reviewOpen = true;
        } else if ("rej".equals(status)) {
            reviewEnd = rejAt == null ? today : rejAt;
            reviewOpen = rejAt == null;
        } else {
            reviewEnd = passAt != null ? passAt : (planAt != null ? planAt : today);
            reviewOpen = passAt == null && planAt == null;
        }
        addStage(stages, "review", created, reviewEnd, reviewOpen, false);

        if (planAt != null && "plan".equals(status)) {
            LocalDate planStart = passAt == null ? created : passAt;
            addStage(stages, "plan", planStart, planAt, false, planStart.isEqual(planAt));
        }

        int docCount = intValue(value(doc, "docCount"));
        int docPublished = intValue(value(doc, "docPublished"));
        timeline.setDocCount(docCount);
        timeline.setDocPublished(docPublished);
        LocalDate docStart = toDate(value(doc, "docStart"));
        if (docStart != null) {
            boolean designOpen = docPublished < docCount;
            addStage(stages, "design", docStart, designOpen ? today : toDate(value(doc, "docEnd")),
                    designOpen, false);
        }

        int taskCount = intValue(value(task, "taskCount"));
        int taskDone = intValue(value(task, "taskDone"));
        int taskOpen = intValue(value(task, "taskOpen"));
        timeline.setTaskCount(taskCount);
        timeline.setTaskDone(taskDone);
        LocalDate devStart = toDate(value(task, "devStart"));
        LocalDate devEnd = toDate(value(task, "devEnd"));
        boolean devOpen = taskOpen > 0;
        if (devStart != null) {
            addStage(stages, "dev", devStart, devOpen ? today : devEnd, devOpen, false);
        }

        int caseCount = intValue(value(test, "caseCount"));
        int casePending = intValue(value(test, "testPending"));
        timeline.setCaseCount(caseCount);
        timeline.setCasePending(casePending);
        LocalDate testStart = toDate(value(test, "testStart"));
        LocalDate testEnd = toDate(value(test, "testEnd"));
        if (testStart != null) {
            addStage(stages, "test", testStart, casePending > 0 ? today : testEnd,
                    casePending > 0, false);
        }

        /* 完成点取开发与测试的较晚收口；仍有用例未通过时不算完成 */
        LocalDate lastWork = devEnd;
        if (testEnd != null && (lastWork == null || testEnd.isAfter(lastWork))) {
            lastWork = testEnd;
        }
        LocalDate completeAt = null;
        if (taskCount > 0 && taskDone >= taskCount && casePending == 0) {
            completeAt = lastWork == null ? today : lastWork;
            addStage(stages, "complete", completeAt, completeAt, false, true);
        }

        LocalDate releasedAt = toDate(value(version, "releasedAt"));
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

    private Map<String, Integer> countByStatus(DemandQuery query) {
        DemandQuery countsQuery = copyOf(query);
        countsQuery.setStatus(null);
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
                : taskMapper.selectByDemandPage(workspaceId, id, safeOffset, safeLimit);
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
        demandMapper.insert(d);
        demandMapper.insertLog(workspaceId, d.getId(), "create", null, userId);
        return get(workspaceId, d.getId());
    }

    /** 仅待评审状态可编辑（进入流转后以评审结论为准；被拒需求 reopen 后可再改） */
    @Transactional
    public Demand update(String userId, String workspaceId, String id, DemandSaveRequest req) {
        Demand d = requireDemand(workspaceId, id);
        projectAccess.assertView(workspaceId, userId, d.getReqId());
        projectAccess.assertWrite(workspaceId, userId, d.getReqId());
        if (!"review".equals(d.getStatus())) {
            throw AppException.badRequest("需求已进入流转（" + statusName(d.getStatus()) + "），不能直接编辑");
        }
        projectAccess.assertWrite(workspaceId, userId, reqIdOf(req));
        applyFields(d, req);
        demandMapper.update(d);
        demandMapper.insertLog(workspaceId, id, "update", null, userId);
        notifyCreator(d, userId, "需求「" + d.getTitle() + "」已被编辑",
                "需求内容有更新（仍处于待评审）");
        return get(workspaceId, id);
    }

    @Transactional
    public Demand pass(String userId, String workspaceId, String id, DemandActionRequest body) {
        Demand d = requireDemand(workspaceId, id);
        requireStatus(d, "review", "pass");
        d.setStatus("pass");
        d.setReviewNote(Texts.cut(Texts.trimToNull(noteOf(body)), 500));
        demandMapper.update(d);
        demandMapper.insertLog(workspaceId, id, "pass", d.getReviewNote(), userId);
        notifyStatus(d, userId, "评审通过", d.getReviewNote());
        return get(workspaceId, id);
    }

    @Transactional
    public Demand reject(String userId, String workspaceId, String id, DemandActionRequest body) {
        Demand d = requireDemand(workspaceId, id);
        requireStatus(d, "review", "rej");
        String note = Texts.trimToNull(noteOf(body));
        if (note == null) {
            throw AppException.badRequest("请填写拒绝原因");
        }
        d.setStatus("rej");
        d.setReviewNote(Texts.cut(note, 500));
        demandMapper.update(d);
        demandMapper.insertLog(workspaceId, id, "rej", d.getReviewNote(), userId);
        notifyStatus(d, userId, "评审拒绝", d.getReviewNote());
        return get(workspaceId, id);
    }

    /** 排期：已通过 → 已排期，必须选同项目的目标版本（T2.4 需求→版本联动） */
    @Transactional
    public Demand plan(String userId, String workspaceId, String id, DemandActionRequest body) {
        Demand d = requireDemand(workspaceId, id);
        requireStatus(d, "pass", "plan");
        String versionId = Texts.trimToNull(body == null ? null : body.getVersionId());
        if (versionId == null) {
            throw AppException.badRequest("请选择目标版本");
        }
        ProjectVersion v = versionMapper.selectById(versionId);
        if (v == null || !workspaceId.equals(v.getWorkspaceId()) || !d.getReqId().equals(v.getReqId())) {
            throw AppException.badRequest("目标版本不存在或不属于该需求所在项目：" + versionId);
        }
        d.setStatus("plan");
        d.setVersionId(versionId);
        d.setReviewNote(Texts.cut(Texts.trimToNull(noteOf(body)), 500));
        if (body != null && body.getExpectDate() != null) {
            d.setExpectDate(body.getExpectDate());
        }
        demandMapper.update(d);
        demandMapper.insertLog(workspaceId, id, "plan", "排入版本 " + v.getName()
                + (d.getReviewNote() == null ? "" : "：" + d.getReviewNote()), userId);
        notifyStatus(d, userId, "已排期", "目标版本：" + v.getName()
                + (d.getReviewNote() == null ? "" : "；" + d.getReviewNote()));
        return get(workspaceId, id);
    }

    /** 撤回评审：已通过 → 待评审（审批点错了可退回重评） */
    @Transactional
    public Demand unpass(String userId, String workspaceId, String id, DemandActionRequest body) {
        Demand d = requireDemand(workspaceId, id);
        requireStatus(d, "pass", "unpass");
        d.setStatus("review");
        d.setReviewNote(Texts.cut(Texts.trimToNull(noteOf(body)), 500));
        demandMapper.update(d);
        demandMapper.insertLog(workspaceId, id, "unpass", d.getReviewNote(), userId);
        notifyStatus(d, userId, "撤回评审", d.getReviewNote());
        return get(workspaceId, id);
    }

    /** 撤销排期：已排期 → 已通过，同时解绑版本 */
    @Transactional
    public Demand unplan(String userId, String workspaceId, String id, DemandActionRequest body) {
        Demand d = requireDemand(workspaceId, id);
        requireStatus(d, "plan", "unplan");
        String oldVersionId = d.getVersionId();
        String oldVersionName = null;
        if (oldVersionId != null) {
            ProjectVersion old = versionMapper.selectById(oldVersionId);
            oldVersionName = old == null ? oldVersionId : old.getName();
        }
        d.setStatus("pass");
        d.setVersionId(null);
        d.setReviewNote(Texts.cut(Texts.trimToNull(noteOf(body)), 500));
        demandMapper.update(d);
        demandMapper.insertLog(workspaceId, id, "unplan", "撤销排期"
                + (oldVersionName == null ? "" : "（原版本 " + oldVersionName + "）")
                + (d.getReviewNote() == null ? "" : "：" + d.getReviewNote()), userId);
        notifyStatus(d, userId, "撤销排期", "需求已退回已通过，可重新选择目标版本");
        return get(workspaceId, id);
    }

    /** 重新打开：已拒绝 → 待评审（清掉拒绝原因，重新进入评审） */
    @Transactional
    public Demand reopen(String userId, String workspaceId, String id, DemandActionRequest body) {
        Demand d = requireDemand(workspaceId, id);
        requireStatus(d, "rej", "reopen");
        d.setStatus("review");
        d.setReviewNote(Texts.cut(Texts.trimToNull(noteOf(body)), 500));
        demandMapper.update(d);
        demandMapper.insertLog(workspaceId, id, "reopen", d.getReviewNote(), userId);
        notifyStatus(d, userId, "重新打开", d.getReviewNote());
        return get(workspaceId, id);
    }

    @Transactional
    public void delete(String userId, String workspaceId, String id) {
        Demand d = requireDemand(workspaceId, id);
        attachmentService.deleteByTarget(workspaceId, id, AttachmentService.KIND_DEMAND);
        mailDeliveryMapper.deleteByReferenceIds(java.util.Collections.singletonList(id));
        docMapper.deleteDemandLinksByDemand(workspaceId, id);
        /* 需求没了，任务上的 demand_id 必须一起解绑，否则编辑任务会被"关联需求不存在"拦住 */
        taskMapper.clearDemandRef(workspaceId, id);
        /* 测试用例上的选填关联同样解绑 */
        caseMapper.clearDemandRefs(workspaceId, id);
        /* 条目本身要删，留着它自己的流转日志只会变成查不到主人的孤儿行 */
        demandMapper.deleteLogsByDemand(workspaceId, id);
        demandMapper.deleteById(workspaceId, id);
        notifyCreator(d, userId, "需求「" + d.getTitle() + "」已被删除",
                "需求已从需求池删除，关联任务已解绑");
    }

    /* ------------------------------------------------------------------ */

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
        if ("rej".equals(status)) {
            return "已拒绝";
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
        return action;
    }
}
