package com.devstudio.kanban.service;

import com.devstudio.kanban.common.Consts;
import com.devstudio.kanban.entity.Task;

import java.util.ArrayList;
import java.util.List;

/** 数据质量：5 个二元检查；只影响徽标，不影响 riskLevel。 */
public final class ProjectDataQualityService {

    private ProjectDataQualityService() {
    }

    public static Result compute(ProjectFacts f) {
        Result r = new Result();
        int checks = 0;
        if (f.project.getManagerUserId() != null && f.project.getManagerUserId().trim().length() > 0
                && f.managerValid) {
            checks++;
        } else {
            r.missingFields.add("缺项目负责人");
        }
        if (f.project.getStartDate() != null) {
            checks++;
        } else {
            r.missingFields.add("缺开始日期");
        }
        if (f.project.getDueDate() != null) {
            checks++;
        } else {
            r.missingFields.add("缺截止日期");
        }

        int ownerCovered = 0;
        int planTasks = 0;
        int planDue = 0;
        for (Task t : f.tasks) {
            if (t.getOwnerUserId() != null && f.activeMemberIds.contains(t.getOwnerUserId())) {
                ownerCovered++;
            }
            boolean committed = !Consts.COL_BACKLOG.equals(t.getBoardColumn()) || t.getDueDate() != null;
            if (committed) {
                planTasks++;
                if (t.getDueDate() != null) {
                    planDue++;
                }
            }
        }
        if (f.total > 0 && ownerCovered * 100 >= f.total * 80) {
            checks++;
        } else {
            r.missingFields.add(f.total == 0 ? "无有效任务" : "任务负责人覆盖率低于 80%");
        }
        if (planTasks > 0 && planDue * 100 >= planTasks * 80) {
            checks++;
        } else {
            r.missingFields.add("计划任务截止日期覆盖率低于 80%");
        }
        r.score = checks * 20;
        return r;
    }

    public static class Result {
        public int score;
        public List<String> missingFields = new ArrayList<String>();
    }
}
