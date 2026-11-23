package com.hourglass.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.hourglass.common.AppException;
import com.hourglass.common.Ids;
import com.hourglass.common.Texts;
import com.hourglass.dto.CatchupDecisionRequest;
import com.hourglass.dto.CatchupDraft;
import com.hourglass.dto.CatchupEvidence;
import com.hourglass.dto.CatchupPlanRow;
import com.hourglass.dto.CatchupRisk;
import com.hourglass.dto.CatchupTaskRow;
import com.hourglass.dto.CatchupTimeCell;
import com.hourglass.dto.CatchupTimeGrid;
import com.hourglass.dto.CatchupTimeRequest;
import com.hourglass.dto.CatchupTimeSum;
import com.hourglass.dto.CatchupView;
import com.hourglass.entity.AppUser;
import com.hourglass.entity.BoardColumn;
import com.hourglass.entity.CatchupCarry;
import com.hourglass.entity.CatchupDecision;
import com.hourglass.entity.CatchupSession;
import com.hourglass.entity.CatchupTimeAlloc;
import com.hourglass.entity.CatchupWrite;
import com.hourglass.entity.TaskLog;
import com.hourglass.mapper.BoardColumnMapper;
import com.hourglass.mapper.CatchupMapper;
import com.hourglass.mapper.UserMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.DayOfWeek;
import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 周五补记：把本周真实痕迹汇总成草稿，用户在 10 分钟内逐条确认。
 *
 * <p>边界：只写确认记录（工作项时间线）与工时归属；不自动改工作项状态。
 * 唯一的状态写入是风险卡片的「解除阻塞」，且提交后 5 分钟内可撤销。
 */
@Service
public class CatchupService {

    private static final int UNDO_MINUTES = 5;
    private static final int MAX_DRAFTS = 12;
    private static final int MAX_RISKS = 8;
    private static final DateTimeFormatter MD_HM = DateTimeFormatter.ofPattern("MM-dd HH:mm");
    private static final DateTimeFormatter ISO = DateTimeFormatter.ISO_LOCAL_DATE;
    private static final List<String> ANSWER_OPTIONS =
            Arrays.asList("完成", "进行中", "阻塞", "不是工作项");
    private static final Map<String, String> TYPE_LABELS = new HashMap<String, String>();
    private static final Map<String, String> COLUMN_FALLBACK = new HashMap<String, String>();

    static {
        TYPE_LABELS.put("story", "需求");
        TYPE_LABELS.put("task", "任务");
        TYPE_LABELS.put("bug", "缺陷");
        TYPE_LABELS.put("epic", "史诗");
        COLUMN_FALLBACK.put("backlog", "待处理");
        COLUMN_FALLBACK.put("todo", "待处理");
        COLUMN_FALLBACK.put("doing", "进行中");
        COLUMN_FALLBACK.put("testing", "测试中");
        COLUMN_FALLBACK.put("done", "已完成");
        COLUMN_FALLBACK.put("canceled", "已取消");
    }

    private final CatchupMapper catchupMapper;
    private final ProjectAccessService projectAccess;
    private final UserMapper userMapper;
    private final BoardColumnMapper boardColumnMapper;
    private final ObjectMapper json;

    public CatchupService(CatchupMapper catchupMapper, ProjectAccessService projectAccess,
                          UserMapper userMapper, BoardColumnMapper boardColumnMapper, ObjectMapper json) {
        this.catchupMapper = catchupMapper;
        this.projectAccess = projectAccess;
        this.userMapper = userMapper;
        this.boardColumnMapper = boardColumnMapper;
        this.json = json;
    }

    /** 补记页数据：会话 + 草稿 + 工时 + 风险 + 周回顾预览。 */
    public CatchupView view(String workspaceId, String userId, String week) {
        Ctx ctx = load(workspaceId, userId, week, false);
        return buildView(ctx);
    }

    /** 「我的工作」入口卡片：只取本周状态与计数。 */
    public Map<String, Object> entry(String workspaceId, String userId) {
        Ctx ctx = load(workspaceId, userId, null, false);
        CatchupView view = buildView(ctx);
        int activity = num(view.getActivity().get("total"));
        boolean visible = ctx.session != null || activity > 0;
        Map<String, Object> res = new LinkedHashMap<String, Object>();
        res.put("visible", visible);
        res.put("weekStart", view.getWeekStart());
        res.put("weekEnd", view.getWeekEnd());
        res.put("status", view.getSession().get("status"));
        res.put("pending", view.getCounts().get("pending"));
        res.put("total", view.getCounts().get("total"));
        res.put("done", view.getCounts().get("done"));
        res.put("high", view.getCounts().get("high"));
        res.put("timeTotal", view.getCounts().get("timeTotalHours"));
        res.put("submittedAt", view.getSession().get("submittedAt"));
        res.put("elapsedSeconds", view.getSession().get("elapsedSeconds"));
        res.put("undoUntil", view.getSession().get("undoUntil"));
        res.put("activity", view.getActivity());
        return res;
    }

    /** 保存一条工作项/风险决策。 */
    @Transactional
    public CatchupView decide(String workspaceId, String userId, CatchupDecisionRequest req) {
        if (req == null || Texts.trimToNull(req.getDraftKey()) == null) {
            throw AppException.badRequest("缺少补记对象");
        }
        requireWriter(workspaceId, userId);
        Ctx ctx = load(workspaceId, userId, req.getWeek(), true);
        requireEditable(ctx.session);
        String key = Texts.trimToNull(req.getDraftKey());
        String kind = Texts.trimToNull(req.getKind());
        String action = Texts.trimToNull(req.getAction());
        if (action == null) {
            throw AppException.badRequest("缺少补记操作");
        }
        CatchupView current = buildView(ctx);
        CatchupDraft draft = findDraft(current.getDrafts(), key);
        CatchupRisk risk = findRisk(current.getRisks(), key);
        if (draft == null && risk == null) {
            throw AppException.notFound("补记对象不存在或本周已不可补记：" + key);
        }
        if ("clear".equals(action)) {
            catchupMapper.deleteDecision(ctx.session.getId(), key);
            return buildView(load(workspaceId, userId, ctx.weekStart.format(ISO), true));
        }
        if (("risk".equals(kind) || key.startsWith("risk:")) && risk == null) {
            throw AppException.badRequest("风险卡片不存在：" + key);
        }
        if (!key.startsWith("risk:")) {
            kind = "work";
            if (!Arrays.asList("accept", "skip", "merge", "edit", "answer").contains(action)) {
                throw AppException.badRequest("工作项不支持该操作：" + action);
            }
            if ("merge".equals(action) && draft.getDuplicate() == null) {
                throw AppException.badRequest("这条草稿没有可合并的重复项");
            }
        } else {
            kind = "risk";
            if (!Arrays.asList("confirm", "record", "ignore", "unblock").contains(action)) {
                throw AppException.badRequest("风险不支持该操作：" + action);
            }
        }

        /* 补记写的是共享工作项记录：按所属项目校验写权限；查看者/只读项目不能借补记写时间线 */
        if (!"clear".equals(action)) {
            if (draft != null) {
                assertTaskWritable(ctx, draft.getTaskId());
            } else if (risk != null) {
                assertTaskWritable(ctx, risk.getTaskId());
            }
        }

        CatchupDecision dec = new CatchupDecision();
        dec.setSessionId(ctx.session.getId());
        dec.setDraftKey(key);
        dec.setKind(kind);
        dec.setAction(action);
        if ("answer".equals(action)) {
            String answer = Texts.trimToNull(req.getAnswer());
            if (answer == null || !ANSWER_OPTIONS.contains(answer)) {
                throw AppException.badRequest("请选择这条工作项当前的状态");
            }
            dec.setAnswer(answer);
        }
        if ("edit".equals(action)) {
            String title = Texts.trimToNull(req.getTitle());
            if (title != null) {
                dec.setTitle(Texts.cut(title, 120));
            }
            String state = Texts.trimToNull(req.getAnswer());
            if (state != null && ANSWER_OPTIONS.contains(state)) {
                dec.setAnswer(state);
            }
            String note = Texts.trimToNull(req.getNote());
            if (note != null) {
                dec.setPayloadJson(Texts.cut(note, 500));
            }
        }
        catchupMapper.upsertDecision(dec);

        if (ctx.session.getStartedAt() == null) {
            ctx.session.setStartedAt(LocalDateTime.now());
        }
        if ("skipped".equals(ctx.session.getStatus())) {
            ctx.session.setStatus("draft");
        }
        catchupMapper.updateSession(ctx.session);
        return buildView(load(workspaceId, userId, ctx.weekStart.format(ISO), true));
    }

