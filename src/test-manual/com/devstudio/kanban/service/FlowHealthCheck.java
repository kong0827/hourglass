package com.devstudio.kanban.service;

import com.devstudio.kanban.dto.FlowHealthResponse;
import com.devstudio.kanban.dto.FlowMoveRow;
import com.devstudio.kanban.dto.FlowReqDocRow;
import com.devstudio.kanban.dto.FlowTaskRow;
import com.devstudio.kanban.entity.BoardColumn;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * 流程体检聚合口径的临时校验（不依赖 JUnit，项目里没有测试框架）。
 * 覆盖：列停留切段 / 已完成列排除 / 回退计数 / 一次通过率 / 未移动任务 / detail 兜底解析 / 需求开工延迟。
 */
public class FlowHealthCheck {

    private static int pass = 0;
    private static int fail = 0;

    public static void main(String[] args) {
        LocalDateTime t0 = LocalDateTime.of(2026, 10, 1, 9, 0);
        LocalDateTime now = t0.plusDays(3);

        FlowHealthService svc = new FlowHealthService(null, null);
        List<BoardColumn> cols = Arrays.asList(col("backlog", "待处理", 0), col("doing", "进行中", 1), col("done", "已完成", 2));

        List<FlowMoveRow> moves = new ArrayList<FlowMoveRow>();
        /* 任务 A：待处理 2h → 进行中 3h → 已完成（done 段不计入停留） */
        moves.add(mv("A", "backlog", "doing", t0.plusHours(2), "从「待处理」移动到「进行中」"));
        moves.add(mv("A", "doing", "done", t0.plusHours(5), "从「进行中」移动到「已完成」"));
        /* 任务 B：有一次回退（进行中 → 待处理），最后仍停在进行中 */
        moves.add(mv("B", "backlog", "doing", t0.plusHours(1), "从「待处理」移动到「进行中」"));
        moves.add(mv("B", "doing", "backlog", t0.plusHours(3), "从「进行中」移动到「待处理」"));
        moves.add(mv("B", "backlog", "doing", t0.plusHours(4), "从「待处理」移动到「进行中」"));
        /* 任务 D：历史数据没有结构化列，只能靠 detail 文本兜底 */
        moves.add(mv("D", null, null, t0.plusHours(6), "从「待处理」移动到「已完成」"));

        List<FlowTaskRow> tasks = new ArrayList<FlowTaskRow>();
        tasks.add(task("A", "P0", "done", t0, LocalDate.of(2026, 10, 1)));
        tasks.add(task("B", "P2", "doing", t0, null));
        tasks.add(task("C", "P2", "doing", t0, null));   /* 从未移动过 */
        tasks.add(task("D", "P1", "done", t0, LocalDate.of(2026, 10, 2)));

        List<FlowReqDocRow> reqs = new ArrayList<FlowReqDocRow>();
        reqs.add(req("d1", "有任务的需求", t0, t0.plusHours(26)));
        reqs.add(req("d2", "没人管的需求", t0, null));

        FlowHealthResponse res = svc.compute(cols, moves, tasks, reqs, 90, t0, now);

        /* ---- 列停留 ----
           待处理：A[t0,+2h]=2h、B 首段[t0,+1h]=1h、B 回退后[t0+3h,+4h]=1h、D 首段[t0,+6h]=6h → 4 段 10h
           进行中：A[t0+2h,+5h]=3h、B[t0+1h,+3h]=2h → 2 段 5h；B 与 C 仍停在进行中（2 个在制）
           已完成：A、D 的终点段不计入停留 */
        FlowHealthResponse.ColumnStat backlog = pick(res, "backlog");
        FlowHealthResponse.ColumnStat doing = pick(res, "doing");
        FlowHealthResponse.ColumnStat done = pick(res, "done");

        eq("待处理 已离开段数", 4, backlog.getSegments());
        eq("待处理 累计停留 10h", 10 * 3600L, backlog.getTotalSeconds());
        eq("待处理 平均 2.5h", 9000L, backlog.getAvgSeconds());
        eq("待处理 中位 1.5h", 5400L, backlog.getMedianSeconds());

        eq("进行中 已离开段数", 2, doing.getSegments());
        eq("进行中 累计停留 5h", 5 * 3600L, doing.getTotalSeconds());
        eq("进行中 平均 2.5h", 9000L, doing.getAvgSeconds());
        eq("进行中 在当前制 2 个（B 与 C）", 2, doing.getOngoingCount());
        eq("进行中 在制最久 72h（C 从未移动过）", 72 * 3600L, doing.getOngoingMaxSeconds());

        eq("已完成列不计停留", 0, done.getSegments());

        /* ---- 瓶颈：待处理 36000 / (36000+18000) ---- */
        eq("瓶颈列", "backlog", res.getBottleneckId());
        eq2("瓶颈占比", 0.6667, res.getBottleneckShare());

        /* ---- 回退 ---- */
        eq("跨列移动次数（列内排序/无法解析的不算）", 6, res.getRework().getTotalMoves());
        eq("回退次数", 1, res.getRework().getBackMoves());
        eq2("回退率", 0.1667, res.getRework().getBackRate());

        /* ---- 一次通过率：A、D 完成，都没回退 → 2/2 ---- */
        eq("已完成任务数", 2, res.getRework().getCompletedTasks());
        eq("一次通过数", 2, res.getRework().getFirstPassTasks());
        eq2("一次通过率", 1.0, res.getRework().getFirstPassRate());

        /* ---- 优先级 ---- */
        /* 窗口内每任务移动次数：A=2, B=3, C=0, D=1 */
        eq2("P0 平均移动", 2.0, pickPrio(res, "P0"));
        eq2("P1 平均移动", 1.0, pickPrio(res, "P1"));
        eq2("P2 平均移动", 1.5, pickPrio(res, "P2"));

        /* ---- 需求 ---- */
        eq("需求总数", 2, res.getReqDocs().getTotal());
        eq("已拆任务", 1, res.getReqDocs().getWithTasks());
        eq("无任务需求", 1, res.getReqDocs().getNoTask());
        eq2("平均开工延迟 26h", 26.0, res.getReqDocs().getAvgLeadHours());
        eq("无任务需求清单首项", "d2", res.getReqDocs().getNoTaskList().get(0).getId());

        /* ---- 覆盖率 ---- */
        eq("move 事件总数", 6, res.getCoverage().getMoveEvents());
        eq("可定位的移动数", 6, res.getCoverage().getUsableMoves());
        eq("参与统计的任务数", 4, res.getCoverage().getTasksTotal());
        eq("有移动的任务数", 3, res.getCoverage().getTasksWithMoves());

        /* ---- 分位数 ---- */
        eq("中位数 [1,2,3,4]", 3L, FlowHealthService.percentile(Arrays.asList(1L, 2L, 3L, 4L), 0.5));
        eq("P90 [1..10]", 9L, FlowHealthService.percentile(Arrays.asList(1L, 2L, 3L, 4L, 5L, 6L, 7L, 8L, 9L, 10L), 0.9));
        eq("单元素分位", 7L, FlowHealthService.percentile(Arrays.asList(7L), 0.9));
        eq("空集分位", 0L, FlowHealthService.percentile(new ArrayList<Long>(), 0.5));

        /* ---- 结论至少有一条 ---- */
        ok("生成了体检结论", res.getInsights().size() > 0);

        /* ---- 场景 2：done 不在 board_column 表里（线上就是这样，该表只种 backlog/doing） ---- */
        List<BoardColumn> cols2 = Arrays.asList(col("backlog", "待处理", 0), col("doing", "进行中", 1));
        List<FlowMoveRow> mv2 = new ArrayList<FlowMoveRow>();
        mv2.add(mv("E", "backlog", "doing", t0.plusHours(1), "从「待处理」移动到「进行中」"));
        mv2.add(mv("E", "doing", "done", t0.plusHours(4), "从「进行中」移动到「已完成」"));
        /* 取消完成：已完成 → 进行中，靠内置列顺序（done 排最后）才判得出这是一次回退 */
        mv2.add(mv("F", null, null, t0.plusHours(2), "从「已完成」移动到「进行中」"));
        List<FlowTaskRow> tasks2 = new ArrayList<FlowTaskRow>();
        tasks2.add(task("E", "P1", "done", t0, LocalDate.of(2026, 10, 1)));
        tasks2.add(task("F", "P2", "doing", t0, null));

        FlowHealthResponse r2 = svc.compute(cols2, mv2, tasks2, new ArrayList<FlowReqDocRow>(), 90, t0, now);
        eq("没有 done 列时只输出实际存在的列", 2, r2.getColumns().size());
        eq("「已完成」可解析（内置列名兜底）", 3, r2.getCoverage().getUsableMoves());
        eq("取消完成算一次回退", 1, r2.getRework().getBackMoves());
        eq("进行中的已完成停留 3h（不被 done 段污染）", 3 * 3600L, pick(r2, "doing").getTotalSeconds());
        eq("进行中仍有 1 个在制（F 被拖回来）", 1, pick(r2, "doing").getOngoingCount());

        /* ---- 空数据不炸 ---- */
        FlowHealthResponse empty = svc.compute(cols, new ArrayList<FlowMoveRow>(),
                new ArrayList<FlowTaskRow>(), new ArrayList<FlowReqDocRow>(), 90, t0, now);
        ok("空数据时提示引导语", empty.getCoverage().getNote() != null
                && empty.getCoverage().getNote().contains("还没有跨列移动记录"));
        eq("空数据没有瓶颈", null, empty.getBottleneckId());

        System.out.println();
        System.out.println("==== 通过 " + pass + " / 失败 " + fail + " ====");
        if (fail > 0) {
            System.exit(1);
        }
    }

