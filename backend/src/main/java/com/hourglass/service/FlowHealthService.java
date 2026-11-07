package com.hourglass.service;

import com.hourglass.common.Consts;
import com.hourglass.dto.FlowHealthResponse;
import com.hourglass.dto.FlowHealthResponse.ColumnStat;
import com.hourglass.dto.FlowHealthResponse.Insight;
import com.hourglass.dto.FlowHealthResponse.PriorityStat;
import com.hourglass.dto.FlowHealthResponse.ReqDocLite;
import com.hourglass.dto.FlowMoveRow;
import com.hourglass.dto.FlowReqDocRow;
import com.hourglass.dto.FlowTaskRow;
import com.hourglass.entity.BoardColumn;
import com.hourglass.mapper.BoardColumnMapper;
import com.hourglass.mapper.FlowHealthMapper;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 流程体检：把 task_log 里的移动痕迹，算成「哪一列最堵 / 返工多不多 / 需求多久才开工」。
 *
 * <p>刻意不做预测、不接 AI：这里的每个数字都能回溯到具体日志，用户才敢拿它改流程。
 */
@Service
public class FlowHealthService {

    /** detail 的历史格式：从「待处理」移动到「进行中」 */
    private static final Pattern MOVE_DETAIL = Pattern.compile("从「(.+?)」移动到「(.+?)」");

    private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("yyyy-MM-dd");
    private static final DateTimeFormatter STAMP = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm");

    private final FlowHealthMapper flowHealthMapper;
    private final BoardColumnMapper columnMapper;
    private final ProjectAccessService projectAccess;

    public FlowHealthService(FlowHealthMapper flowHealthMapper, BoardColumnMapper columnMapper,
                             ProjectAccessService projectAccess) {
        this.flowHealthMapper = flowHealthMapper;
        this.columnMapper = columnMapper;
        this.projectAccess = projectAccess;
    }

    /** 默认看近 90 天：太短看不出瓶颈，太长会把几个月前的旧习惯混进来 */
    public FlowHealthResponse flowHealth(String workspaceId, String userId, Integer days) {
        int range = (days == null || days <= 0) ? 90 : Math.min(days, 730);
        LocalDateTime now = LocalDateTime.now();
        LocalDateTime since = now.minusDays(range);
        List<BoardColumn> columns = columnMapper.selectAll(workspaceId);
        List<FlowMoveRow> moves = flowHealthMapper.selectMoves(workspaceId, since);
        List<FlowTaskRow> tasks = flowHealthMapper.selectTasks(workspaceId);
        List<FlowReqDocRow> reqDocs = flowHealthMapper.selectReqDocs(workspaceId);
        java.util.Set<String> hidden = projectAccess.hiddenProjectIds(workspaceId, userId);
        if (!hidden.isEmpty()) {
            moves = filterMoves(moves, hidden);
            tasks = filterTasks(tasks, hidden);
            reqDocs = filterReqDocs(reqDocs, hidden);
        }
        return compute(columns, moves, tasks, reqDocs, range, since, now);
    }

    private List<FlowMoveRow> filterMoves(List<FlowMoveRow> list, java.util.Set<String> hidden) {
        List<FlowMoveRow> out = new ArrayList<FlowMoveRow>();
        for (FlowMoveRow r : list) {
            if (r.getReqId() == null || !hidden.contains(r.getReqId())) {
                out.add(r);
            }
        }
        return out;
    }

    private List<FlowTaskRow> filterTasks(List<FlowTaskRow> list, java.util.Set<String> hidden) {
        List<FlowTaskRow> out = new ArrayList<FlowTaskRow>();
        for (FlowTaskRow r : list) {
            if (r.getReqId() == null || !hidden.contains(r.getReqId())) {
                out.add(r);
            }
        }
        return out;
    }

    private List<FlowReqDocRow> filterReqDocs(List<FlowReqDocRow> list, java.util.Set<String> hidden) {
        List<FlowReqDocRow> out = new ArrayList<FlowReqDocRow>();
        for (FlowReqDocRow r : list) {
            if (r.getReqId() == null || !hidden.contains(r.getReqId())) {
                out.add(r);
            }
        }
        return out;
    }

    // ==================== 纯计算（无 Spring 依赖，可直接单测） ====================

