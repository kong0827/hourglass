package com.devstudio.kanban.service;

import com.devstudio.kanban.entity.Requirement;
import com.devstudio.kanban.entity.Task;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** 管理口径的项目事实：由 ManagementQueryService 一次性装配，风险/数据质量为纯函数。 */
public class ProjectFacts {

    public Requirement project;
    public List<Task> tasks = new ArrayList<Task>();
    public Set<String> activeMemberIds = new HashSet<String>();
    public Map<String, String> memberNames;

    public LocalDate today;
    public LocalDateTime lastActivityAt;
    public LocalDate lastCompletedDate;
    public Integer daysSinceCompletion;
    public int actualMinutes;
    public int overloadedMembers;
    public List<String> participants = new ArrayList<String>();

    public int total;
    public int done;
    public int backlogCount;
    public int doingCount;
    public int otherCount;
    public int overdue;
    public int blocked;
    public int p0Overdue;
    public int p1Overdue;
    public int p0Blocked;
    public int p1Blocked;
    public int maxBlockedDays;
    public int doneWeightedPct;
    public int progressWeightedPct;
    public int estimateCoverage;
    public int estimateMinutes;

    public String managerName;
    public boolean managerValid;
    public String statusIssue;

    public boolean planAvailable;
    public Integer plannedPct;
    public Integer variancePct;
    public Integer doneWeightedRaw;
    public Integer progressWeightedRaw;

    public boolean noTasks() {
        return total == 0;
    }
}