    // ==================== 断言 ====================

    private static void eq(String name, Object expect, Object actual) {
        if (expect == null ? actual == null : expect.equals(actual)) {
            pass++;
            System.out.println("  ok   " + name + " = " + actual);
        } else {
            fail++;
            System.out.println("  FAIL " + name + " 期望 " + expect + " 实际 " + actual);
        }
    }

    private static void eq2(String name, double expect, double actual) {
        if (Math.abs(expect - actual) < 0.01) {
            pass++;
            System.out.println("  ok   " + name + " = " + actual);
        } else {
            fail++;
            System.out.println("  FAIL " + name + " 期望 " + expect + " 实际 " + actual);
        }
    }

    private static void ok(String name, boolean cond) {
        if (cond) {
            pass++;
            System.out.println("  ok   " + name);
        } else {
            fail++;
            System.out.println("  FAIL " + name);
        }
    }

    // ==================== 构造 ====================

    private static BoardColumn col(String id, String name, int sort) {
        BoardColumn c = new BoardColumn();
        c.setId(id);
        c.setName(name);
        c.setColor("#888888");
        c.setSortOrder(sort);
        return c;
    }

    private static FlowMoveRow mv(String taskId, String from, String to, LocalDateTime at, String detail) {
        FlowMoveRow m = new FlowMoveRow();
        m.setTaskId(taskId);
        m.setFromColumn(from);
        m.setToColumn(to);
        m.setDetail(detail);
        m.setCreatedAt(at);
        return m;
    }