    FlowHealthResponse compute(List<BoardColumn> columns,
                               List<FlowMoveRow> moves,
                               List<FlowTaskRow> tasks,
                               List<FlowReqDocRow> reqDocs,
                               int rangeDays,
                               LocalDateTime since,
                               LocalDateTime now) {
        FlowHealthResponse res = new FlowHealthResponse();
        res.setRangeDays(rangeDays);
        res.setSince(since.format(DAY));
        res.setGeneratedAt(now.format(STAMP));

        /* ---------- 列字典：id → 顺序/名称/颜色；名称 → id（历史文本兜底用） ---------- */
        Map<String, Integer> orderOf = new HashMap<String, Integer>();
        Map<String, BoardColumn> colById = new LinkedHashMap<String, BoardColumn>();
        Map<String, String> idByName = new HashMap<String, String>();
        int seq = 0;
        int maxSort = 0;
        for (BoardColumn c : columns) {
            int so = c.getSortOrder() == null ? seq : c.getSortOrder();
            orderOf.put(c.getId(), so);
            colById.put(c.getId(), c);
            if (c.getName() != null && !idByName.containsKey(c.getName())) {
                idByName.put(c.getName(), c.getId());
            }
            if (so > maxSort) {
                maxSort = so;
            }
            seq++;
        }
        /* 内置三列的兜底：done 不落 board_column 表（该表只种 backlog/doing），
           但「从已完成拖回进行中」要靠它的顺序判回退，历史 detail 兜底解析也要靠它的名字。
           done 的顺序永远排在所有自定义列之后 —— 它是流程终点。 */
        if (!orderOf.containsKey(Consts.COL_BACKLOG)) {
            orderOf.put(Consts.COL_BACKLOG, 0);
        }
        if (!orderOf.containsKey(Consts.COL_DOING)) {
            orderOf.put(Consts.COL_DOING, 1);
        }
        if (!orderOf.containsKey(Consts.COL_DONE)) {
            orderOf.put(Consts.COL_DONE, maxSort + 1);
        }
        for (Map.Entry<String, String> e : Consts.COLUMN_NAMES.entrySet()) {
            if (!idByName.containsKey(e.getValue())) {
                idByName.put(e.getValue(), e.getKey());
            }
        }

        /* ---------- 移动事件：解析出 from/to，过滤掉列内排序 ---------- */
        Map<String, List<ParsedMove>> byTask = new HashMap<String, List<ParsedMove>>();
        int usable = 0;
        int backMoves = 0;
        for (FlowMoveRow m : moves) {
            ParsedMove pm = parse(m, idByName);
            if (pm == null || pm.from.equals(pm.to)) {
                continue; /* 列内顺序调整：不是流程事件 */
            }
            usable++;
            Integer of = orderOf.get(pm.from);
            Integer ot = orderOf.get(pm.to);
            if (of != null && ot != null && ot < of) {
                backMoves++;
            }
            if (!byTask.containsKey(m.getTaskId())) {
                byTask.put(m.getTaskId(), new ArrayList<ParsedMove>());
            }
            byTask.get(m.getTaskId()).add(pm);
        }

        /* ---------- 按任务切段，累加到各列 ---------- */
        Map<String, ColAcc> acc = new HashMap<String, ColAcc>();
        Map<String, Integer> movesOfTask = new HashMap<String, Integer>();
        for (FlowTaskRow t : tasks) {
            List<ParsedMove> list = byTask.get(t.getId());
            int cross = list == null ? 0 : list.size();
            movesOfTask.put(t.getId(), cross);

            /* 早于统计区间创建的任务：首段从区间起点算，别让几年前的任务把 90 天口径撑爆 */
            LocalDateTime segStart = (t.getCreatedAt() == null || t.getCreatedAt().isBefore(since))
                    ? since : t.getCreatedAt();

            if (list == null || list.isEmpty()) {
                /* 从没拖过列：一直待在初始列。用当前列近似 —— 没移动过就等于初始列 */
                if (t.getBoardColumn() != null) {
                    addSegment(acc, t.getBoardColumn(), segStart, now, true);
                }
                continue;
            }
            /* 首段：创建 → 第一次移动，起点列取第一次移动的 from */
            addSegment(acc, list.get(0).from, segStart, list.get(0).at, false);
            for (int i = 0; i < list.size(); i++) {
                LocalDateTime end = (i + 1 < list.size()) ? list.get(i + 1).at : null;
                /* 最后一段还没结束：截止时间用 now，并且标记为 ongoing
                   （传 null 会被 addSegment 当成无效段丢掉，B 类任务的就地在制就统计不到了） */
                addSegment(acc, list.get(i).to, list.get(i).at, end == null ? now : end, end == null);
            }
        }

        /* ---------- 每列输出 ---------- */
        /* 分母含「已被删除的列」：那段停留真实发生过，不该让现存列的占比虚高 */
        long grandTotal = 0;
        for (ColAcc a : acc.values()) {
            grandTotal += a.total;
        }
        List<ColumnStat> stats = new ArrayList<ColumnStat>();
        for (String colId : colById.keySet()) {
            ColAcc a = acc.get(colId);
            if (a == null) {
                a = new ColAcc();
            }
            ColumnStat cs = new ColumnStat();
            cs.setId(colId);
            BoardColumn def = colById.get(colId);
            cs.setName(def.getName());
            cs.setColor(def.getColor());
            cs.setSegments(a.durations.size());
            cs.setTotalSeconds(a.total);
            cs.setAvgSeconds(a.durations.isEmpty() ? 0 : a.total / a.durations.size());
            cs.setMedianSeconds(percentile(a.durations, 0.5));
            cs.setP90Seconds(percentile(a.durations, 0.9));
            cs.setOngoingCount(a.ongoingCount);
            cs.setOngoingMaxSeconds(a.ongoingMax);
            cs.setOngoingAvgSeconds(a.ongoingCount == 0 ? 0 : a.ongoingTotal / a.ongoingCount);
            stats.add(cs);
        }
        for (ColumnStat cs : stats) {
            cs.setShare(grandTotal <= 0 ? 0 : round4((double) cs.getTotalSeconds() / grandTotal));
        }
        /* 瓶颈判定要求至少 2 个样本（已离开 + 仍在），单个任务的一次移动不足以定性 */
        ColumnStat bottleneck = null;
        for (ColumnStat cs : stats) {
            int sample = cs.getSegments() + cs.getOngoingCount();
            if (sample < 2) {
                continue;
            }
            if (bottleneck == null || cs.getShare() > bottleneck.getShare()) {
                bottleneck = cs;
            }
        }
        for (ColumnStat cs : stats) {
            cs.setBottleneck(bottleneck != null && cs.getId().equals(bottleneck.getId()));
        }
        res.setColumns(stats);
        if (bottleneck != null) {
            res.setBottleneckId(bottleneck.getId());
            res.setBottleneckName(bottleneck.getName());
            res.setBottleneckShare(bottleneck.getShare());
        }

        /* ---------- 回退 / 一次通过率 ---------- */
        FlowHealthResponse.Rework rw = new FlowHealthResponse.Rework();
        rw.setTotalMoves(usable);
        rw.setBackMoves(backMoves);
        rw.setBackRate(usable == 0 ? 0 : round4((double) backMoves / usable));
        LocalDate sinceDay = since.toLocalDate();
        int completed = 0;
        int firstPass = 0;
        for (FlowTaskRow t : tasks) {
            if (t.getCompletedAt() == null || t.getCompletedAt().isBefore(sinceDay)) {
                continue;
            }
            completed++;
            List<ParsedMove> list = byTask.get(t.getId());
            boolean back = false;
            if (list != null) {
                for (ParsedMove p : list) {
                    Integer of = orderOf.get(p.from);
                    Integer ot = orderOf.get(p.to);
                    if (of != null && ot != null && ot < of) {
                        back = true;
                        break;
                    }
                }
            }
            if (!back) {
                firstPass++;
            }
        }
        rw.setCompletedTasks(completed);
        rw.setFirstPassTasks(firstPass);
        rw.setFirstPassRate(completed == 0 ? 0 : round4((double) firstPass / completed));
        res.setRework(rw);

        /* ---------- 优先级是否真的起作用 ---------- */
        Map<String, int[]> prio = new LinkedHashMap<String, int[]>();
        for (String p : new String[]{"P0", "P1", "P2", "P3"}) {
            prio.put(p, new int[]{0, 0});
        }
        for (FlowTaskRow t : tasks) {
            String p = t.getPriority() == null ? "P2" : t.getPriority();
            int[] slot = prio.get(p);
            if (slot == null) {
                continue;
            }
            Integer mv = movesOfTask.get(t.getId());
            slot[0]++;
            slot[1] += (mv == null ? 0 : mv);
        }
        for (Map.Entry<String, int[]> e : prio.entrySet()) {
            if (e.getValue()[0] == 0) {
                continue;
            }
            PriorityStat ps = new PriorityStat();
            ps.setPriority(e.getKey());
            ps.setTasks(e.getValue()[0]);
            ps.setAvgMoves(round2((double) e.getValue()[1] / e.getValue()[0]));
            res.getPriority().add(ps);
        }

        /* ---------- 需求 → 开工 ---------- */
        FlowHealthResponse.ReqDocStat rs = new FlowHealthResponse.ReqDocStat();
        int withTasks = 0;
        long leadTotalMinutes = 0;
        int leadCount = 0;
        List<FlowReqDocRow> orphans = new ArrayList<FlowReqDocRow>();
        for (FlowReqDocRow d : reqDocs) {
            int cnt = d.getTaskCount() == null ? 0 : d.getTaskCount();
            if (cnt > 0 && d.getFirstTaskAt() != null && d.getCreatedAt() != null) {
                withTasks++;
                long mins = Duration.between(d.getCreatedAt(), d.getFirstTaskAt()).toMinutes();
                if (mins >= 0) {
                    leadTotalMinutes += mins;
                    leadCount++;
                }
            } else if (cnt == 0) {
                orphans.add(d);
            }
        }
        Collections.sort(orphans, new Comparator<FlowReqDocRow>() {
            @Override
            public int compare(FlowReqDocRow a, FlowReqDocRow b) {
                if (a.getCreatedAt() == null) return 1;
                if (b.getCreatedAt() == null) return -1;
                return a.getCreatedAt().compareTo(b.getCreatedAt());
            }
        });
        rs.setTotal(reqDocs.size());
        rs.setWithTasks(withTasks);
        rs.setNoTask(orphans.size());
        rs.setAvgLeadHours(leadCount == 0 ? null : round2(leadTotalMinutes / 60.0 / leadCount));
        for (int i = 0; i < orphans.size() && i < 5; i++) {
            FlowReqDocRow d = orphans.get(i);
            ReqDocLite lite = new ReqDocLite();
            lite.setId(d.getId());
            lite.setTitle(d.getTitle());
            lite.setAgeDays(d.getCreatedAt() == null ? 0
                    : Math.max(0, Duration.between(d.getCreatedAt(), now).toDays()));
            rs.getNoTaskList().add(lite);
        }
        res.setReqDocs(rs);

        /* ---------- 覆盖率说明 ---------- */
        FlowHealthResponse.Coverage cov = new FlowHealthResponse.Coverage();
        cov.setMoveEvents(moves.size());
        cov.setUsableMoves(usable);
        cov.setTasksTotal(tasks.size());
        cov.setTasksWithMoves(byTask.size());
        cov.setCompletedInRange(completed);
        if (usable == 0) {
            cov.setNote("近 " + rangeDays + " 天还没有跨列移动记录。把任务在列之间拖几次（待处理 → 进行中 → 已完成），"
                    + "这里就会长出数据。");
        } else if (usable < moves.size()) {
            cov.setNote("近 " + rangeDays + " 天共 " + moves.size() + " 次移动，其中 " + usable
                    + " 次能定位到具体列（早期记录只有列名文本，列改名过的会对不上）；"
                    + "「已完成」列不作为在制停留统计。");
        } else {
            cov.setNote("口径：停留 = 进入某列到离开该列；均值/中位数只算已离开的段，当前仍卡着的单独列在每行右侧。"
                    + "「已完成」是终点，不计入停留。");
        }
        res.setCoverage(cov);

        /* ---------- 自动结论 ---------- */
        res.setInsights(buildInsights(res));
        return res;
    }