    /** 保存工时归属：整张周网格覆盖保存。 */
    @Transactional
    public CatchupView saveTime(String workspaceId, String userId, CatchupTimeRequest req) {
        requireWriter(workspaceId, userId);
        Ctx ctx = load(workspaceId, userId, req == null ? null : req.getWeek(), true);
        requireEditable(ctx.session);
        List<CatchupTimeRequest.Cell> cells = req == null ? null : req.getCells();
        if (cells == null) {
            cells = new ArrayList<CatchupTimeRequest.Cell>();
        }
        Set<String> seen = new LinkedHashSet<String>();
        List<CatchupTimeAlloc> rows = new ArrayList<CatchupTimeAlloc>();
        Map<LocalDate, Integer> daily = new LinkedHashMap<LocalDate, Integer>();
        for (CatchupTimeRequest.Cell cell : cells) {
            if (cell == null) {
                continue;
            }
            String rowKey = Texts.trimToNull(cell.getRowKey());
            if (rowKey == null || !(rowKey.startsWith("req:") || "unassigned".equals(rowKey))) {
                throw AppException.badRequest("工时归属行不合法");
            }
            LocalDate day;
            try {
                day = LocalDate.parse(String.valueOf(cell.getDay()));
            } catch (Exception e) {
                throw AppException.badRequest("工时归属日期格式应为 yyyy-MM-dd");
            }
            if (day.isBefore(ctx.weekStart) || day.isAfter(ctx.weekStart.plusDays(6))) {
                throw AppException.badRequest("工时归属日期不在本周范围");
            }
            int minutes = cell.getMinutes() == null ? 0 : cell.getMinutes();
            if (minutes < 0 || minutes > 24 * 60) {
                throw AppException.badRequest("单个格子的工时应在 0 ~ 24 小时之间");
            }
            String reqId = Texts.trimToNull(cell.getReqId());
            if ("unassigned".equals(rowKey)) {
                reqId = null;
            } else if (reqId == null || !rowKey.equals("req:" + reqId)) {
                throw AppException.badRequest("工时归属的项目与行不一致");
            }
            /* 工时只能归到自己能看到的项目：隐藏/删掉的项目不能借补记写入 */
            if (reqId != null && !projectAccess.canView(workspaceId, userId, reqId)) {
                throw AppException.badRequest("工时归属的项目不存在或你没有访问权限");
            }
            String unique = rowKey + "|" + day;
            if (!seen.add(unique)) {
                throw AppException.badRequest("工时归属存在重复格子");
            }
            int dayTotal = (daily.containsKey(day) ? daily.get(day) : 0) + minutes;
            if (dayTotal > 24 * 60) {
                throw AppException.badRequest("单日工时合计不能超过 24 小时（" + day + "）");
            }
            daily.put(day, dayTotal);
            CatchupTimeAlloc alloc = new CatchupTimeAlloc();
            alloc.setSessionId(ctx.session.getId());
            alloc.setRowKey(rowKey);
            alloc.setDay(day);
            alloc.setReqId(reqId);
            alloc.setMinutes(minutes);
            rows.add(alloc);
        }
        catchupMapper.deleteAllocs(ctx.session.getId());
        for (CatchupTimeAlloc row : rows) {
            catchupMapper.insertAlloc(row);
        }
        if (ctx.session.getStartedAt() == null) {
            ctx.session.setStartedAt(LocalDateTime.now());
        }
        if ("skipped".equals(ctx.session.getStatus())) {
            ctx.session.setStatus("draft");
        }
        catchupMapper.updateSession(ctx.session);
        return buildView(load(workspaceId, userId, ctx.weekStart.format(ISO), true));
    }

