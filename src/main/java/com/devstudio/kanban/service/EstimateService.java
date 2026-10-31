package com.devstudio.kanban.service;

import com.devstudio.kanban.common.Consts;
import com.devstudio.kanban.dto.EstimateStats;
import com.devstudio.kanban.entity.Task;
import com.devstudio.kanban.mapper.TaskMapper;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * 估时系数与超支预警。
 *
 * <p>核心口径（改之前先读）：
 * <ul>
 *   <li><b>实际值</b>只取 {@code time_log.minutes} 的累计 —— 它已经按工作时段折算、跳过周末、每天封顶，
 *       和"人真正坐在电脑前干这件事的时间"最接近。</li>
 *   <li><b>不用开始日期推工期</b>：任务可能今天接到、下周才动手，{@code start_date} 到完成之间的跨度里
 *       大部分是排队等待，拿它算效率只会得出"我干活很慢"的错误结论。</li>
 *   <li><b>系数用 Σ实际/Σ预估</b>而不是平均每个任务的比值：后者会让"预估 0.5h 实际 2h"（4 倍）的
 *       小任务和"预估 40h 实际 60h"（1.5 倍）的大任务等权重，结论会被小事带偏。</li>
 *   <li><b>只看已完成的样本算系数</b>：进行中的任务还没结束，实际值不完整，算进去会显得"总是高估"。</li>
 *   <li><b>预警只看进行中</b>：backlog 里的任务还没开工（实际 0），预警没有意义。</li>
 * </ul>
 */
@Service
public class EstimateService {

    /** 实际/预估 在 0.85~1.15 之间算"估得准"：再窄会让正常波动全变成偏差 */
    private static final double ACCURATE_LOW = 0.85;
    private static final double ACCURATE_HIGH = 1.15;
    /** 用掉预估 80% 就开始提示，留出反应时间 */
    private static final double RISK_AT = 0.8;

    private final TaskMapper taskMapper;

    public EstimateService(TaskMapper taskMapper) {
        this.taskMapper = taskMapper;
    }

    public EstimateStats stats(String workspaceId) {
        /* 只取填了预估的任务（窄列）并一次 JOIN 出各自工时，不再加载全部历史任务 */
        List<Task> tasks = taskMapper.selectEstimateTasks(workspaceId);
        Map<String, Integer> actual = new HashMap<String, Integer>();
        for (Task t : tasks) {
            actual.put(t.getId(), t.getTotalMinutes() == null ? 0 : t.getTotalMinutes());
        }
        return compute(tasks, actual, taskMapper.countLive(workspaceId));
    }

    // ==================== 纯计算（无 Spring 依赖，可直接单测） ====================

    EstimateStats compute(List<Task> tasks, Map<String, Integer> actualByTask) {
        return compute(tasks, actualByTask, tasks.size());
    }