    private static FlowTaskRow task(String id, String prio, String col, LocalDateTime created, LocalDate completed) {
        FlowTaskRow t = new FlowTaskRow();
        t.setId(id);
        t.setTitle("任务 " + id);
        t.setPriority(prio);
        t.setBoardColumn(col);
        t.setCreatedAt(created);
        t.setCompletedAt(completed);
        return t;
    }

    private static FlowReqDocRow req(String id, String title, LocalDateTime created, LocalDateTime firstTask) {
        FlowReqDocRow d = new FlowReqDocRow();
        d.setId(id);
        d.setTitle(title);
        d.setCreatedAt(created);
        d.setFirstTaskAt(firstTask);
        d.setTaskCount(firstTask == null ? 0 : 1);
        return d;
    }

    private static FlowHealthResponse.ColumnStat pick(FlowHealthResponse res, String id) {
        for (FlowHealthResponse.ColumnStat c : res.getColumns()) {
            if (c.getId().equals(id)) {
                return c;
            }
        }
        throw new IllegalStateException("没有这一列：" + id);
    }

    private static Double pickPrio(FlowHealthResponse res, String p) {
        for (FlowHealthResponse.PriorityStat s : res.getPriority()) {
            if (s.getPriority().equals(p)) {
                return s.getAvgMoves();
            }
        }
        return null;
    }
}
