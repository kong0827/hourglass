package com.devstudio.kanban.service;

import com.devstudio.kanban.dto.EstimateStats;
import com.devstudio.kanban.entity.Task;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 估时系数与预警口径的临时校验（项目无测试框架，javac 手跑）。
 * 覆盖：系数 = Σ实际/Σ预估、偏差分档边界、预警只对进行中、backlog 不算、无预估跳过、结论文案分档。
 */
public class EstimateCheck {

    private static int pass = 0;
    private static int fail = 0;

    public static void main(String[] args) {
        EstimateService svc = new EstimateService(null, null);

        List<Task> tasks = new ArrayList<Task>();
        Map<String, Integer> actual = new HashMap<String, Integer>();

        /* 已完成三档：超预估 / 估得准 / 高估 */
        tasks.add(task("T1", "done", "后端", 240));
        actual.put("T1", 420);   // 1.75 超
        tasks.add(task("T2", "done", "前端", 120));
        actual.put("T2", 130);   // 1.08 准
        tasks.add(task("T3", "done", "前端", 100));
        actual.put("T3", 50);    // 0.50 高估

        /* 进行中：一条接近、一条已超 */
        tasks.add(task("T4", "doing", "后端", 240));
        actual.put("T4", 200);   // 0.83 → warn
        tasks.add(task("T5", "doing", "后端", 240));
        actual.put("T5", 300);   // 1.25 → danger

        /* 待处理：还没开工，不该出现在预警里 */
        tasks.add(task("T6", "backlog", "后端", 240));
        actual.put("T6", 0);

        /* 没填预估 / 预估为 0：一律跳过 */
        tasks.add(task("T7", "doing", "后端", null));
        actual.put("T7", 120);
        tasks.add(task("T8", "done", "后端", 0));
        actual.put("T8", 90);

        /* 已完成、填了预估，但从没开过计时：实际=0 不能当"高估"算，否则系数被拉低 */
        tasks.add(task("T9", "done", "后端", 240));
        actual.put("T9", 0);

        EstimateStats s = svc.compute(tasks, actual);

        System.out.println("— 样本与覆盖 —");
        eq("任务总数", 9, s.getTasksTotal());
        eq("填了预估的任务数（0 与空都算没填）", 7, s.getTasksWithEstimate());
        eq("参与系数的已完成样本（不含没计时的）", 3, s.getSampleCount());
        eq("没开过计时的已完成任务", 1, s.getNoTimeCount());

        System.out.println("— 系数 —");
        /* (420+130+50)/(240+120+100) = 600/460 = 1.304 */
        eq2("总体系数 = Σ实际/Σ预估", 1.30, s.getOverallFactor());
        eq2("中位偏差", 1.08, s.getMedianFactor());

        System.out.println("— 偏差分档 —");
        eq("低估（>1.15）", 1, s.getOverCount());
        eq("准确（0.85~1.15）", 1, s.getAccurateCount());
        eq("高估（<0.85）", 1, s.getUnderCount());

        System.out.println("— 预警 —");
        eq("进行中预警 2 条（backlog 与无预估的不算）", 2, s.getAtRisk().size());
        eq("排最前的是消耗最高的", "T5", s.getAtRisk().get(0).getId());
        eq("已超预估标 danger", "danger", s.getAtRisk().get(0).getLevel());
        eq("接近预估标 warn", "warn", s.getAtRisk().get(1).getLevel());
        eq2("T4 消耗比例", 0.83, s.getAtRisk().get(1).getRatio());

        System.out.println("— 超支复盘 —");
        eq("已完成且超预估 1 条", 1, s.getOverrun().size());
        eq("复盘任务", "T1", s.getOverrun().get(0).getId());
        eq2("超出倍数", 1.75, s.getOverrun().get(0).getRatio());

        System.out.println("— 分类系数 —");
        for (EstimateStats.CatFactor c : s.getByCategory()) {
            System.out.println("   [分类] " + c.getCategory() + " est=" + c.getEstimateTotal()
                + " act=" + c.getActualTotal() + " n=" + c.getSampleCount() + " f=" + c.getFactor());
        }
        eq("分类数", 2, s.getByCategory().size());
        eq("系数最高的排序在第一", "后端", s.getByCategory().get(0).getCategory());
        /* 后端：(420+300)/240 = 3.0 —— 后端只有 T1(done) 与 T5(doing) 有预估且已完成的是 T1
           注意分类累计只统计已完成，所以是 420/240 = 1.75 */
        eq2("后端系数只算已完成样本", 1.75, s.getByCategory().get(0).getFactor());
        /* 前端：(130+50)/(120+100) = 180/220 = 0.818 → 0.82
           （曾经这里算出 0.91，因为分类累计把首个任务重复加了一次） */
        eq2("前端系数", 0.82, s.getByCategory().get(1).getFactor());
        eq("后端累计预估只算一次", 240, s.getByCategory().get(0).getEstimateTotal());
        eq("前端累计预估", 220, s.getByCategory().get(1).getEstimateTotal());

        System.out.println("— 结论文案 —");
        ok("偏乐观给出乘数建议", s.getSuggestion().contains("偏乐观") && s.getSuggestion().contains("1.30"));
        ok("口径说明点明不用开始日期", s.getNote().contains("开始日期"));

        System.out.println("— 边界 —");
        EstimateStats empty = svc.compute(new ArrayList<Task>(), new HashMap<String, Integer>());
        eq("空空间不炸", 0, empty.getSampleCount());
        eq("空空间系数为 null", null, empty.getOverallFactor());
        ok("空空间给引导语", empty.getSuggestion().contains("还没有可对比的样本"));

        List<Task> onlyEstimate = new ArrayList<Task>();
        onlyEstimate.add(task("X1", "doing", "后端", 240));
        EstimateStats noDone = svc.compute(onlyEstimate, new HashMap<String, Integer>());
        eq("只有进行中任务时样本为 0", 0, noDone.getSampleCount());
        eq("只有进行中任务时系数为 null", null, noDone.getOverallFactor());
        ok("提示还没完成", noDone.getNote().contains("还没完成") || noDone.getSuggestion().contains("还没有可对比"));

        List<Task> exact = new ArrayList<Task>();
        exact.add(task("Y1", "done", "后端", 240));
        Map<String, Integer> exactAct = new HashMap<String, Integer>();
        exactAct.put("Y1", 240);
        EstimateStats one = svc.compute(exact, exactAct);
        eq2("1:1 系数为 1", 1.0, one.getOverallFactor());
        ok("1:1 判为估得准", one.getSuggestion().contains("挺准"));

        eq2("中位数（偶数个取中间两数均值）", 1.75, EstimateService.median(Arrays.asList(1.5, 2.0)));
        eq2("中位数（奇数个）", 2.0, EstimateService.median(Arrays.asList(1.0, 2.0, 9.0)));
        eq2("中位数（空）", 0.0, EstimateService.median(new ArrayList<Double>()));

        System.out.println();
        System.out.println("==== 通过 " + pass + " / 失败 " + fail + " ====");
        if (fail > 0) {
            System.exit(1);
        }
    }

    private static Task task(String id, String col, String cat, Integer estimate) {
        Task t = new Task();
        t.setId(id);
        t.setTitle("任务 " + id);
        t.setBoardColumn(col);
        t.setCategory(cat);
        t.setEstimateMinutes(estimate);
        return t;
    }

    private static void eq(String name, Object expect, Object actual) {
        boolean same = expect == null ? actual == null : expect.equals(actual);
        if (same) {
            pass++;
            System.out.println("  ok   " + name + " = " + actual);
        } else {
            fail++;
            System.out.println("  FAIL " + name + " 期望 [" + expect + "] 实际 [" + actual + "]");
        }
    }

    private static void eq2(String name, Double expect, Double actual) {
        boolean same = expect == null ? actual == null
                : (actual != null && Math.abs(expect - actual) < 0.011);
        if (same) {
            pass++;
            System.out.println("  ok   " + name + " = " + actual);
        } else {
            fail++;
            System.out.println("  FAIL " + name + " 期望 [" + expect + "] 实际 [" + actual + "]");
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
}