    EstimateStats compute(List<Task> tasks, Map<String, Integer> actualByTask, int tasksTotal) {
        EstimateStats s = new EstimateStats();
        s.setTasksTotal(tasksTotal);

        int withEstimate = 0;
        long estSum = 0;
        long actSum = 0;
        int sample = 0;
        int noTime = 0;
        int under = 0;
        int accurate = 0;
        int over = 0;
        List<Double> ratios = new ArrayList<Double>();
        Map<String, long[]> catAgg = new LinkedHashMap<String, long[]>();
        List<EstimateStats.RiskTask> risk = new ArrayList<EstimateStats.RiskTask>();
        List<EstimateStats.RiskTask> overrun = new ArrayList<EstimateStats.RiskTask>();

        for (Task t : tasks) {
            Integer est = t.getEstimateMinutes();
            if (est == null || est <= 0) {
                continue;
            }
            withEstimate++;
            int act = actualOf(actualByTask, t.getId());
            boolean done = Consts.COL_DONE.equals(t.getBoardColumn());

            if (!done) {
                /* 进行中：只做预警，不参与系数（实际值还不完整） */
                String col = t.getBoardColumn();
                if (!Consts.COL_BACKLOG.equals(col)) {
                    double r = (double) act / est;
                    if (r >= RISK_AT) {
                        EstimateStats.RiskTask rt = brief(t, est, act, r);
                        rt.setLevel(r >= 1.0 ? "danger" : "warn");
                        risk.add(rt);
                    }
                }
                /* 分类累计也只用已完成样本，避免进行中的任务把某个分类的系数压低 */
                continue;
            }

            /* 没有计时记录的完成任务不能进样本：act=0 会让 ratio=0，被判成"严重高估"，
               把系数整体拉低 —— 那是"压根没记录"，不是"干得比预估快"。
               （线上 8 个已完成任务里 5 个从没开过计时，不排除的话第一次看到的系数就是错的） */
            if (act <= 0) {
                noTime++;
                continue;
            }

            sample++;
            estSum += est;
            actSum += act;
            double ratio = (double) act / est;
            ratios.add(ratio);
            if (ratio > ACCURATE_HIGH) {
                over++;
            } else if (ratio < ACCURATE_LOW) {
                under++;
            } else {
                accurate++;
            }
            if (ratio > ACCURATE_HIGH) {
                overrun.add(brief(t, est, act, ratio));
            }

            String cat = t.getCategory() == null || t.getCategory().trim().isEmpty()
                    ? "未分类" : t.getCategory().trim();
            long[] slot = catAgg.get(cat);
            if (slot == null) {
                /* 必须以 0 起手：这里既做"新建"也做"累加"，初始化时放值会导致
                   每个分类的第一个任务被算两次（分子分母同倍放大，比值看不出来，但多任务时就偏了） */
                slot = new long[]{0L, 0L, 0L};
                catAgg.put(cat, slot);
            }
            slot[0] += est;
            slot[1] += act;
            slot[2]++;
        }

        s.setTasksWithEstimate(withEstimate);
        s.setSampleCount(sample);
        s.setNoTimeCount(noTime);
        s.setUnderCount(under);
        s.setAccurateCount(accurate);
        s.setOverCount(over);

        if (sample > 0 && estSum > 0) {
            s.setOverallFactor(round2((double) actSum / estSum));
            s.setMedianFactor(round2(median(ratios)));
        }

        for (Map.Entry<String, long[]> e : catAgg.entrySet()) {
            long[] v = e.getValue();
            if (v[0] <= 0) {
                continue;
            }
            EstimateStats.CatFactor cf = new EstimateStats.CatFactor();
            cf.setCategory(e.getKey());
            cf.setSampleCount((int) v[2]);
            cf.setEstimateTotal((int) v[0]);
            cf.setActualTotal((int) v[1]);
            cf.setFactor(round2((double) v[1] / v[0]));
            s.getByCategory().add(cf);
        }
        Collections.sort(s.getByCategory(), new Comparator<EstimateStats.CatFactor>() {
            @Override
            public int compare(EstimateStats.CatFactor a, EstimateStats.CatFactor b) {
                return Double.compare(b.getFactor() == null ? 0 : b.getFactor(),
                        a.getFactor() == null ? 0 : a.getFactor());
            }
        });

        Collections.sort(risk, new Comparator<EstimateStats.RiskTask>() {
            @Override
            public int compare(EstimateStats.RiskTask a, EstimateStats.RiskTask b) {
                return Double.compare(b.getRatio(), a.getRatio());
            }
        });
        Collections.sort(overrun, new Comparator<EstimateStats.RiskTask>() {
            @Override
            public int compare(EstimateStats.RiskTask a, EstimateStats.RiskTask b) {
                return Double.compare(b.getRatio(), a.getRatio());
            }
        });
        s.setAtRisk(risk);
        /* 超支复盘只留前 5 条：这是给人看的，不是数据库导出 */
        s.setOverrun(overrun.size() > 5 ? new ArrayList<EstimateStats.RiskTask>(overrun.subList(0, 5)) : overrun);

        s.setSuggestion(suggestionOf(s));
        s.setNote(noteOf(s));
        return s;
    }