    /** 提交：把确认项写成工作项时间线，落工时归属，并结算会话。 */
    @Transactional
    public CatchupView submit(String workspaceId, String userId, String week) {
        requireWriter(workspaceId, userId);
        /* 先锁会话行：重复提交的第二个请求会等第一个提交完，再看到 submitted 而被拒 */
        catchupMapper.lockSession(workspaceId, userId, parseWeek(week));
        Ctx ctx = load(workspaceId, userId, week, true);
        requireEditable(ctx.session);
        CatchupView current = buildView(ctx);
        LocalDateTime now = LocalDateTime.now();
        if (ctx.session.getStartedAt() == null) {
            ctx.session.setStartedAt(now);
        }

        for (CatchupDraft draft : current.getDrafts()) {
            String decision = draft.getDecision();
            if (!isAccepted(draft) && !"merged".equals(decision)) {
                continue;
            }
            assertTaskWritable(ctx, draft.getTaskId());
            String detail;
            if ("merged".equals(decision)) {
                detail = "周五补记：与已有工作项重复，已合并记录"
                        + (draft.getHours() != null && draft.getHours() > 0 ? " · 本周 " + fmtHours(draft.getHours()) + "h" : "");
            } else {
                String title = Texts.trimToNull(draft.getEditedTitle());
                if (title == null) {
                    title = draft.getTitle();
                }
                String state = draft.getAnswer();
                /* 承接项合并了本周计时时，小时数属于本周；只有没有本周计时才是上周的量 */
                boolean hoursThisWeek = draft.getTaskId() == null
                        || ctx.timeByTask.containsKey(draft.getTaskId());
                String hoursBit = draft.getHours() != null && draft.getHours() > 0
                        ? " · " + (hoursThisWeek ? "本周 " : "上周 ") + fmtHours(draft.getHours()) + "h"
                        : "";
                detail = "周五补记：" + (Boolean.TRUE.equals(draft.getCarried()) ? "补确认上周未处理「" : "确认「")
                        + Texts.cut(title, 80) + "」"
                        + (state != null ? " · 状态：" + state : "")
                        + hoursBit
                        + (Texts.trimToNull(draft.getNote()) != null ? " · 备注：" + Texts.cut(draft.getNote(), 60) : "");
            }
            writeTaskLog(ctx, draft.getTaskId(), detail);
        }

        for (CatchupRisk risk : current.getRisks()) {
            String action = risk.getDecision();
            if (action == null || "ignore".equals(action) || "link".equals(action)) {
                continue;
            }
            assertTaskWritable(ctx, risk.getTaskId());
            if ("confirm".equals(action)) {
                writeTaskLog(ctx, risk.getTaskId(),
                        "周五补记：确认仍在阻塞" + (risk.getReason() != null ? "（原因：" + risk.getReason() + "）" : ""));
            } else if ("record".equals(action) && risk.getTaskId() != null) {
                writeTaskLog(ctx, risk.getTaskId(), "周五补记：" + Texts.cut(risk.getTitle(), 90));
            } else if ("unblock".equals(action)) {
                writeTaskLog(ctx, risk.getTaskId(),
                        "周五补记：解除阻塞" + (risk.getReason() != null ? "（原原因：" + risk.getReason() + "）" : ""));
                Map<String, Object> prev = new LinkedHashMap<String, Object>();
                prev.put("blocked", true);
                prev.put("reason", risk.getReason());
                catchupMapper.updateTaskBlocked(workspaceId, risk.getTaskId(), false, null);
                recordWrite(ctx.session.getId(), "blocked", risk.getTaskId(), toJson(prev));
            }
        }

        /* 未处理/跳过的工作项承接下周：草稿里被 12 条上限挡住的部分也一并承接 */
        catchupMapper.deleteCarryBySession(ctx.session.getId());
        for (CatchupDraft draft : ctx.allDrafts) {
            if (draft.getTaskId() == null) {
                continue;
            }
            String carryReason;
            if ("pending".equals(draft.getDecision())) {
                carryReason = "pending";
            } else if ("skipped".equals(draft.getDecision())) {
                carryReason = "skipped";
            } else {
                continue;
            }
            CatchupCarry carry = new CatchupCarry();
            carry.setFromSessionId(ctx.session.getId());
            carry.setToWeekStart(ctx.weekStart.plusDays(7));
            carry.setTaskId(draft.getTaskId());
            carry.setItemNo(draft.getItemNo());
            String title = Texts.trimToNull(draft.getEditedTitle());
            carry.setTitle(Texts.cut(title == null ? draft.getTitle() : title, 120));
            carry.setProjectName(Texts.cut(draft.getProject(), 80));
            carry.setTypeLabel(Texts.cut(draft.getTypeLabel(), 16));
            carry.setStatusLabel(Texts.cut(draft.getStatusLabel(), 16));
            carry.setMinutes(draft.getHours() == null ? 0 : (int) Math.round(draft.getHours() * 60));
            carry.setReason(carryReason);
            catchupMapper.insertCarry(carry);
        }
        /* 承接只为对应那一周服务：保留本周的，清掉更早的，避免逐周累积 */
        catchupMapper.deleteCarryBefore(ctx.workspaceId, ctx.userId, LocalDate.now().with(DayOfWeek.MONDAY));

        /* 工时归属：提交时把当前网格固化为可撤销记录 */
        CatchupTimeGrid grid = current.getTime();
        catchupMapper.deleteAllocs(ctx.session.getId());
        for (int r = 0; r < grid.getRows().size(); r++) {
            CatchupTimeGrid.Row row = grid.getRows().get(r);
            for (int d = 0; d < row.getMinutes().size(); d++) {
                int minutes = row.getMinutes().get(d) == null ? 0 : row.getMinutes().get(d);
                CatchupTimeAlloc alloc = new CatchupTimeAlloc();
                alloc.setSessionId(ctx.session.getId());
                alloc.setRowKey(row.getKey());
                alloc.setDay(ctx.weekStart.plusDays(d));
                alloc.setReqId(row.getReqId());
                alloc.setMinutes(minutes);
                catchupMapper.insertAlloc(alloc);
            }
        }

        ctx.session.setStatus("submitted");
        ctx.session.setSubmittedAt(now);
        ctx.session.setUndoneAt(null);
        ctx.session.setElapsedSeconds((int) Math.max(0, Duration.between(ctx.session.getStartedAt(), now).getSeconds()));
        ctx.session.setReviewJson(reviewSnapshot(current.getReview()));
        catchupMapper.updateSession(ctx.session);
        CatchupView after = buildView(load(workspaceId, userId, ctx.weekStart.format(ISO), true));
        after.setReview(current.getReview());
        return after;
    }

    /** 5 分钟内撤销提交：按写入台账回滚时间线与阻塞字段。 */
    @Transactional
    public CatchupView undo(String workspaceId, String userId, String week) {
        catchupMapper.lockSession(workspaceId, userId, parseWeek(week));
        Ctx ctx = load(workspaceId, userId, week, false);
        if (ctx.session == null || !"submitted".equals(ctx.session.getStatus())
                || ctx.session.getSubmittedAt() == null) {
            throw AppException.badRequest("本周还没有可撤销的提交");
        }
        if (Duration.between(ctx.session.getSubmittedAt(), LocalDateTime.now()).toMinutes() >= UNDO_MINUTES) {
            throw AppException.badRequest("已超过 " + UNDO_MINUTES + " 分钟，不能撤销；可在工作项时间线中查看本次写入");
        }
        List<CatchupWrite> writes = catchupMapper.selectWrites(ctx.session.getId());
        Collections.reverse(writes);
        for (CatchupWrite write : writes) {
            if ("task_log".equals(write.getWriteType())) {
                try {
                    catchupMapper.deleteTaskLog(workspaceId, Long.valueOf(write.getRefId()));
                } catch (NumberFormatException ignore) {
                    /* 台账异常不阻塞回滚，继续处理其余写入 */
                }
            } else if ("blocked".equals(write.getWriteType())) {
                Map<?, ?> prev = parseMap(write.getPrevJson());
                if (prev == null) {
                    continue;
                }
                boolean blocked = prev.get("blocked") == null
                        || Boolean.TRUE.equals(prev.get("blocked"))
                        || "true".equals(String.valueOf(prev.get("blocked")));
                Object reason = prev.get("reason");
                catchupMapper.updateTaskBlocked(workspaceId, write.getRefId(), blocked,
                        reason == null ? null : Texts.cut(String.valueOf(reason), 120));
            }
        }
        catchupMapper.deleteWrites(ctx.session.getId());
        catchupMapper.deleteCarryBySession(ctx.session.getId());
        ctx.session.setStatus("draft");
        ctx.session.setSubmittedAt(null);
        ctx.session.setUndoneAt(LocalDateTime.now());
        ctx.session.setReviewJson(null);
        catchupMapper.updateSession(ctx.session);
        return buildView(load(workspaceId, userId, ctx.session.getWeekStart().format(ISO), true));
    }

    /** 开始补记：记录计时起点；已开始的会话保持原起点。 */
    @Transactional
    public CatchupView start(String workspaceId, String userId, String week) {
        requireWriter(workspaceId, userId);
        Ctx ctx = load(workspaceId, userId, week, true);
        if ("submitted".equals(ctx.session.getStatus())) {
            return buildView(ctx);
        }
        if (ctx.session.getStartedAt() == null) {
            ctx.session.setStartedAt(LocalDateTime.now());
        }
        if ("skipped".equals(ctx.session.getStatus())) {
            ctx.session.setStatus("draft");
        }
        catchupMapper.updateSession(ctx.session);
        return buildView(load(workspaceId, userId, ctx.weekStart.format(ISO), true));
    }

