package com.devstudio.kanban.dto;

import lombok.Data;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

/** 管理项目组合行。字段名与 PRD 7.4 对齐。 */
@Data
public class ManagementProjectRow {

    private String id;
    private String name;
    private String status;
    private String manager;
    private String managerUserId;
    private LocalDate startDate;
    private LocalDate dueDate;
    private String priority;

    /** red/amber/green/unknown */
    private String riskLevel;
    /** done_with_open_tasks / done_without_tasks / null */
    private String statusIssue;
    /** 简版管理层状态灯：red / amber / green / unknown（已暂停或无有效任务，与 riskLevel 详细口径并存） */
    private String statusLight;
    /** auto/manual */
    private String healthSource;
    private String healthOverride;
    private String healthNote;
    private List<String> riskReasons = new ArrayList<String>();
    private Integer dataQuality;
    private List<String> missingFields = new ArrayList<String>();
    private LocalDateTime healthOverrideUntil;

    private boolean planAvailable;
    private boolean noTasks;
    private int doneWeightedPct;
    private int progressWeightedPct;
    private Integer plannedPct;
    private Integer variancePct;
    private int estimateCoverage;

    private int taskCount;
    private int doneCount;
    private int backlogCount;
    private int doingCount;
    private int otherCount;
    private int overdueCount;
    private int blockedCount;
    private int estimateMinutes;
    private int actualMinutes;

    private LocalDate lastCompletedDate;
    private Integer daysSinceCompletion;
    private int overloadedMembers;
    private List<String> participants = new ArrayList<String>();

    private LocalDateTime lastActivityAt;
    private String nextNode;
}