    private List<Insight> buildInsights(FlowHealthResponse res) {
        List<Insight> out = new ArrayList<Insight>();
        FlowHealthResponse.Coverage cov = res.getCoverage();
        FlowHealthResponse.Rework rw = res.getRework();
        FlowHealthResponse.ReqDocStat rs = res.getReqDocs();

        if (cov.getUsableMoves() == 0) {
            out.add(new Insight("info", "还没有可分析的流程数据",
                    "多拖几次列，攒够移动记录后这里会自动给出瓶颈、返工和需求开工延迟的判断。"));
            return out;
        }

        /* 1. 瓶颈 */
        if (res.getBottleneckId() != null) {
            ColumnStat bs = null;
            for (ColumnStat cs : res.getColumns()) {
                if (cs.getId().equals(res.getBottleneckId())) {
                    bs = cs;
                    break;
                }
            }
            if (bs != null) {
                out.add(new Insight("warn", "最堵的是「" + bs.getName() + "」",
                        "它吃掉了全流程 " + pct(bs.getShare()) + " 的停留时间，平均 "
                                + human(bs.getAvgSeconds()) + "。瓶颈在这一列，加人加班在别处都没用。"));
            }
        }

        /* 2. 返工 */
        if (rw.getTotalMoves() >= 5) {
            if (rw.getBackRate() >= 0.2) {
                out.add(new Insight("warn", "返工偏多",
                        "近 " + res.getRangeDays() + " 天 " + rw.getTotalMoves() + " 次跨列移动里有 "
                                + rw.getBackMoves() + " 次是往回退（" + pct(rw.getBackRate()) + "）。"
                                + "退回通常意味着进入下一列的门槛不清 —— 验收标准写在需求里会好很多。"));
            } else if (rw.getBackRate() <= 0.05) {
                out.add(new Insight("good", "流程很干净",
                        rw.getTotalMoves() + " 次跨列移动里只有 " + rw.getBackMoves() + " 次回退，一次通过率 "
                                + pct(rw.getFirstPassRate()) + "。"));
            }
        }

        /* 3. 需求盲区 */
        if (rs.getNoTask() > 0) {
            ReqDocLite oldest = rs.getNoTaskList().isEmpty() ? null : rs.getNoTaskList().get(0);
            String extra = oldest == null ? "" :
                    "挂得最久的是「" + oldest.getTitle() + "」，已经 " + oldest.getAgeDays() + " 天没拆出任务。";
            out.add(new Insight("warn", rs.getNoTask() + " 份需求还没拆出任务",
                    "共 " + rs.getTotal() + " 份需求，其中 " + rs.getNoTask() + " 份一个任务都没有。" + extra));
        } else if (rs.getTotal() > 0) {
            out.add(new Insight("good", "需求都落地了",
                    rs.getTotal() + " 份需求全部拆出了任务" + (rs.getAvgLeadHours() == null ? "。" :
                            "，从写完到开工平均 " + hoursHuman(rs.getAvgLeadHours()) + "。")));
        }

        /* 4. 优先级失效 */
        Double p0 = null;
        Double p2 = null;
        int p0n = 0;
        for (PriorityStat ps : res.getPriority()) {
            if ("P0".equals(ps.getPriority())) {
                p0 = ps.getAvgMoves();
                p0n = ps.getTasks();
            } else if ("P2".equals(ps.getPriority())) {
                p2 = ps.getAvgMoves();
            }
        }
        if (p0 != null && p2 != null && p0n >= 2 && p0 > p2 * 1.5) {
            out.add(new Insight("warn", "P0 反而更折腾",
                    "P0 任务平均被移动 " + p0 + " 次，P2 只有 " + p2 + " 次。"
                            + "要么 P0 的定义太宽（什么都标 P0），要么它们总是在需求不清的时候就开工了。"));
        }

        /* 5. 长期卡点 */
        ColumnStat stuck = null;
        for (ColumnStat cs : res.getColumns()) {
            if (cs.getOngoingMaxSeconds() >= 7L * 86400 && (stuck == null
                    || cs.getOngoingMaxSeconds() > stuck.getOngoingMaxSeconds())) {
                stuck = cs;
            }
        }
        if (stuck != null) {
            out.add(new Insight("warn", "有任务在「" + stuck.getName() + "」卡了超过一周",
                    "该列现有 " + stuck.getOngoingCount() + " 个任务，最长的一个已经停了 "
                            + human(stuck.getOngoingMaxSeconds()) + "。这类任务建议标成卡点并写清在等什么。"));
        }

        if (out.size() > 4) {
            return new ArrayList<Insight>(out.subList(0, 4));
        }
        return out;
    }