    /** 确认本周无其他已知风险（可撤销）。 */
    @Transactional
    public CatchupView setNoOtherRisk(String workspaceId, String userId, String week, boolean value) {
        requireWriter(workspaceId, userId);
        Ctx ctx = load(workspaceId, userId, week, true);
        requireEditable(ctx.session);
        ctx.session.setNoOtherRisk(value);
        catchupMapper.updateSession(ctx.session);
        return buildView(load(workspaceId, userId, ctx.weekStart.format(ISO), true));
    }

    /** 本周不补：保留痕迹，下周一继续。 */
    @Transactional
    public CatchupView skip(String workspaceId, String userId, String week) {
        requireWriter(workspaceId, userId);
        Ctx ctx = load(workspaceId, userId, week, true);
        requireEditable(ctx.session);
        ctx.session.setStatus("skipped");
        ctx.session.setSubmittedAt(null);
        catchupMapper.updateSession(ctx.session);
        return buildView(load(workspaceId, userId, ctx.session.getWeekStart().format(ISO), true));
    }

    /* ---------------- 读取与组装 ---------------- */

    private Ctx load(String workspaceId, String userId, String week, boolean create) {
        Ctx ctx = new Ctx();
        ctx.workspaceId = workspaceId;
        ctx.userId = userId;
        ctx.weekStart = parseWeek(week);
        ctx.from = ctx.weekStart.atStartOfDay();
        ctx.to = ctx.weekStart.plusDays(7).atStartOfDay();
        ctx.displayName = displayName(userId);
        ctx.viewerId = projectAccess.viewerScope(workspaceId, userId);

        CatchupSession session = catchupMapper.selectSession(workspaceId, userId, ctx.weekStart);
        if (session == null && create) {
            session = new CatchupSession();
            session.setId(Ids.gen("cp"));
            session.setWorkspaceId(workspaceId);
            session.setUserId(userId);
            session.setWeekStart(ctx.weekStart);
            session.setStatus("draft");
            session.setNoOtherRisk(false);
            catchupMapper.insertSession(session);
            session = catchupMapper.selectSession(workspaceId, userId, ctx.weekStart);
        }
        ctx.session = session;
        if (session != null) {
            for (CatchupDecision d : catchupMapper.selectDecisions(session.getId())) {
                ctx.decisions.put(d.getDraftKey(), d);
            }
        }

        ctx.tasks = catchupMapper.selectMyTasksForWeek(workspaceId, userId, ctx.displayName, ctx.from, ctx.to, ctx.viewerId);
        ctx.timeByTask = new HashMap<String, CatchupTimeSum>();
        for (CatchupTimeSum sum : catchupMapper.selectMyTimeByTask(workspaceId, userId, ctx.from, ctx.to)) {
            ctx.timeByTask.put(sum.getTaskId(), sum);
        }
        ctx.cells = catchupMapper.selectMyTimeGrid(workspaceId, userId, ctx.from, ctx.to, ctx.viewerId);
        ctx.planRows = catchupMapper.selectMyDonePlans(workspaceId, userId, ctx.from, ctx.to, ctx.viewerId);
        ctx.timeRecords = catchupMapper.countMyTimeRecords(workspaceId, userId, ctx.from, ctx.to);
        for (BoardColumn col : boardColumnMapper.selectAll(workspaceId)) {
            ctx.colNames.put(col.getId(), col.getName());
        }
        if (session != null) {
            ctx.allocs = catchupMapper.selectAllocs(session.getId());
        }
        for (CatchupCarry carry : catchupMapper.selectCarryForWeek(workspaceId, userId, ctx.weekStart, ctx.viewerId)) {
            ctx.carriedByTask.put(carry.getTaskId(), carry);
        }
        return ctx;
    }

    private CatchupView buildView(Ctx ctx) {
        CatchupView view = new CatchupView();
        view.setWeekStart(ctx.weekStart.format(ISO));
        view.setWeekEnd(ctx.weekStart.plusDays(6).format(ISO));
        view.setSession(sessionMap(ctx.session));

        List<CatchupDraft> drafts = buildDrafts(ctx);
        view.setDrafts(drafts);
        CatchupTimeGrid grid = buildTime(ctx);
        view.setTime(grid);
        List<CatchupRisk> risks = buildRisks(ctx);
        view.setRisks(risks);
        view.setNoOtherRisk(ctx.session != null && Boolean.TRUE.equals(ctx.session.getNoOtherRisk()));

        int accepted = 0, skipped = 0, merged = 0, edited = 0, answered = 0, pending = 0;
        for (CatchupDraft d : drafts) {
            String decision = d.getDecision();
            if ("accepted".equals(decision)) {
                accepted++;
            } else if ("skipped".equals(decision)) {
                skipped++;
            } else if ("merged".equals(decision)) {
                merged++;
            } else if ("edited".equals(decision)) {
                if ("不是工作项".equals(d.getAnswer())) {
                    skipped++;
                } else {
                    edited++;
                }
            } else if ("answered".equals(decision)) {
                if ("不是工作项".equals(d.getAnswer())) {
                    skipped++;
                } else {
                    answered++;
                }
            } else {
                pending++;
            }
        }
        /* 交付物卡只是本周事实，不算「未处理的风险」；风险计数只含阻塞与承诺变化 */
        int riskHandled = 0, riskTotal = 0;
        for (CatchupRisk r : risks) {
            if ("info".equals(r.getKind())) {
                continue;
            }
            riskTotal++;
            if (r.getDecision() != null && !"ignore".equals(r.getDecision())) {
                riskHandled++;
            }
        }
        Map<String, Object> counts = new LinkedHashMap<String, Object>();
        counts.put("total", drafts.size());
        counts.put("high", countConfidence(drafts, "high"));
        counts.put("need", drafts.size() - countConfidence(drafts, "high"));
        counts.put("accepted", accepted);
        counts.put("edited", edited);
        counts.put("answered", answered);
        counts.put("merged", merged);
        counts.put("skipped", skipped);
        counts.put("pending", pending);
        counts.put("done", accepted + edited + answered + merged);
        counts.put("hidden", ctx.hiddenDrafts);
        counts.put("carried", countCarried(drafts));
        counts.put("riskHandled", riskHandled);
        counts.put("riskTotal", riskTotal);
        counts.put("timeTotalMinutes", grid.getTotalMinutes());
        counts.put("timeAssignedMinutes", grid.getAssignedMinutes());
        counts.put("timeUnassignedMinutes", grid.getUnassignedMinutes());
        counts.put("timeTotalHours", roundHours(grid.getTotalMinutes()) + "h");
        counts.put("timeAssignedHours", roundHours(grid.getAssignedMinutes()) + "h");
        counts.put("timeUnassignedHours", roundHours(grid.getUnassignedMinutes()) + "h");
        view.setCounts(counts);

        Map<String, Object> activity = new LinkedHashMap<String, Object>();
        int completed = 0, updated = 0;
        for (CatchupTaskRow t : ctx.tasks) {
            if (inWeek(t.getCompletedAt(), ctx)) {
                completed++;
            }
            if (inWeek(t.getUpdatedAt(), ctx)) {
                updated++;
            }
        }
        activity.put("tasks", ctx.tasks.size());
        activity.put("completed", completed);
        activity.put("updated", updated);
        activity.put("timeRecords", ctx.timeRecords);
        activity.put("plans", ctx.planRows.size());
        activity.put("total", ctx.tasks.size() + ctx.timeRecords + ctx.planRows.size());
        view.setActivity(activity);
        view.setReview(buildReview(drafts, risks));
        return view;
    }

