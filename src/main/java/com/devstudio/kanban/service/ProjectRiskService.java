package com.devstudio.kanban.service;

import com.devstudio.kanban.common.Consts;
import com.devstudio.kanban.common.WorkCalendar;
import com.devstudio.kanban.entity.Task;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * 风险纯函数：只依赖 ProjectFacts + today，不查库。
 * 风险与数据质量彼此独立；数据质量不降级风险。
 */
public final class ProjectRiskService {

    private ProjectRiskService() {
    }

    public static RiskResult evaluate(ProjectFacts f) {
        computeMetrics(f);
        RiskResult r = new RiskResult();

        String status = f.project.getStatus();
        if ("done".equals(status)) {
            if (f.total == 0) {
                f.statusIssue = "done_without_tasks";
                r.level = "unknown";
                r.statusIssue = f.statusIssue;
            } else if (f.done < f.total) {
                f.statusIssue = "done_with_open_tasks";
                r.level = "unknown";
                r.statusIssue = f.statusIssue;
            } else {
                r.level = "green";
            }
            r.planAvailable = f.planAvailable;
            r.plannedPct = f.plannedPct;
            r.variancePct = f.variancePct;
            return r;
        }
        if ("hold".equals(status)) {
            r.level = "unknown";
            r.planAvailable = f.planAvailable;
            r.plannedPct = f.plannedPct;
            r.variancePct = f.variancePct;
            return r;
        }

        boolean manual = hasManualOverride(f);
        if (f.total == 0) {
            if (manual) {
                r.level = f.project.getHealthOverride();
                r.source = "manual";
                r.reasons.add("人工覆盖：" + safe(f.project.getHealthNote()));
            } else {
                r.level = "unknown";
                r.reasons.add("项目下没有有效任务");
            }
            r.planAvailable = f.planAvailable;
            r.plannedPct = f.plannedPct;
            r.variancePct = f.variancePct;
            return r;
        }

        List<RiskItem> risks = new ArrayList<RiskItem>();
        boolean hasRed = false;
        boolean hasAmber = false;

        if (f.project.getDueDate() != null && f.today.isAfter(f.project.getDueDate()) && f.done < f.total) {
            long days = ChronoUnit.DAYS.between(f.project.getDueDate(), f.today);
            risks.add(item("project_overdue", "red", "已过截止日 " + days + " 天，仍有未完成任务",
                    "截止 " + f.project.getDueDate() + "，完成 " + f.done + "/" + f.total, (int) days,
                    "重排期或缩小范围"));
        }
        if (f.planAvailable && f.variancePct != null) {
            if (f.variancePct <= -20) {
                risks.add(item("progress_behind", "red", "进度偏差 " + f.variancePct + "pp",
                        "实际 " + f.doneWeightedPct + "% / 计划 " + f.plannedPct + "%", null,
                        "检查阻塞与排期"));
            } else if (f.variancePct <= -10) {
                risks.add(item("progress_behind", "amber", "进度偏差 " + f.variancePct + "pp",
                        "实际 " + f.doneWeightedPct + "% / 计划 " + f.plannedPct + "%", null,
                        "关注本周推进"));
            }
        }
        if (f.p0Overdue > 0 || f.p1Overdue > 0) {
            risks.add(item("task_overdue", "red", "存在 P0/P1 逾期任务",
                    "P0 逾期 " + f.p0Overdue + " 个，P1 逾期 " + f.p1Overdue + " 个", null,
                    "优先处理高优先级逾期"));
        } else if (f.overdue > 0) {
            risks.add(item("task_overdue", "amber", "存在逾期任务",
                    "逾期任务 " + f.overdue + " 个", null, "安排补期或拆小"));
        }
        if (f.total > 0 && f.overdue >= 2 && f.overdue * 100 >= f.total * 30) {
            risks.add(item("overdue_ratio", "red", "逾期任务占比过高",
                    f.overdue + "/" + f.total + " = " + Math.round(f.overdue * 100.0 / f.total) + "%",
                    null, "集中清理逾期"));
        }
        if (f.p0Blocked > 0 || f.p1Blocked > 0) {
            int longBlocked = longBlocked(f, true);
            if (longBlocked > 0) {
                risks.add(item("task_blocked", "red", "P0/P1 任务阻塞超过 3 天",
                        "P0/P1 阻塞 " + longBlocked + " 个，最长 " + f.maxBlockedDays + " 天",
                        f.maxBlockedDays, "解除阻塞或升级协调"));
            } else {
                risks.add(item("task_blocked", "amber", "存在 P0/P1 阻塞任务",
                        "P0/P1 阻塞 " + (f.p0Blocked + f.p1Blocked) + " 个", f.maxBlockedDays,
                        "确认阻塞原因"));
            }
        } else if (f.blocked > 0 && f.maxBlockedDays >= 3) {
            risks.add(item("task_blocked", "amber", "存在阻塞任务",
                    "阻塞 " + f.blocked + " 个，最长 " + f.maxBlockedDays + " 天", f.maxBlockedDays,
                    "确认阻塞原因"));
        }
        if (f.planAvailable && f.plannedPct != null && f.project.getDueDate() != null) {
            long daysToDue = ChronoUnit.DAYS.between(f.today, f.project.getDueDate());
            if (daysToDue >= 0 && daysToDue <= 7 && f.plannedPct >= 80
                    && f.doneWeightedPct * 100 < f.plannedPct * 80) {
                risks.add(item("near_due", "amber", "临期且进度不足",
                        "剩余 " + daysToDue + " 天，实际 " + f.doneWeightedPct + "% / 计划 " + f.plannedPct + "%",
                        null, "确认交付范围"));
            }
        }
        if (f.lastActivityAt != null && f.today.isAfter(f.lastActivityAt.toLocalDate())
                && ChronoUnit.DAYS.between(f.lastActivityAt.toLocalDate(), f.today) >= 14) {
            long days = ChronoUnit.DAYS.between(f.lastActivityAt.toLocalDate(), f.today);
            risks.add(item("project_stalled", "amber", "项目已 " + days + " 天无实质活动",
                    "最后活动 " + f.lastActivityAt.toLocalDate(), (int) days, "确认项目是否暂停"));
        }
        if (manual && ("red".equals(f.project.getHealthOverride()) || "amber".equals(f.project.getHealthOverride()))) {
            risks.add(item("manual_override", f.project.getHealthOverride(),
                    "人工覆盖：" + safe(f.project.getHealthNote()),
                    f.project.getHealthOverrideUntil() == null ? "人工覆盖无到期时间"
                            : "覆盖到期 " + f.project.getHealthOverrideUntil().toLocalDate(),
                    null, "到期前处理或恢复自动"));
        }

        for (RiskItem i : risks) {
            if ("red".equals(i.severity)) {
                hasRed = true;
            } else if ("amber".equals(i.severity)) {
                hasAmber = true;
            }
            r.reasons.add(i.reason);
        }
        r.risks.addAll(risks);
        r.planAvailable = f.planAvailable;
        r.plannedPct = f.plannedPct;
        r.variancePct = f.variancePct;

        if (manual) {
            r.level = f.project.getHealthOverride();
            r.source = "manual";
            r.reasons.add("人工覆盖：" + safe(f.project.getHealthNote()));
        } else if (hasRed) {
            r.level = "red";
        } else if (hasAmber) {
            r.level = "amber";
        } else if (!f.planAvailable) {
            r.level = "unknown";
            r.reasons.add("计划信息未维护（缺起止日期）");
        } else {
            r.level = "green";
        }
        return r;
    }