    // ==================== 工具 ====================

    private static class ParsedMove {
        final String from;
        final String to;
        final LocalDateTime at;

        ParsedMove(String from, String to, LocalDateTime at) {
            this.from = from;
            this.to = to;
            this.at = at;
        }
    }

    private static class ColAcc {
        long total;
        long ongoingTotal;
        long ongoingMax;
        int ongoingCount;
        final List<Long> durations = new ArrayList<Long>();
    }

    /** 结构化字段优先；历史数据用 detail 文本 + 列名反查兜底 */
    private ParsedMove parse(FlowMoveRow m, Map<String, String> idByName) {
        String from = m.getFromColumn();
        String to = m.getToColumn();
        if (from == null || to == null) {
            if (m.getDetail() == null) {
                return null;
            }
            Matcher mt = MOVE_DETAIL.matcher(m.getDetail());
            if (!mt.find()) {
                return null;
            }
            String fName = mt.group(1);
            String tName = mt.group(2);
            String f = idByName.get(fName);
            String t = idByName.get(tName);
            if (from == null) from = f;
            if (to == null) to = t;
        }
        if (from == null || to == null) {
            return null;
        }
        return new ParsedMove(from, to, m.getCreatedAt());
    }

    /** 累加一段停留；已完成列是终点，不计入在制停留 */
    private void addSegment(Map<String, ColAcc> acc, String col, LocalDateTime from,
                            LocalDateTime to, boolean open) {
        if (col == null || from == null || Consts.COL_DONE.equals(col)) {
            return;
        }
        ColAcc a = acc.get(col);
        if (a == null) {
            a = new ColAcc();
            acc.put(col, a);
        }
        if (open) {
            if (to == null) {
                return;
            }
            long s = Math.max(0, Duration.between(from, to).getSeconds());
            a.ongoingCount++;
            a.ongoingTotal += s;
            if (s > a.ongoingMax) {
                a.ongoingMax = s;
            }
        } else {
            if (to == null || to.isBefore(from)) {
                return;
            }
            long s = Duration.between(from, to).getSeconds();
            /* 零长停留（同一秒内连拖两次）不参与均值，否则会把中位数拉低 */
            if (s <= 0) {
                return;
            }
            a.total += s;
            a.durations.add(s);
        }
    }