    private List<CatchupDraft> buildDrafts(Ctx ctx) {
        List<CatchupDraft> list = new ArrayList<CatchupDraft>();
        for (CatchupTaskRow t : ctx.tasks) {
            CatchupTimeSum sum = ctx.timeByTask.get(t.getTaskId());
            int minutes = sum == null || sum.getMinutes() == null ? 0 : sum.getMinutes();
            boolean done = inWeek(t.getCompletedAt(), ctx) && t.getCompletedAt() != null;
            boolean updated = inWeek(t.getUpdatedAt(), ctx) && t.getUpdatedAt() != null
                    && (t.getCreatedAt() == null || t.getUpdatedAt().isAfter(t.getCreatedAt().plusSeconds(1)));
            boolean createdOnly = inWeek(t.getCreatedAt(), ctx) && t.getCreatedAt() != null && !done && !updated && minutes == 0;
            boolean timed = minutes > 0;

            CatchupDraft d = new CatchupDraft();
            d.setKey("task:" + t.getTaskId());
            d.setTaskId(t.getTaskId());
            d.setItemNo(t.getItemNo());
            d.setTitle(t.getTitle());
            d.setProject(t.getReqName() == null ? "未归属项目" : t.getReqName());
            d.setType(t.getItemType());
            d.setTypeLabel(typeLabel(t.getItemType()));
            d.setHours(roundHours(minutes));
            String statusKey = done ? "done" : (Boolean.TRUE.equals(t.getBlocked()) ? "blocked" : t.getBoardColumn());
            d.setStatus(statusKey);
            d.setStatusLabel(statusLabel(t, ctx));
            String confidence;
            if ((done && (timed || updated)) || (timed && minutes >= 60 && updated)) {
                confidence = "high";
            } else if (done || timed || updated) {
                confidence = "mid";
            } else {
                confidence = "low";
            }
            d.setConfidence(confidence);
            d.setWhy(whyText(done, timed, updated, createdOnly, minutes, t));
            if ("low".equals(confidence)) {
                d.setQuestion(createdOnly
                        ? "只看到你创建了这条工作项，没有计时或更新。这条算完成了吗？"
                        : "这条只有一次弱信号，无法判断进展。现在是什么状态？");
            }
            fillEvidence(d, t, sum, ctx, done);
            CatchupCarry carry = ctx.carriedByTask.get(t.getTaskId());
            if (carry != null) {
                d.setCarried(true);
                d.getEvidence().add(0, carryEvidence(carry));
                d.setWhy("上周补记" + carryReasonText(carry) + "；" + d.getWhy());
            }
            CatchupDecision dec = ctx.decisions.get(d.getKey());
            attachDecision(d, dec);
            list.add(d);
        }
        for (CatchupCarry carry : ctx.carriedByTask.values()) {
            if (containsTask(list, carry.getTaskId())) {
                continue;
            }
            CatchupDraft d = new CatchupDraft();
            d.setKey("task:" + carry.getTaskId());
            d.setTaskId(carry.getTaskId());
            d.setItemNo(carry.getItemNo());
            d.setTitle(carry.getTitle());
            d.setProject(carry.getProjectName() == null ? "未归属项目" : carry.getProjectName());
            d.setTypeLabel(carry.getTypeLabel() == null ? "工作项" : carry.getTypeLabel());
            d.setStatusLabel(carry.getStatusLabel());
            d.setHours(roundHours(carry.getMinutes() == null ? 0 : carry.getMinutes()));
            d.setConfidence("mid");
            d.setCarried(true);
            d.setWhy("上周补记" + carryReasonText(carry) + "，本周接着确认。");
            d.getEvidence().add(carryEvidence(carry));
            attachDecision(d, ctx.decisions.get(d.getKey()));
            list.add(d);
        }
        Collections.sort(list, new Comparator<CatchupDraft>() {
            @Override
            public int compare(CatchupDraft a, CatchupDraft b) {
                int carryRank = (Boolean.TRUE.equals(a.getCarried()) ? 0 : 1)
                        - (Boolean.TRUE.equals(b.getCarried()) ? 0 : 1);
                if (carryRank != 0) {
                    return carryRank;
                }
                int c = confRank(a.getConfidence()) - confRank(b.getConfidence());
                if (c != 0) {
                    return c;
                }
                return Double.compare(b.getHours() == null ? 0 : b.getHours(), a.getHours() == null ? 0 : a.getHours());
            }
        });
        ctx.allDrafts = new ArrayList<CatchupDraft>(list);
        if (list.size() > MAX_DRAFTS) {
            ctx.hiddenDrafts = list.size() - MAX_DRAFTS;
            list = new ArrayList<CatchupDraft>(list.subList(0, MAX_DRAFTS));
        }
        markDuplicates(list);
        return list;
    }

    private static boolean containsTask(List<CatchupDraft> list, String taskId) {
        for (CatchupDraft d : list) {
            if (taskId.equals(d.getTaskId())) {
                return true;
            }
        }
        return false;
    }

    private static String carryReasonText(CatchupCarry carry) {
        return "skipped".equals(carry.getReason()) ? "跳过了这条" : "没来得及确认";
    }

    private CatchupEvidence carryEvidence(CatchupCarry carry) {
        return new CatchupEvidence("carry", "上周未处理",
                "上周补记" + carryReasonText(carry) + " · 原状态：" + (carry.getStatusLabel() == null ? "未知" : carry.getStatusLabel()),
                mdhm(carry.getCreatedAt()));
    }

    private void fillEvidence(CatchupDraft d, CatchupTaskRow t, CatchupTimeSum sum, Ctx ctx, boolean done) {
        List<CatchupEvidence> ev = new ArrayList<CatchupEvidence>();
        if (done) {
            ev.add(new CatchupEvidence("status", "工作项" + itemNo(t.getItemNo()),
                    "状态：完成 · 负责人：" + ownerText(t), mdhm(t.getCompletedAt())));
        } else if (inWeek(t.getUpdatedAt(), ctx)) {
            ev.add(new CatchupEvidence("update", "工作项" + itemNo(t.getItemNo()),
                    "本周有更新 · 状态：" + d.getStatusLabel() + " · 负责人：" + ownerText(t), mdhm(t.getUpdatedAt())));
        } else {
            ev.add(new CatchupEvidence("created", "工作项" + itemNo(t.getItemNo()),
                    "本周新建 · 状态：" + d.getStatusLabel(), mdhm(t.getCreatedAt())));
        }
        if (sum != null && sum.getMinutes() != null && sum.getMinutes() > 0) {
            ev.add(new CatchupEvidence("time", "计时 · 本周 " + fmtHours(roundHours(sum.getMinutes())) + "h",
                    (sum.getCnt() == null ? 0 : sum.getCnt()) + " 条记录", mdhm(sum.getLastAt())));
        }
        if (Boolean.TRUE.equals(t.getBlocked())) {
            ev.add(new CatchupEvidence("blocked", "阻塞",
                    Texts.trimToNull(t.getBlockedReason()) == null ? "已标记为阻塞，未填写原因" : t.getBlockedReason(),
                    mdhm(t.getUpdatedAt())));
        }
        if (done && t.getDueDate() != null && t.getCompletedAt() != null
                && t.getCompletedAt().toLocalDate().isAfter(t.getDueDate())) {
            ev.add(new CatchupEvidence("late", "晚于截止日完成",
                    "计划 " + t.getDueDate().format(ISO) + " · 实际 " + t.getCompletedAt().toLocalDate().format(ISO),
                    mdhm(t.getCompletedAt())));
        }
        if (ev.size() > 5) {
            ev = new ArrayList<CatchupEvidence>(ev.subList(0, 5));
        }
        d.setEvidence(ev);
    }