    /** 结论：直接告诉用户"下次该乘多少"，而不是让他自己看数字换算 */
    static String suggestionOf(EstimateStats s) {
        Double f = s.getOverallFactor();
        if (f == null || s.getSampleCount() < 1) {
            return "还没有可对比的样本：给任务填上「预计耗时」并完成几个，这里就会算出你自己的系数。";
        }
        /* 系数做过 round2，1.15 可能是 1.1500000000000001：阈值比较留 1e-9 容差，避免边界被误判 */
        if (f > ACCURATE_HIGH + 1e-9) {
            return "团队估时偏乐观：过去 " + s.getSampleCount() + " 个已完成任务的实际投入是预估的 "
                    + fmt(f) + " 倍。下次填预估时，把心里的数乘 " + fmt(f) + " 再填，会贴近真实。";
        }
        if (f < ACCURATE_LOW - 1e-9) {
            return "团队估时偏保守：实际只用到预估的 " + pct(f) + "。可以估得更紧一些，别把缓冲垫得太厚。";
        }
        return "团队估时挺准：实际投入是预估的 " + fmt(f) + " 倍，偏差在可接受范围。";
    }

    private static String noteOf(EstimateStats s) {
        if (s.getTasksTotal() == 0) {
            return "当前空间还没有任务。";
        }
        if (s.getTasksWithEstimate() == 0) {
            return "共 " + s.getTasksTotal() + " 个任务，还没有一个填了预估耗时 —— 全部填上才能算出系数。";
        }
        if (s.getSampleCount() == 0) {
            if (s.getNoTimeCount() > 0) {
                return "有 " + s.getNoTimeCount() + " 个已完成任务填了预估，但它们从没开过计时 —— "
                        + "没有实际耗时可比。下次做这类事顺手点一下「开始计时」，系数才有样本。";
            }
            return "有 " + s.getTasksWithEstimate() + " 个任务填了预估，但都还没完成；系数要等完成后再算。";
        }
        String skip = s.getNoTimeCount() > 0
                ? "另有 " + s.getNoTimeCount() + " 个已完成任务没开过计时，不计入（没记录 ≠ 干得快）；"
                : "";
        return "口径：实际 = 计时记录（只算工作时段、跳周末、每天封顶），不用开始/结束日期推算 —— "
                + "开始日期只代表什么时候接到的，不代表什么时候动手。" + skip
                + "样本 " + s.getSampleCount() + " 个已完成任务。";
    }

    private static EstimateStats.RiskTask brief(Task t, int est, int act, double ratio) {
        EstimateStats.RiskTask rt = new EstimateStats.RiskTask();
        rt.setId(t.getId());
        rt.setTitle(t.getTitle());
        rt.setCategory(t.getCategory());
        rt.setColumn(t.getBoardColumn());
        rt.setEstimateMinutes(est);
        rt.setActualMinutes(act);
        rt.setRatio(round2(ratio));
        return rt;
    }

    private static int actualOf(Map<String, Integer> map, String taskId) {
        Integer v = map.get(taskId);
        return v == null ? 0 : v;
    }

    static double median(List<Double> values) {
        if (values == null || values.isEmpty()) {
            return 0;
        }
        List<Double> sorted = new ArrayList<Double>(values);
        Collections.sort(sorted);
        int n = sorted.size();
        if (n % 2 == 1) {
            return sorted.get(n / 2);
        }
        return (sorted.get(n / 2 - 1) + sorted.get(n / 2)) / 2.0;
    }

    private static double round2(double v) {
        return Math.round(v * 100) / 100.0;
    }

    private static String fmt(double f) {
        return String.format(Locale.CHINA, "%.2f", f);
    }

    private static String pct(double f) {
        return String.format(Locale.CHINA, "%.0f%%", f * 100);
    }
}