    private static void computeMetrics(ProjectFacts f) {
        int totalWeight = 0;
        int doneWeight = 0;
        int progressWeight = 0;
        int estimateCount = 0;
        int p0Overdue = 0, p1Overdue = 0, p0Blocked = 0, p1Blocked = 0;
        int maxBlocked = 0;
        f.tasks = f.tasks == null ? new ArrayList<Task>() : f.tasks;
        Set<String> participantSet = new LinkedHashSet<String>();
        for (Task t : f.tasks) {
            int weight = t.getEstimateMinutes() != null && t.getEstimateMinutes() > 0
                    ? t.getEstimateMinutes() : 1;
            totalWeight += weight;
            if (t.getEstimateMinutes() != null && t.getEstimateMinutes() > 0) {
                estimateCount++;
                f.estimateMinutes += t.getEstimateMinutes();
            }
            boolean done = Consts.COL_DONE.equals(t.getBoardColumn());
            if (done) {
                f.done++;
                doneWeight += weight;
            } else if (Consts.COL_BACKLOG.equals(t.getBoardColumn())) {
                f.backlogCount++;
            } else if (Consts.COL_DOING.equals(t.getBoardColumn())) {
                f.doingCount++;
            } else {
                f.otherCount++;
            }
            String person = t.getOwnerUserId() != null && f.memberNames != null
                    && f.memberNames.get(t.getOwnerUserId()) != null
                    ? f.memberNames.get(t.getOwnerUserId())
                    : (t.getOwner() == null ? null : t.getOwner().trim());
            if (person != null && !person.isEmpty()) {
                participantSet.add(person);
            }
            int progress = done ? 100 : Math.max(0, Math.min(99, t.getProgress() == null ? 0 : t.getProgress()));
            progressWeight += weight * progress;
            if (!done && t.getDueDate() != null && t.getDueDate().isBefore(f.today)) {
                f.overdue++;
                if ("P0".equals(t.getPriority())) p0Overdue++;
                else if ("P1".equals(t.getPriority())) p1Overdue++;
            }
            if (!done && Boolean.TRUE.equals(t.getBlocked())) {
                f.blocked++;
                if ("P0".equals(t.getPriority())) p0Blocked++;
                else if ("P1".equals(t.getPriority())) p1Blocked++;
                if (t.getBlockedAt() != null) {
                    int days = (int) Math.max(0, ChronoUnit.DAYS.between(t.getBlockedAt().toLocalDate(), f.today));
                    maxBlocked = Math.max(maxBlocked, days);
                }
            }
        }
        f.total = f.tasks.size();
        f.participants = new ArrayList<String>(participantSet);
        f.doneWeightedPct = totalWeight == 0 ? 0 : (int) Math.round(doneWeight * 100.0 / totalWeight);
        f.progressWeightedPct = totalWeight == 0 ? 0 : (int) Math.round(progressWeight * 100.0 / totalWeight);
        f.estimateCoverage = f.total == 0 ? 0 : (int) Math.round(estimateCount * 100.0 / f.total);
        f.p0Overdue = p0Overdue;
        f.p1Overdue = p1Overdue;
        f.p0Blocked = p0Blocked;
        f.p1Blocked = p1Blocked;
        f.maxBlockedDays = maxBlocked;
        computePlan(f);
    }