    private void markDuplicates(List<CatchupDraft> list) {
        for (int i = 0; i < list.size(); i++) {
            for (int j = i + 1; j < list.size(); j++) {
                CatchupDraft a = list.get(i);
                CatchupDraft b = list.get(j);
                if (a.getDuplicate() != null || b.getDuplicate() != null) {
                    continue;
                }
                if (!similar(a.getTitle(), b.getTitle())) {
                    continue;
                }
                CatchupDraft keep = hours(a) >= hours(b) ? a : b;
                CatchupDraft dup = keep == a ? b : a;
                String target = (itemNo(keep.getItemNo()) + " " + (keep.getTitle() == null ? "" : keep.getTitle())).trim();
                dup.setDuplicate(target + "（" + keep.getStatusLabel() + "）");
            }
        }
    }

    private CatchupTimeGrid buildTime(Ctx ctx) {
        List<LocalDate> days = new ArrayList<LocalDate>();
        for (int i = 0; i < 7; i++) {
            days.add(ctx.weekStart.plusDays(i));
        }
        Map<String, int[]> raw = new LinkedHashMap<String, int[]>();
        Map<String, String> reqNames = new HashMap<String, String>();
        for (CatchupTimeCell cell : ctx.cells) {
            if (cell.getDay() == null) {
                continue;
            }
            int idx = (int) (cell.getDay().toEpochDay() - ctx.weekStart.toEpochDay());
            if (idx < 0 || idx > 6) {
                continue;
            }
            String key = cell.getReqId() == null ? "unassigned" : "req:" + cell.getReqId();
            int[] mins = raw.get(key);
            if (mins == null) {
                mins = new int[7];
                raw.put(key, mins);
            }
            mins[idx] += cell.getMinutes() == null ? 0 : cell.getMinutes();
            if (cell.getReqName() != null) {
                reqNames.put(key, cell.getReqName());
            }
        }
        Map<String, Map<Integer, Integer>> alloc = new HashMap<String, Map<Integer, Integer>>();
        boolean hasAlloc = false;
        if (ctx.allocs != null) {
            for (CatchupTimeAlloc a : ctx.allocs) {
                int idx = (int) (a.getDay().toEpochDay() - ctx.weekStart.toEpochDay());
                if (idx < 0 || idx > 6) {
                    continue;
                }
                Map<Integer, Integer> byDay = alloc.get(a.getRowKey());
                if (byDay == null) {
                    byDay = new HashMap<Integer, Integer>();
                    alloc.put(a.getRowKey(), byDay);
                }
                byDay.put(idx, a.getMinutes() == null ? 0 : a.getMinutes());
                hasAlloc = true;
            }
        }

        Set<String> keys = new LinkedHashSet<String>(raw.keySet());
        keys.addAll(alloc.keySet());
        List<CatchupTimeGrid.Row> rows = new ArrayList<CatchupTimeGrid.Row>();
        for (String key : keys) {
            int[] mins = new int[7];
            int[] rawMins = raw.get(key);
            for (int i = 0; i < 7; i++) {
                Integer override = hasAlloc && alloc.containsKey(key) ? alloc.get(key).get(i) : null;
                mins[i] = override != null ? override : (rawMins == null ? 0 : rawMins[i]);
            }
            boolean any = false;
            for (int m : mins) {
                if (m > 0) {
                    any = true;
                    break;
                }
            }
            if (!any && !"unassigned".equals(key)) {
                continue;
            }
            CatchupTimeGrid.Row row = new CatchupTimeGrid.Row();
            row.setKey(key);
            row.setReqId("unassigned".equals(key) ? null : key.substring(4));
            row.setKind("unassigned".equals(key) ? "unassigned" : "project");
            row.setName("unassigned".equals(key) ? "内部 / 其他" : reqNames.getOrDefault(key, "项目"));
            for (int m : mins) {
                row.getMinutes().add(m);
            }
            rows.add(row);
        }
        Collections.sort(rows, new Comparator<CatchupTimeGrid.Row>() {
            @Override
            public int compare(CatchupTimeGrid.Row a, CatchupTimeGrid.Row b) {
                if ("unassigned".equals(a.getKey())) {
                    return 1;
                }
                if ("unassigned".equals(b.getKey())) {
                    return -1;
                }
                return total(b) - total(a);
            }
        });

        CatchupTimeGrid grid = new CatchupTimeGrid();
        for (LocalDate day : days) {
            grid.getDays().add(day.format(ISO));
        }
        int total = 0, unassigned = 0;
        for (CatchupTimeGrid.Row row : rows) {
            int rowTotal = total(row);
            total += rowTotal;
            if ("unassigned".equals(row.getKey())) {
                unassigned = rowTotal;
            }
        }
        grid.setRows(rows);
        grid.setTotalMinutes(total);
        grid.setUnassignedMinutes(unassigned);
        grid.setAssignedMinutes(Math.max(0, total - unassigned));
        return grid;
    }

