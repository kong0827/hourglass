package com.hourglass.dto;

import lombok.Data;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

/**
 * 发布前测试检查：按项目策略把必测用例与需求/工作项覆盖折算成阻断与提醒。
 *
 * <p>检查是只读推导：不修改用例、计划或任务。确认发布时同一口径的结论会冻结进
 * version_release.plan_snapshot.testEvidence，历史记录不随之后的结果变化。
 */
@Data
public class ReleaseCheckResponse {

    private String versionId;
    private String planId;
    private Long planRevision;
    /** strict / standard / loose */
    private String policy;
    /** pass 通过 / warn 有提醒 / block 有阻断 */
    private String verdict;

    private List<String> blockers = new ArrayList<String>();
    private List<String> reminders = new ArrayList<String>();

    private Integer caseTotal;
    private Integer caseExecuted;
    private Integer casePassed;
    private Integer caseFailed;
    private Integer caseBlocked;
    private Integer caseSkipped;
    private Integer caseUntested;

    private Integer requiredTotal;
    private Integer requiredPassed;
    private Integer requiredFailed;
    private Integer requiredUntested;

    /** 需求级覆盖：至少一条用例关联该需求 */
    private Integer demandsTotal;
    private Integer demandsCovered;
    /** 工作项级覆盖：至少一条用例明确验证该工作项 */
    private Integer workItemsTotal;
    private Integer workItemsCovered;

    private List<ReleaseCheckCase> requiredFailures = new ArrayList<ReleaseCheckCase>();
    private List<ReleaseCheckCase> requiredUnexecuted = new ArrayList<ReleaseCheckCase>();
    /** 计划内需求范围（由计划用例主需求派生） */
    private List<String> demandTitles = new ArrayList<String>();

    private LocalDateTime checkedAt;
}