    /** 线性插值分位数（样本少时比"最近秩"稳），空集返回 0 */
    static long percentile(List<Long> values, double p) {
        if (values == null || values.isEmpty()) {
            return 0;
        }
        List<Long> sorted = new ArrayList<Long>(values);
        Collections.sort(sorted);
        if (sorted.size() == 1) {
            return sorted.get(0);
        }
        double pos = p * (sorted.size() - 1);
        int lo = (int) Math.floor(pos);
        int hi = (int) Math.ceil(pos);
        if (lo == hi) {
            return sorted.get(lo);
        }
        double frac = pos - lo;
        return Math.round(sorted.get(lo) + (sorted.get(hi) - sorted.get(lo)) * frac);
    }

    private static double round2(double v) {
        return Math.round(v * 100) / 100.0;
    }

    private static double round4(double v) {
        return Math.round(v * 10000) / 10000.0;
    }

    private static String pct(double rate) {
        return String.format(Locale.CHINA, "%.0f%%", rate * 100);
    }

    static String human(long seconds) {
        if (seconds <= 0) {
            return "0 分钟";
        }
        if (seconds < 3600) {
            return Math.max(1, Math.round(seconds / 60.0)) + " 分钟";
        }
        if (seconds < 86400) {
            return String.format(Locale.CHINA, "%.1f 小时", seconds / 3600.0);
        }
        return String.format(Locale.CHINA, "%.1f 天", seconds / 86400.0);
    }

    private static String hoursHuman(double hours) {
        if (hours < 1) {
            return Math.round(hours * 60) + " 分钟";
        }
        if (hours < 24) {
            return String.format(Locale.CHINA, "%.1f 小时", hours);
        }
        return String.format(Locale.CHINA, "%.1f 天", hours / 24.0);
    }
}
