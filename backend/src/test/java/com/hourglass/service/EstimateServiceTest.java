package com.hourglass.service;

import com.hourglass.common.Consts;
import com.hourglass.dto.EstimateStats;
import com.hourglass.entity.Task;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class EstimateServiceTest {

    private static Task done(String id, int estimate, String category) {
        return task(id, Consts.COL_DONE, category, estimate);
    }

    private static Task task(String id, String column, String category, Integer estimate) {
        Task t = new Task();
        t.setId(id);
        t.setTitle("任务 " + id);
        t.setBoardColumn(column);
        t.setCategoryId(category);
        t.setEstimateMinutes(estimate);
        return t;
    }

    private static EstimateStats compute(int estimate, int actual) {
        EstimateService svc = new EstimateService(null, null);
        List<Task> tasks = new ArrayList<Task>();
        tasks.add(done("K1", estimate, "后端"));
        Map<String, Integer> actualMap = new HashMap<String, Integer>();
        actualMap.put("K1", actual);
        return svc.compute(tasks, actualMap);
    }

    @Test
    void accurateBoundariesShareSameConstants() {
        // 0.85 与 1.15 都算准；1.16 才偏乐观
        assertEquals(1, compute(100, 85).getAccurateCount());
        assertEquals(1, compute(100, 115).getAccurateCount());
        assertEquals(1, compute(100, 116).getOverCount());
        assertEquals(1, compute(100, 84).getUnderCount());
        // 结论文案与计数口径一致：不会再出现"既准确又偏保守"
        assertEquals("团队估时挺准：实际投入是预估的 1.15 倍，偏差在可接受范围。",
                EstimateService.suggestionOf(compute(100, 115)));
        assertEquals("团队估时偏保守：实际只用到预估的 84%。可以估得更紧一些，别把缓冲垫得太厚。",
                EstimateService.suggestionOf(compute(100, 84)));
    }

    @Test
    void noTimeLogIsExcludedFromSample() {
        EstimateStats s = compute(100, 0);
        assertEquals(0, s.getSampleCount());
        assertEquals(1, s.getNoTimeCount());
    }

    /** 估时全景：预警只对进行中、backlog 不算、无预估跳过、系数 = Σ实际/Σ预估、模块只累计已完成样本 */
    @Test
    void fullScenarioRisksCategoryAndOverrun() {
        EstimateService svc = new EstimateService(null, null);
        List<Task> tasks = new ArrayList<Task>();
        Map<String, Integer> actual = new HashMap<String, Integer>();

        tasks.add(done("T1", 240, "后端"));
        actual.put("T1", 420); // 1.75 超
        tasks.add(done("T2", 120, "前端"));
        actual.put("T2", 130); // 1.08 准
        tasks.add(done("T3", 100, "前端"));
        actual.put("T3", 50); // 0.50 高估

        tasks.add(task("T4", Consts.COL_DOING, "后端", 240));
        actual.put("T4", 200); // 0.83 → warn
        tasks.add(task("T5", Consts.COL_DOING, "后端", 240));
        actual.put("T5", 300); // 1.25 → danger

        tasks.add(task("T6", Consts.COL_BACKLOG, "后端", 240)); // 未开工，不进预警
        actual.put("T6", 0);

        tasks.add(task("T7", Consts.COL_DOING, "后端", null)); // 没填预估：跳过
        actual.put("T7", 120);
        tasks.add(done("T8", 0, "后端")); // 预估 0 视为没填
        actual.put("T8", 90);

        tasks.add(done("T9", 240, "后端")); // 完成但从没计过时：不能当"高估"算
        actual.put("T9", 0);

        EstimateStats s = svc.compute(tasks, actual);

        assertEquals(9, s.getTasksTotal());
        assertEquals(7, s.getTasksWithEstimate(), "0 与空都算没填");
        assertEquals(3, s.getSampleCount(), "参与系数的已完成样本（不含没计时的）");
        assertEquals(1, s.getNoTimeCount());

        // (420+130+50)/(240+120+100) = 600/460 = 1.304
        assertEquals(1.30, s.getOverallFactor(), 0.011);
        assertEquals(1.08, s.getMedianFactor(), 0.011);

        assertEquals(1, s.getOverCount(), "低估（>1.15）");
        assertEquals(1, s.getAccurateCount(), "准确（0.85~1.15）");
        assertEquals(1, s.getUnderCount(), "高估（<0.85）");

        assertEquals(2, s.getAtRisk().size(), "进行中预警（backlog 与无预估的不算）");
        assertEquals("T5", s.getAtRisk().get(0).getId(), "排最前的是消耗最高的");
        assertEquals("danger", s.getAtRisk().get(0).getLevel());
        assertEquals("warn", s.getAtRisk().get(1).getLevel());
        assertEquals(0.83, s.getAtRisk().get(1).getRatio(), 0.011);

        assertEquals(1, s.getOverrun().size(), "已完成且超预估");
        assertEquals("T1", s.getOverrun().get(0).getId());
        assertEquals(1.75, s.getOverrun().get(0).getRatio(), 0.011);

        assertEquals(2, s.getByCategory().size());
        assertEquals("后端", s.getByCategory().get(0).getCategoryId(), "系数最高的排第一");
        // 模块累计只统计已完成：后端 420/240 = 1.75
        assertEquals(1.75, s.getByCategory().get(0).getFactor(), 0.011);
        assertEquals(240, s.getByCategory().get(0).getEstimateTotal(), "累计预估只算一次");
        // 前端 (130+50)/(120+100) = 0.818
        assertEquals(0.82, s.getByCategory().get(1).getFactor(), 0.011);
        assertEquals(220, s.getByCategory().get(1).getEstimateTotal());

        assertTrue(s.getSuggestion().contains("偏乐观") && s.getSuggestion().contains("1.30"),
                "偏乐观给出乘数建议");
        assertTrue(s.getNote().contains("开始日期"), "口径说明点明不用开始日期");
    }

    @Test
    void boundaries() {
        EstimateService svc = new EstimateService(null, null);

        EstimateStats empty = svc.compute(new ArrayList<Task>(), new HashMap<String, Integer>());
        assertEquals(0, empty.getSampleCount(), "空空间不炸");
        assertNull(empty.getOverallFactor());
        assertTrue(empty.getSuggestion().contains("还没有可对比的样本"), "空空间给引导语");

        List<Task> onlyDoing = new ArrayList<Task>();
        onlyDoing.add(task("X1", Consts.COL_DOING, "后端", 240));
        EstimateStats noDone = svc.compute(onlyDoing, new HashMap<String, Integer>());
        assertEquals(0, noDone.getSampleCount());
        assertNull(noDone.getOverallFactor());
        assertTrue(noDone.getNote().contains("还没完成") || noDone.getSuggestion().contains("还没有可对比"));

        List<Task> exact = new ArrayList<Task>();
        exact.add(done("Y1", 240, "后端"));
        Map<String, Integer> exactAct = new HashMap<String, Integer>();
        exactAct.put("Y1", 240);
        EstimateStats one = svc.compute(exact, exactAct);
        assertEquals(1.0, one.getOverallFactor(), 0.011);
        assertTrue(one.getSuggestion().contains("挺准"), "1:1 判为估得准");
    }

    @Test
    void median() {
        assertEquals(1.75, EstimateService.median(Arrays.asList(1.5, 2.0)), 0.001, "偶数个取中间两数均值");
        assertEquals(2.0, EstimateService.median(Arrays.asList(1.0, 2.0, 9.0)), 0.001);
        assertEquals(0.0, EstimateService.median(new ArrayList<Double>()), 0.001);
    }
}