    private static void computePlan(ProjectFacts f) {
        LocalDate start = f.project.getStartDate();
        LocalDate due = f.project.getDueDate();
        if (start == null || due == null || due.isBefore(start)) {
            f.planAvailable = false;
            f.plannedPct = null;
            f.variancePct = null;
            return;
        }
        int totalDays = WorkCalendar.workingDays(start, due);
        if (totalDays <= 0) {
            f.planAvailable = false;
            f.plannedPct = null;
            f.variancePct = null;
            return;
        }
        f.planAvailable = true;
        int elapsed;
        if (f.today.isBefore(start)) {
            elapsed = 0;
        } else if (f.today.isAfter(due)) {
            elapsed = totalDays;
        } else {
            elapsed = WorkCalendar.workingDays(start, f.today);
        }
        f.plannedPct = (int) Math.round(elapsed * 100.0 / totalDays);
        f.variancePct = f.doneWeightedPct - f.plannedPct;
    }

    private static boolean hasManualOverride(ProjectFacts f) {
        String v = f.project.getHealthOverride();
        if (!"red".equals(v) && !"amber".equals(v) && !"green".equals(v)) {
            return false;
        }
        LocalDateTime until = f.project.getHealthOverrideUntil();
        return until == null || until.isAfter(LocalDateTime.now());
    }

    private static int longBlocked(ProjectFacts f, boolean highPriority) {
        int n = 0;
        for (Task t : f.tasks) {
            if (!Consts.COL_DONE.equals(t.getBoardColumn()) && Boolean.TRUE.equals(t.getBlocked())
                    && t.getBlockedAt() != null
                    && (highPriority ? ("P0".equals(t.getPriority()) || "P1".equals(t.getPriority())) : true)
                    && ChronoUnit.DAYS.between(t.getBlockedAt().toLocalDate(), f.today) >= 3) {
                n++;
            }
        }
        return n;
    }

    private static RiskItem item(String type, String severity, String reason, String evidence,
                                 Integer days, String action) {
        RiskItem i = new RiskItem();
        i.type = type;
        i.severity = severity;
        i.reason = reason;
        i.evidence = evidence;
        i.days = days;
        i.suggestedAction = action;
        return i;
    }

    private static String safe(String s) {
        return s == null ? "" : s;
    }

    public static class RiskResult {
        public String level;
        public String statusIssue;
        public String source = "auto";
        public boolean planAvailable;
        public Integer plannedPct;
        public Integer variancePct;
        public List<String> reasons = new ArrayList<String>();
        public List<RiskItem> risks = new ArrayList<RiskItem>();
    }

    public static class RiskItem {
        public String type;
        public String severity;
        public String reason;
        public String evidence;
        public Integer days;
        public String suggestedAction;
    }
}
