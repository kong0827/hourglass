package com.hourglass.service;

import com.hourglass.dto.FlowHealthResponse;
import com.hourglass.dto.FlowMoveRow;
import com.hourglass.dto.FlowReqDocRow;
import com.hourglass.dto.FlowTaskRow;
import com.hourglass.entity.BoardColumn;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** 流程体检聚合口径：列停留切段 / 已完成列排除 / 回退计数 / 一次通过率 / 未移动任务 / detail 兜底解析 / 需求开工延迟 */
class FlowHealthServiceTest {

    private static final LocalDateTime T0 = LocalDateTime.of(2026, 10, 1, 9, 0);
    private static final LocalDateTime NOW = T0.plusDays(3);

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

    private static FlowTaskRow task(String id, String prio, String column, LocalDateTime created, LocalDate completed) {
        FlowTaskRow t = new FlowTaskRow();
        t.setId(id);
        t.setTitle("任务 " + id);
        t.setPriority(prio);
        t.setBoardColumn(column);
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

    private static FlowHealthService svc() {
        return new FlowHealthService(null, null, null);
    }

    @Test
    void columnDwellAndBottleneck() {
        List<BoardColumn> cols = Arrays.asList(
                col("backlog", "待处理", 0), col("doing", "进行中", 1), col("done", "已完成", 2));

        List<FlowMoveRow> moves = new ArrayList<FlowMoveRow>();
        // 任务 A：待处理 2h → 进行中 3h → 已完成（done 段不计入停留）
        moves.add(mv("A", "backlog", "doing", T0.plusHours(2), "从「待处理」移动到「进行中」"));
        moves.add(mv("A", "doing", "done", T0.plusHours(5), "从「进行中」移动到「已完成」"));
        // 任务 B：有一次回退（进行中 → 待处理），最后仍停在进行中
        moves.add(mv("B", "backlog", "doing", T0.plusHours(1), "从「待处理」移动到「进行中」"));
        moves.add(mv("B", "doing", "backlog", T0.plusHours(3), "从「进行中」移动到「待处理」"));
        moves.add(mv("B", "backlog", "doing", T0.plusHours(4), "从「待处理」移动到「进行中」"));
        // 任务 D：历史数据没有结构化列，只能靠 detail 文本兜底
        moves.add(mv("D", null, null, T0.plusHours(6), "从「待处理」移动到「已完成」"));

        List<FlowTaskRow> tasks = new ArrayList<FlowTaskRow>();
        tasks.add(task("A", "P0", "done", T0, LocalDate.of(2026, 10, 1)));
        tasks.add(task("B", "P2", "doing", T0, null));
        tasks.add(task("C", "P2", "doing", T0, null)); // 从未移动过
        tasks.add(task("D", "P1", "done", T0, LocalDate.of(2026, 10, 2)));

        List<FlowReqDocRow> reqs = new ArrayList<FlowReqDocRow>();
        reqs.add(req("d1", "有任务的需求", T0, T0.plusHours(26)));
        reqs.add(req("d2", "没人管的需求", T0, null));

        FlowHealthResponse res = svc().compute(cols, moves, tasks, reqs, 90, T0, NOW);

        // 待处理：A 2h、B 首段 1h、B 回退后 1h、D 首段 6h → 4 段 10h
        FlowHealthResponse.ColumnStat backlog = pick(res, "backlog");
        assertEquals(4, backlog.getSegments());
        assertEquals(10 * 3600L, backlog.getTotalSeconds());
        assertEquals(9000L, backlog.getAvgSeconds());
        assertEquals(5400L, backlog.getMedianSeconds());

        // 进行中：A 3h、B 2h → 2 段 5h；B 与 C 仍在制
        FlowHealthResponse.ColumnStat doing = pick(res, "doing");
        assertEquals(2, doing.getSegments());
        assertEquals(5 * 3600L, doing.getTotalSeconds());
        assertEquals(9000L, doing.getAvgSeconds());
        assertEquals(2, doing.getOngoingCount());
        assertEquals(72 * 3600L, doing.getOngoingMaxSeconds()); // C 从未移动过

        assertEquals(0, pick(res, "done").getSegments(), "已完成列不计停留");

        // 瓶颈：待处理 36000 / (36000+18000)
        assertEquals("backlog", res.getBottleneckId());
        assertEquals(0.6667, res.getBottleneckShare(), 0.01);

        // 回退与一次通过率：A、D 完成且都没回退 → 2/2
        assertEquals(6, res.getRework().getTotalMoves(), "跨列移动次数");
        assertEquals(1, res.getRework().getBackMoves());
        assertEquals(0.1667, res.getRework().getBackRate(), 0.01);
        assertEquals(2, res.getRework().getCompletedTasks());
        assertEquals(2, res.getRework().getFirstPassTasks());
        assertEquals(1.0, res.getRework().getFirstPassRate(), 0.01);

        // 窗口内每任务移动次数：A=2, B=3, C=0, D=1
        assertEquals(2.0, pickPrio(res, "P0"), 0.01);
        assertEquals(1.0, pickPrio(res, "P1"), 0.01);
        assertEquals(1.5, pickPrio(res, "P2"), 0.01);

        // 需求
        assertEquals(2, res.getReqDocs().getTotal());
        assertEquals(1, res.getReqDocs().getWithTasks());
        assertEquals(1, res.getReqDocs().getNoTask());
        assertEquals(26.0, res.getReqDocs().getAvgLeadHours(), 0.01);
        assertEquals("d2", res.getReqDocs().getNoTaskList().get(0).getId());

        // 覆盖率
        assertEquals(6, res.getCoverage().getMoveEvents());
        assertEquals(6, res.getCoverage().getUsableMoves());
        assertEquals(4, res.getCoverage().getTasksTotal());
        assertEquals(3, res.getCoverage().getTasksWithMoves());

        assertTrue(res.getInsights().size() > 0, "生成了体检结论");
    }

    @Test
    void percentile() {
        assertEquals(3L, FlowHealthService.percentile(Arrays.asList(1L, 2L, 3L, 4L), 0.5));
        assertEquals(9L, FlowHealthService.percentile(Arrays.asList(1L, 2L, 3L, 4L, 5L, 6L, 7L, 8L, 9L, 10L), 0.9));
        assertEquals(7L, FlowHealthService.percentile(Arrays.asList(7L), 0.9));
        assertEquals(0L, FlowHealthService.percentile(new ArrayList<Long>(), 0.5));
    }

    @Test
    void doneColumnMissingFromBoardTable() {
        // 线上 board_column 只种 backlog/doing；done 靠内置列名兜底
        List<BoardColumn> cols = Arrays.asList(col("backlog", "待处理", 0), col("doing", "进行中", 1));
        List<FlowMoveRow> moves = new ArrayList<FlowMoveRow>();
        moves.add(mv("E", "backlog", "doing", T0.plusHours(1), "从「待处理」移动到「进行中」"));
        moves.add(mv("E", "doing", "done", T0.plusHours(4), "从「进行中」移动到「已完成」"));
        // 取消完成：已完成 → 进行中，靠内置列顺序（done 排最后）才判得出这是一次回退
        moves.add(mv("F", null, null, T0.plusHours(2), "从「已完成」移动到「进行中」"));
        List<FlowTaskRow> tasks = new ArrayList<FlowTaskRow>();
        tasks.add(task("E", "P1", "done", T0, LocalDate.of(2026, 10, 1)));
        tasks.add(task("F", "P2", "doing", T0, null));

        FlowHealthResponse res = svc().compute(cols, moves, tasks, new ArrayList<FlowReqDocRow>(), 90, T0, NOW);
        assertEquals(2, res.getColumns().size(), "只输出实际存在的列");
        assertEquals(3, res.getCoverage().getUsableMoves(), "「已完成」可解析（内置列名兜底）");
        assertEquals(1, res.getRework().getBackMoves(), "取消完成算一次回退");
        assertEquals(3 * 3600L, pick(res, "doing").getTotalSeconds(), "进行中的已完成停留不被 done 段污染");
        assertEquals(1, pick(res, "doing").getOngoingCount(), "F 被拖回进行中");
    }

    @Test
    void emptyDataDoesNotExplode() {
        List<BoardColumn> cols = Arrays.asList(
                col("backlog", "待处理", 0), col("doing", "进行中", 1), col("done", "已完成", 2));
        FlowHealthResponse res = svc().compute(cols, new ArrayList<FlowMoveRow>(),
                new ArrayList<FlowTaskRow>(), new ArrayList<FlowReqDocRow>(), 90, T0, NOW);
        assertTrue(res.getCoverage().getNote() != null
                && res.getCoverage().getNote().contains("还没有跨列移动记录"), "空数据时提示引导语");
        assertNull(res.getBottleneckId());
    }
}