    private List<CatchupRisk> buildRisks(Ctx ctx) {
        List<CatchupRisk> risks = new ArrayList<CatchupRisk>();
        for (CatchupTaskRow t : ctx.tasks) {
            if (risks.size() >= MAX_RISKS) {
                break;
            }
            if (Boolean.TRUE.equals(t.getBlocked())) {
                CatchupRisk r = new CatchupRisk();
                r.setKey("risk:blocked:" + t.getTaskId());
                r.setKind("danger");
                r.setLabel("阻塞");
                r.setTaskId(t.getTaskId());
                r.setReason(Texts.trimToNull(t.getBlockedReason()));
                r.setTitle(t.getTitle() + " 仍在阻塞");
                r.setMeta("项目：" + (t.getReqName() == null ? "未归属项目" : t.getReqName())
                        + " · 负责人：" + ownerText(t)
                        + (r.getReason() == null ? " · 影响待补充" : " · 原因：" + r.getReason()));
                r.setQuote("工作项" + itemNo(t.getItemNo()) + " · 最近更新 " + mdhm(t.getUpdatedAt()));
                attachRiskDecision(r, ctx);
                risks.add(r);
            }
            if (inWeek(t.getCompletedAt(), ctx) && t.getCompletedAt() != null
                    && t.getDueDate() != null && t.getCompletedAt().toLocalDate().isAfter(t.getDueDate())) {
                CatchupRisk r = new CatchupRisk();
                r.setKey("risk:late:" + t.getTaskId());
                r.setKind("warn");
                r.setLabel("承诺变化");
                r.setTaskId(t.getTaskId());
                long late = t.getCompletedAt().toLocalDate().toEpochDay() - t.getDueDate().toEpochDay();
                r.setTitle(t.getTitle() + " 延期 " + late + " 天完成");
                r.setMeta("计划 " + t.getDueDate().format(ISO) + " · 实际 " + t.getCompletedAt().toLocalDate().format(ISO)
                        + " · 项目：" + (t.getReqName() == null ? "未归属项目" : t.getReqName()));
                r.setQuote("工作项" + itemNo(t.getItemNo()) + " · 完成于 " + mdhm(t.getCompletedAt()));
                attachRiskDecision(r, ctx);
                risks.add(r);
            }
        }
        for (CatchupPlanRow p : ctx.planRows) {
            if (risks.size() >= MAX_RISKS) {
                break;
            }
            CatchupRisk r = new CatchupRisk();
            r.setKey("risk:plan:" + p.getPlanId());
            r.setKind("info");
            r.setLabel("交付物");
            r.setPlanId(p.getPlanId());
            r.setTitle(p.getName() + " 已完成");
            r.setMeta("测试计划 · 执行 " + (p.getExecutedCount() == null ? 0 : p.getExecutedCount()) + " 条"
                    + " · 项目：" + (p.getReqName() == null ? "未归属项目" : p.getReqName()));
            r.setQuote("测试计划 · 最近更新 " + mdhm(p.getUpdatedAt()));
            attachRiskDecision(r, ctx);
            risks.add(r);
        }
        return risks;
    }

    private void attachDecision(CatchupDraft d, CatchupDecision dec) {
        if (dec == null) {
            d.setDecision("pending");
            return;
        }
        d.setAnswer(dec.getAnswer());
        d.setEditedTitle(dec.getTitle());
        d.setNote(dec.getPayloadJson());
        String action = dec.getAction();
        if ("accept".equals(action)) {
            d.setDecision("accepted");
        } else if ("skip".equals(action)) {
            d.setDecision("skipped");
        } else if ("merge".equals(action)) {
            d.setDecision("merged");
        } else if ("edit".equals(action)) {
            d.setDecision("edited");
        } else if ("answer".equals(action)) {
            d.setDecision("answered");
        } else {
            d.setDecision("pending");
        }
    }

    private void attachRiskDecision(CatchupRisk r, Ctx ctx) {
        CatchupDecision dec = ctx.decisions.get(r.getKey());
        r.setDecision(dec == null ? null : dec.getAction());
    }

    private Map<String, Object> sessionMap(CatchupSession s) {
        Map<String, Object> map = new LinkedHashMap<String, Object>();
        if (s == null) {
            map.put("status", "none");
            map.put("elapsedSeconds", 0);
            map.put("noOtherRisk", false);
            return map;
        }
        map.put("id", s.getId());
        map.put("status", s.getStatus());
        map.put("startedAt", s.getStartedAt());
        map.put("submittedAt", s.getSubmittedAt());
        map.put("elapsedSeconds", s.getElapsedSeconds() == null ? 0 : s.getElapsedSeconds());
        map.put("noOtherRisk", Boolean.TRUE.equals(s.getNoOtherRisk()));
        if (s.getSubmittedAt() != null) {
            map.put("undoUntil", s.getSubmittedAt().plusMinutes(UNDO_MINUTES));
        }
        return map;
    }

    private Map<String, Object> buildReview(List<CatchupDraft> drafts, List<CatchupRisk> risks) {
        List<String> done = new ArrayList<String>();
        List<String> next = new ArrayList<String>();
        for (CatchupDraft d : drafts) {
            if (!isAccepted(d) && !"merged".equals(d.getDecision())) {
                continue;
            }
            if ("完成".equals(d.getAnswer()) || "done".equals(d.getStatus())) {
                done.add(d.getTitle());
            } else {
                next.add(d.getTitle());
            }
        }
        List<String> help = new ArrayList<String>();
        for (CatchupRisk r : risks) {
            if ("danger".equals(r.getKind())) {
                help.add(r.getTitle());
            }
        }
        Map<String, Object> review = new LinkedHashMap<String, Object>();
        review.put("done", done.isEmpty() ? "本周还没有确认完成的工作项。" : joinTitles(done, 4) + "。");
        review.put("next", next.isEmpty() ? "未确认下一步计划，可在工作项里继续补充。" : joinTitles(next, 4) + "。");
        review.put("help", help.isEmpty() ? "本周没有识别到阻塞。" : joinTitles(help, 3) + "，需要推动解除。");
        return review;
    }

    private String reviewSnapshot(Map<String, Object> review) {
        return "本周完成：" + review.get("done") + "\n下周计划：" + review.get("next") + "\n需要支持：" + review.get("help");
    }

    /* ---------------- 写入 ---------------- */

    private TaskLog writeTaskLog(Ctx ctx, String taskId, String detail) {
        if (taskId == null) {
            return null;
        }
        TaskLog log = new TaskLog();
        log.setTaskId(taskId);
        log.setWorkspaceId(ctx.workspaceId);
        log.setActorId(ctx.userId);
        log.setAction("catchup");
        log.setDetail(Texts.cut(detail, 500));
        Map<String, Object> change = new LinkedHashMap<String, Object>();
        change.put("sessionId", ctx.session.getId());
        log.setChangeData(toJson(change));
        catchupMapper.insertTaskLog(log);
        recordWrite(ctx.session.getId(), "task_log", String.valueOf(log.getId()), null);
        return log;
    }

    private void recordWrite(String sessionId, String type, String refId, String prevJson) {
        CatchupWrite w = new CatchupWrite();
        w.setSessionId(sessionId);
        w.setWriteType(type);
        w.setRefId(refId);
        w.setPrevJson(prevJson);
        catchupMapper.insertWrite(w);
    }

    /* ---------------- 工具 ---------------- */

    private void requireEditable(CatchupSession session) {
        if (session == null) {
            throw AppException.badRequest("补记会话不存在");
        }
        if ("submitted".equals(session.getStatus())) {
            throw AppException.badRequest("本周补记已提交；如需修改，请在提交后 " + UNDO_MINUTES + " 分钟内撤销");
        }
    }

    /** 查看者在此空间全局只读：补记也不给写入口（项目级写权限在具体工作项上再校）。 */
    private void requireWriter(String workspaceId, String userId) {
        if (!projectAccess.canWrite(workspaceId, userId, null)) {
            throw new AppException(403, "你在此空间是查看者，只能查看不能修改");
        }
    }

    /** 补记会写工作项时间线/解除阻塞，按工作项所属项目校验写权限。 */
    private void assertTaskWritable(Ctx ctx, String taskId) {
        if (taskId == null) {
            return;
        }
        String reqId = catchupMapper.selectTaskReqId(ctx.workspaceId, taskId);
        projectAccess.assertWrite(ctx.workspaceId, ctx.userId, reqId);
    }

    private LocalDate parseWeek(String week) {
        LocalDate d;
        String w = Texts.trimToNull(week);
        if (w == null) {
            d = LocalDate.now();
        } else {
            try {
                d = LocalDate.parse(w);
            } catch (Exception e) {
                throw AppException.badRequest("周日期格式应为 yyyy-MM-dd");
            }
        }
        d = d.with(DayOfWeek.MONDAY);
        LocalDate current = LocalDate.now().with(DayOfWeek.MONDAY);
        if (d.isAfter(current)) {
            d = current;
        }
        return d;
    }

    private String displayName(String userId) {
        AppUser me = userMapper.selectById(userId);
        return me == null ? null : Texts.trimToNull(me.getDisplayName());
    }

    private String statusLabel(CatchupTaskRow t, Ctx ctx) {
        if (t.getCompletedAt() != null) {
            return "完成";
        }
        if (Boolean.TRUE.equals(t.getBlocked())) {
            return "阻塞";
        }
        String name = ctx.colNames.get(t.getBoardColumn());
        if (name != null) {
            return name;
        }
        String fallback = COLUMN_FALLBACK.get(t.getBoardColumn());
        return fallback == null ? (t.getBoardColumn() == null ? "待处理" : t.getBoardColumn()) : fallback;
    }

    private String typeLabel(String type) {
        String label = TYPE_LABELS.get(type);
        return label == null ? "工作项" : label;
    }

    private String whyText(boolean done, boolean timed, boolean updated, boolean createdOnly, int minutes, CatchupTaskRow t) {
        List<String> bits = new ArrayList<String>();
        if (done) {
            bits.add("本周完成");
        }
        if (timed) {
            bits.add("本周计时 " + fmtHours(roundHours(minutes)) + "h");
        }
        if (updated) {
            bits.add("状态或字段有更新");
        }
        if (createdOnly) {
            bits.add("本周新建，暂无计时或更新");
        }
        if (Boolean.TRUE.equals(t.getBlocked())) {
            bits.add("当前标记为阻塞");
        }
        if (bits.isEmpty()) {
            bits.add("本周有一条弱信号");
        }
        return join(bits, "；") + "。";
    }

    private String ownerText(CatchupTaskRow t) {
        return t.getOwnerUserId() != null ? "我" : "我（按显示名匹配）";
    }

    private boolean isAccepted(CatchupDraft d) {
        String decision = d.getDecision();
        if ("accepted".equals(decision)) {
            return true;
        }
        if ("edited".equals(decision) || "answered".equals(decision)) {
            return !"不是工作项".equals(d.getAnswer());
        }
        return false;
    }

    private int countConfidence(List<CatchupDraft> drafts, String conf) {
        int n = 0;
        for (CatchupDraft d : drafts) {
            if (conf.equals(d.getConfidence())) {
                n++;
            }
        }
        return n;
    }

    private int countCarried(List<CatchupDraft> drafts) {
        int n = 0;
        for (CatchupDraft d : drafts) {
            if (Boolean.TRUE.equals(d.getCarried())) {
                n++;
            }
        }
        return n;
    }

    private int confRank(String conf) {
        return "high".equals(conf) ? 0 : ("mid".equals(conf) ? 1 : 2);
    }

    private Double hours(CatchupDraft d) {
        return d.getHours() == null ? 0 : d.getHours();
    }

    private static int total(CatchupTimeGrid.Row row) {
        int n = 0;
        for (Integer m : row.getMinutes()) {
            n += m == null ? 0 : m;
        }
        return n;
    }

    private static boolean inWeek(LocalDateTime time, Ctx ctx) {
        return time != null && !time.isBefore(ctx.from) && time.isBefore(ctx.to);
    }

    private static boolean similar(String a, String b) {
        if (a == null || b == null) {
            return false;
        }
        String x = normalize(a);
        String y = normalize(b);
        if (x.length() < 4 || y.length() < 4) {
            return false;
        }
        if (x.equals(y)) {
            return true;
        }
        return (x.length() >= 6 && y.contains(x)) || (y.length() >= 6 && x.contains(y));
    }

    private static String normalize(String title) {
        return title.replaceAll("[\\s\\p{Punct}，。；：！？、（）【】《》“”‘’…—·]", "").toLowerCase();
    }

    private static String itemNo(Integer no) {
        return no == null ? "" : " #" + no;
    }

    private static String fmtHours(double h) {
        if (Math.abs(h - Math.rint(h)) < 0.001) {
            return String.valueOf((long) Math.rint(h));
        }
        return String.valueOf(h);
    }

    private static double roundHours(int minutes) {
        return Math.round(minutes / 6.0) / 10.0;
    }

    private static String mdhm(LocalDateTime time) {
        return time == null ? "" : time.format(MD_HM);
    }

    private static String join(List<String> bits, String sep) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < bits.size(); i++) {
            if (i > 0) {
                sb.append(sep);
            }
            sb.append(bits.get(i));
        }
        return sb.toString();
    }

    private static String joinTitles(List<String> titles, int max) {
        List<String> picked = new ArrayList<String>();
        for (int i = 0; i < titles.size() && i < max; i++) {
            picked.add(titles.get(i));
        }
        String text = join(picked, "；");
        if (titles.size() > max) {
            text += " 等 " + titles.size() + " 项";
        }
        return text;
    }

    private static int num(Object v) {
        return v instanceof Number ? ((Number) v).intValue() : 0;
    }

    private CatchupDraft findDraft(List<CatchupDraft> drafts, String key) {
        for (CatchupDraft d : drafts) {
            if (key.equals(d.getKey())) {
                return d;
            }
        }
        return null;
    }

    private CatchupRisk findRisk(List<CatchupRisk> risks, String key) {
        for (CatchupRisk r : risks) {
            if (key.equals(r.getKey())) {
                return r;
            }
        }
        return null;
    }

    private String toJson(Object value) {
        try {
            return json.writeValueAsString(value);
        } catch (Exception e) {
            return null;
        }
    }

    private Map<?, ?> parseMap(String text) {
        if (Texts.trimToNull(text) == null) {
            return null;
        }
        try {
            return json.readValue(text, Map.class);
        } catch (Exception e) {
            return null;
        }
    }

    /** 一次查询的上下文：避免草稿、工时与风险各查一遍任务/决策。 */
    private static class Ctx {
        String workspaceId;
        String userId;
        String displayName;
        String viewerId;
        LocalDate weekStart;
        LocalDateTime from;
        LocalDateTime to;
        CatchupSession session;
        List<CatchupTaskRow> tasks = new ArrayList<CatchupTaskRow>();
        Map<String, CatchupTimeSum> timeByTask = new HashMap<String, CatchupTimeSum>();
        List<CatchupTimeCell> cells = new ArrayList<CatchupTimeCell>();
        List<CatchupPlanRow> planRows = new ArrayList<CatchupPlanRow>();
        int timeRecords;
        Map<String, CatchupDecision> decisions = new HashMap<String, CatchupDecision>();
        Map<String, String> colNames = new HashMap<String, String>();
        List<CatchupTimeAlloc> allocs;
        Map<String, CatchupCarry> carriedByTask = new LinkedHashMap<String, CatchupCarry>();
        List<CatchupDraft> allDrafts = new ArrayList<CatchupDraft>();
        int hiddenDrafts;
    }
}
