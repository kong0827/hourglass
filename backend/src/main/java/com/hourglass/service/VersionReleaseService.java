package com.hourglass.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.hourglass.common.AppException;
import com.hourglass.common.Consts;
import com.hourglass.common.Ids;
import com.hourglass.common.Texts;
import com.hourglass.dto.PlanVersionRow;
import com.hourglass.dto.ReleaseConfirmRequest;
import com.hourglass.dto.ReleasePlanOptionRow;
import com.hourglass.dto.ReleasePlanOptions;
import com.hourglass.dto.ReleasePlanRequest;
import com.hourglass.dto.ReleasePlanRow;
import com.hourglass.dto.ReleaseCheckCase;
import com.hourglass.dto.ReleaseCheckResponse;
import com.hourglass.dto.ReleasePreviewResponse;
import com.hourglass.dto.ReleasePreviewRequest;
import com.hourglass.dto.TaskVersionBinding;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.Arrays;
import java.util.Collections;
import java.util.TreeSet;
import java.util.TreeMap;
import java.util.HashSet;
import java.util.Locale;
import java.util.SortedSet;
import com.hourglass.entity.AppUser;
import com.hourglass.entity.Demand;
import com.hourglass.entity.ProjectVersion;
import com.hourglass.entity.Requirement;
import com.hourglass.entity.Task;
import com.hourglass.entity.TaskLog;
import com.hourglass.entity.VersionRelease;
import com.hourglass.entity.VersionReleaseItem;
import com.hourglass.entity.VersionReleasePlan;
import com.hourglass.mapper.DemandMapper;
import com.hourglass.mapper.ProjectVersionMapper;
import com.hourglass.mapper.ReleaseMapper;
import com.hourglass.mapper.RequirementMapper;
import com.hourglass.mapper.UserMapper;
import com.hourglass.mapper.VersionTaskMapper;
import com.hourglass.mapper.WorkspaceMemberMapper;
import org.springframework.stereotype.Service;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

@Service
public class VersionReleaseService {
    private static final Logger log = LoggerFactory.getLogger(VersionReleaseService.class);
    private static final DateTimeFormatter MINUTE = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm");
    private final ReleaseMapper mapper;
    private final ProjectVersionMapper versionMapper;
    private final RequirementMapper reqMapper;
    private final DemandMapper demandMapper;
    private final UserMapper userMapper;
    private final VersionTaskMapper versionTaskMapper;
    private final WorkspaceMemberMapper memberMapper;
    private final DeliveryScopeLock scopeLock;
    private final ReleasePermissionService permissions;
    private final ProjectAccessService access;
    private final TaskPublicationService taskPublication;
    private final NotificationEventService notifications;
    private final ObjectMapper json;
    private final NumberSeqService numberSeq;
    private final TransactionTemplate notificationTx;
    /** 发布检查：读取计划用例结果、需求与工作项覆盖；只读，不写用例状态 */
    private final com.hourglass.mapper.TestPlanCaseMapper planCaseMapper;
    private final com.hourglass.mapper.TestCaseTaskMapper caseTaskMapper;
    private final com.hourglass.mapper.TestCaseMapper caseMapper;
    private final com.hourglass.mapper.TestPlanMapper testPlanMapper;
    private final AuditService auditService;
    /** 策略变更同时写项目活动轨迹，项目可见的人都能看到（审计日志仅平台管理员）。 */
    private final WorkActivityService workActivityService;
    /** 发布成功后给随发工作项补动态，工作项时间线才看得到「哪次发布带走了它」 */
    private final com.hourglass.mapper.TaskLogMapper taskLogMapper;
    /** 团队共享用例分组的结果分布：与必测用例同口径冻结进发布证据 */
    private final CaseSetService caseSetService;
    /** 发布证据变化后重新判定受影响需求的完成状态（成功生产发布 / 回滚） */
    private final DemandCompletionService demandCompletion;
    /** 发布计划关注者通知：改期 / 范围变化 / 进入就绪 */
    private final ReleasePrepService releasePrep;
    /** 发布通知规则开关；关闭后仍记录发布事实，只是不打扰负责人 */
    private final AutomationSettingsService automation;
    /** 版本报告订阅：成功生产发布后按订阅人发送 */
    private final ReportService reports;

    public VersionReleaseService(ReleaseMapper mapper, ProjectVersionMapper versionMapper,
                                 RequirementMapper reqMapper, DemandMapper demandMapper, UserMapper userMapper,
                                 VersionTaskMapper versionTaskMapper,
                                 WorkspaceMemberMapper memberMapper, DeliveryScopeLock scopeLock,
                                 ReleasePermissionService permissions, ProjectAccessService access,
                                 TaskPublicationService taskPublication, NotificationEventService notifications,
                                 ObjectMapper json, PlatformTransactionManager transactionManager,
                                 NumberSeqService numberSeq,
                                 com.hourglass.mapper.TestPlanCaseMapper planCaseMapper,
                                 com.hourglass.mapper.TestCaseTaskMapper caseTaskMapper,
                                 com.hourglass.mapper.TestCaseMapper caseMapper,
                                 com.hourglass.mapper.TestPlanMapper testPlanMapper,
                                 AuditService auditService,
                                 WorkActivityService workActivityService,
                                 com.hourglass.mapper.TaskLogMapper taskLogMapper,
                                 CaseSetService caseSetService,
                                 DemandCompletionService demandCompletion,
                                 ReleasePrepService releasePrep,
                                 AutomationSettingsService automation,
                                 ReportService reports) {
        this.mapper = mapper;
        this.versionMapper = versionMapper;
        this.reqMapper = reqMapper;
        this.demandMapper = demandMapper;
        this.userMapper = userMapper;
        this.versionTaskMapper = versionTaskMapper;
        this.memberMapper = memberMapper;
        this.scopeLock = scopeLock;
        this.permissions = permissions;
        this.access = access;
        this.taskPublication = taskPublication;
        this.notifications = notifications;
        this.json = json;
        this.numberSeq = numberSeq;
        this.planCaseMapper = planCaseMapper;
        this.caseTaskMapper = caseTaskMapper;
        this.caseMapper = caseMapper;
        this.testPlanMapper = testPlanMapper;
        this.auditService = auditService;
        this.workActivityService = workActivityService;
        this.taskLogMapper = taskLogMapper;
        this.caseSetService = caseSetService;
        this.demandCompletion = demandCompletion;
        this.releasePrep = releasePrep;
        this.automation = automation;
        this.reports = reports;
        this.notificationTx = new TransactionTemplate(transactionManager);
        this.notificationTx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    private ProjectVersion requireVersion(String userId, String workspaceId, String id) {
        ProjectVersion version = versionMapper.selectById(id);
        if (version == null || !workspaceId.equals(version.getWorkspaceId())) {
            throw AppException.notFound("版本不存在");
        }
        access.assertView(workspaceId, userId, version.getReqId());
        return version;
    }

    private ProjectVersion requireVersionForUpdate(String userId, String workspaceId, String id) {
        ProjectVersion version = versionMapper.selectByIdForUpdate(workspaceId, id);
        if (version == null || !workspaceId.equals(version.getWorkspaceId())) {
            throw AppException.notFound("版本不存在");
        }
        access.assertView(workspaceId, userId, version.getReqId());
        return version;
    }

    public List<VersionReleasePlan> plans(String userId, String workspaceId, String versionId) {
        requireVersion(userId, workspaceId, versionId);
        List<VersionReleasePlan> plans = mapper.selectPlans(workspaceId, versionId);
        for (VersionReleasePlan plan : plans) {
            plan.setPlannedTaskIds(mapper.selectPlannedTaskIds(workspaceId, plan.getId()));
            hydratePlan(workspaceId, plan);
        }
        return plans;
    }

    /**
     * 发布检查：只读汇总本版本测试计划的必测用例与需求/工作项覆盖。
     * 未关联发布计划时仍核对本版本全部测试计划，只是覆盖分母退化为版本范围。
     */
    public ReleaseCheckResponse releaseCheck(String userId, String workspaceId, String versionId, String planId) {
        ProjectVersion version = requireVersion(userId, workspaceId, versionId);
        VersionReleasePlan plan = findPlan(workspaceId, versionId, Texts.trimToNull(planId));
        return evaluate(workspaceId, version, plan);
    }

    /** 项目级测试检查策略：strict / standard / loose，默认 standard */
    public String releasePolicy(String userId, String workspaceId, String reqId) {
        Requirement project = reqMapper.selectById(reqId);
        if (project == null || !workspaceId.equals(project.getWorkspaceId())) throw AppException.notFound("项目不存在");
        access.assertView(workspaceId, userId, reqId);
        return normalizePolicy(project.getReleaseCheckPolicy());
    }

    public String saveReleasePolicy(String userId, String workspaceId, String reqId, String policy) {
        Requirement project = reqMapper.selectById(reqId);
        if (project == null || !workspaceId.equals(project.getWorkspaceId())) throw AppException.notFound("项目不存在");
        permissions.assertManageProject(userId, workspaceId, reqId);
        String normalized = normalizePolicy(policy);
        if (!normalized.equals(policy)) throw AppException.badRequest("发布检查策略无效");
        String before = normalizePolicy(project.getReleaseCheckPolicy());
        if (reqMapper.updateReleasePolicy(workspaceId, reqId, normalized) != 1) throw new AppException(409, "策略写入冲突");
        if (!before.equals(normalized)) {
            auditService.recordCurrent(workspaceId, "project_release_policy", "project", reqId, project.getName(), true,
                    "发布检查策略：" + policyLabel(before) + " → " + policyLabel(normalized), null);
            workActivityService.recordCurrent(workspaceId, WorkActivityService.PROJECT, reqId, "release_policy_update",
                    "发布检查策略：" + policyLabel(before) + " → " + policyLabel(normalized));
        }
        return normalized;
    }

    private static String policyLabel(String policy) {
        if ("strict".equals(policy)) return "严格";
        if ("loose".equals(policy)) return "宽松";
        return "标准";
    }

    /** 同一用例可能出现在多个测试计划：结果取最差、必测取并集，避免多计划互相掩盖风险 */
    private List<ReleaseCheckCase> mergeEvidenceCases(List<ReleaseCheckCase> rows) {
        Map<String, ReleaseCheckCase> merged = new LinkedHashMap<String, ReleaseCheckCase>();
        if (rows == null) return new ArrayList<ReleaseCheckCase>();
        for (ReleaseCheckCase row : rows) {
            if (row == null || Texts.trimToNull(row.getCaseId()) == null) continue;
            row.setRequired(Boolean.TRUE.equals(row.getRequired()));
            ReleaseCheckCase kept = merged.get(row.getCaseId());
            if (kept == null) {
                merged.put(row.getCaseId(), row);
                continue;
            }
            boolean required = Boolean.TRUE.equals(kept.getRequired()) || Boolean.TRUE.equals(row.getRequired());
            if (resultRank(row.getResult()) > resultRank(kept.getResult())) {
                row.setRequired(required);
                merged.put(row.getCaseId(), row);
            } else {
                kept.setRequired(required);
            }
        }
        return new ArrayList<ReleaseCheckCase>(merged.values());
    }

    private static int resultRank(String result) {
        if ("failed".equals(result)) return 4;
        if ("blocked".equals(result)) return 3;
        if ("skipped".equals(result)) return 2;
        if (Texts.trimToNull(result) == null) return 1;
        return 0;
    }

    private VersionReleasePlan findPlan(String workspaceId, String versionId, String planId) {
        if (planId == null) return null;
        for (VersionReleasePlan plan : mapper.selectPlans(workspaceId, versionId)) {
            if (planId.equals(plan.getId())) {
                hydratePlan(workspaceId, plan);
                plan.setPlannedTaskIds(mapper.selectPlannedTaskIds(workspaceId, plan.getId()));
                return plan;
            }
        }
        throw AppException.notFound("发布计划不存在或不属于该版本");
    }

    private static String normalizePolicy(String policy) {
        String value = Texts.trimToNull(policy);
        return value != null && Arrays.asList("strict", "standard", "loose").contains(value) ? value : "standard";
    }

    private ReleaseCheckResponse evaluate(String workspaceId, ProjectVersion version, VersionReleasePlan plan) {
        Requirement project = reqMapper.selectById(version.getReqId());
        String policy = normalizePolicy(project == null ? null : project.getReleaseCheckPolicy());
        ReleaseCheckResponse check = new ReleaseCheckResponse();
        check.setVersionId(version.getId());
        check.setPolicy(policy);
        check.setPlanId(plan == null ? null : plan.getId());
        check.setPlanRevision(plan == null ? null : plan.getRevision());
        check.setCheckedAt(LocalDateTime.now(ZoneOffset.UTC).truncatedTo(ChronoUnit.MICROS));

        int total = 0, executed = 0, passed = 0, failed = 0, blocked = 0, skipped = 0;
        int requiredTotal = 0, requiredPassed = 0, requiredFailed = 0, requiredUntested = 0;
        /* 证据始终按本版本的全部测试计划核对，不因未关联发布计划而漏掉必测用例；
           发布计划只影响 planId / 修订号与覆盖分母（计划任务 ∩ 版本范围）。 */
        List<ReleaseCheckCase> cases = mergeEvidenceCases(
                planCaseMapper.selectEvidenceCasesByVersion(workspaceId, version.getId()));
        if (cases == null) cases = new ArrayList<ReleaseCheckCase>();
        Set<String> demandTitles = new TreeSet<String>();
        for (ReleaseCheckCase c : cases) {
            total++;
            boolean required = Boolean.TRUE.equals(c.getRequired());
            if (required) requiredTotal++;
            String result = Texts.trimToNull(c.getResult());
            if (result != null) executed++;
            if ("passed".equals(result)) { passed++; if (required) requiredPassed++; }
            else if ("failed".equals(result)) { failed++; if (required) { requiredFailed++; check.getRequiredFailures().add(c); } }
            else if ("blocked".equals(result)) { blocked++; if (required) { requiredFailed++; check.getRequiredFailures().add(c); } }
            else if ("skipped".equals(result)) { skipped++; if (required) { requiredUntested++; check.getRequiredUnexecuted().add(c); } }
            else if (required) { requiredUntested++; check.getRequiredUnexecuted().add(c); }
            if (Texts.trimToNull(c.getDemandTitle()) != null && demandTitles.add(c.getDemandTitle())) {
                check.getDemandTitles().add(c.getDemandTitle());
            }
        }
        check.setCaseTotal(total);
        check.setCaseExecuted(executed);
        check.setCasePassed(passed);
        check.setCaseFailed(failed);
        check.setCaseBlocked(blocked);
        check.setCaseSkipped(skipped);
        check.setCaseUntested(total - executed);
        check.setRequiredTotal(requiredTotal);
        check.setRequiredPassed(requiredPassed);
        check.setRequiredFailed(requiredFailed);
        check.setRequiredUntested(requiredUntested);

        /* 覆盖分母取本次发布范围（计划任务 ∩ 当前版本范围；无计划任务时取版本范围），不是整个项目 */
        List<String> versionTaskIds = mapper.selectScopeTaskIds(workspaceId, version.getId());
        Set<String> scopeTaskIds = versionTaskIds == null ? new HashSet<String>() : new HashSet<String>(versionTaskIds);
        if (plan != null && plan.getPlannedTaskIds() != null && !plan.getPlannedTaskIds().isEmpty()) {
            scopeTaskIds.retainAll(plan.getPlannedTaskIds());
        }
        /* 计划任务与本版本范围没有交集时，工作项级覆盖不适用；显式说明，避免面板只剩一个无解释的 0/0 */
        boolean planWithoutVersionTasks = plan != null && plan.getPlannedTaskIds() != null
                && !plan.getPlannedTaskIds().isEmpty()
                && versionTaskIds != null && !versionTaskIds.isEmpty() && scopeTaskIds.isEmpty();
        List<com.hourglass.dto.TaskCoverageRow> workItems = scopeTaskIds.isEmpty()
                ? new ArrayList<com.hourglass.dto.TaskCoverageRow>()
                : caseTaskMapper.selectCoverageByTasks(workspaceId, new ArrayList<String>(scopeTaskIds));
        int workItemsTotal = 0, workItemsCovered = 0;
        Set<String> scopeDemandIds = new HashSet<String>();
        List<String> versionDemandIds = mapper.selectDemandIdsByVersion(workspaceId, version.getReqId(), version.getId());
        if (versionDemandIds != null) scopeDemandIds.addAll(versionDemandIds);
        if (workItems != null) {
            for (com.hourglass.dto.TaskCoverageRow row : workItems) {
                workItemsTotal++;
                if (row.getCaseTotal() != null && row.getCaseTotal() > 0) workItemsCovered++;
                if (row.getDemandId() != null) scopeDemandIds.add(row.getDemandId());
            }
        }
        check.setWorkItemsTotal(workItemsTotal);
        check.setWorkItemsCovered(workItemsCovered);

        List<com.hourglass.dto.CaseCoverageRow> demands = caseMapper.selectCoverageByDemand(workspaceId, version.getReqId());
        int demandsTotal = 0, demandsCovered = 0;
        if (demands != null) {
            for (com.hourglass.dto.CaseCoverageRow row : demands) {
                if (!scopeDemandIds.contains(row.getDemandId())) continue;
                /* 已驳回 / 已取消的需求不再要求用例覆盖，否则会报「仍有需求没有任何用例」的假信号 */
                if (isDroppedDemand(row.getDemandStatus())) continue;
                demandsTotal++;
                if (row.getCaseTotal() != null && row.getCaseTotal() > 0) demandsCovered++;
            }
        }
        check.setDemandsTotal(demandsTotal);
        check.setDemandsCovered(demandsCovered);
        /* 团队共享分组：只呈现结果分布，不改变阻断判定（必测口径仍由测试计划决定） */
        check.setCaseSets(caseSetService.teamSetEvidence(workspaceId, version.getReqId()));

        boolean strict = "strict".equals(policy), loose = "loose".equals(policy);
        boolean hasPlans = testPlanMapper.countByVersion(workspaceId, version.getId()) > 0;
        boolean hasActivePlans = testPlanMapper.countActiveByVersion(workspaceId, version.getId()) > 0;
        if (!hasPlans) {
            check.getReminders().add("本版本还没有关联测试计划；在「测试」→「测试计划」中把计划关联到本版本后，发布检查才能核对必测用例");
        } else if (!hasActivePlans) {
            check.getReminders().add("本版本的测试计划还是草稿；把计划状态改为「执行中」或「已完成」后，发布检查才会核对必测用例");
        } else if (total == 0) {
            check.getReminders().add("本版本的测试计划还没有用例，无法核对发布必测");
        } else {
            if (plan == null) {
                check.getReminders().add("未关联发布计划：按本版本全部测试计划核对发布必测用例，覆盖分母为版本范围");
            }
            if (requiredTotal == 0) {
                check.getReminders().add("本版本的测试计划还没有标记「发布必测」的用例");
            }
        }
        if (requiredFailed > 0) {
            String msg = "发布必测用例失败或阻塞 " + requiredFailed + " 条";
            (loose ? check.getReminders() : check.getBlockers()).add(msg);
        }
        if (requiredUntested > 0) {
            String msg = "发布必测用例未执行或跳过 " + requiredUntested + " 条";
            (strict ? check.getBlockers() : check.getReminders()).add(msg);
        }
        if (strict && total > 0 && check.getCaseUntested() > 0) {
            check.getBlockers().add("严格策略：测试计划内还有 " + check.getCaseUntested() + " 条用例未执行");
        } else if (!strict && check.getCaseUntested() > 0 && plan != null) {
            check.getReminders().add("测试计划内还有 " + check.getCaseUntested() + " 条用例未执行");
        }
        if (strict && failed > 0) {
            check.getBlockers().add("严格策略：测试计划内用例失败 " + failed + " 条");
        }
        if (workItemsTotal > 0 && workItemsCovered < workItemsTotal) {
            check.getReminders().add("工作项级覆盖 " + workItemsCovered + "/" + workItemsTotal
                    + "，未覆盖工作项可按需求级用例兜底核对");
        }
        if (planWithoutVersionTasks) {
            check.getReminders().add("发布计划的工作项都不在本版本范围内；工作项级覆盖不适用，请按需求级用例核对");
        }
        if (demandsTotal > 0 && demandsCovered < demandsTotal) {
            check.getReminders().add("需求级覆盖 " + demandsCovered + "/" + demandsTotal + "，仍有需求没有任何用例");
        }
        check.setVerdict(check.getBlockers().isEmpty()
                ? (check.getReminders().isEmpty() ? "pass" : "warn") : "block");
        return check;
    }

    /** 已关闭（驳回 / 取消 / 重复）与历史 rej / canceled 状态的需求退出覆盖分母：它们不再期待测试用例。 */
    private static boolean isDroppedDemand(String status) {
        String value = Texts.trimToNull(status);
        return "closed".equals(value) || "rej".equals(value) || "canceled".equals(value);
    }

    /** 冻结进 plan_snapshot.testEvidence 的紧凑证据：只记结论与计数，不复制用例全文 */
    private Map<String, Object> testEvidence(ReleaseCheckResponse check) {
        Map<String, Object> evidence = new LinkedHashMap<String, Object>();
        evidence.put("policy", check.getPolicy());
        evidence.put("verdict", check.getVerdict());
        evidence.put("planId", check.getPlanId());
        evidence.put("planRevision", check.getPlanRevision());
        /* 证据总是覆盖本版本全部测试计划；planLinked 说明当时是否关联了发布计划 */
        evidence.put("evidenceScope", "version");
        evidence.put("planLinked", check.getPlanId() != null);
        evidence.put("caseTotal", check.getCaseTotal());
        evidence.put("caseExecuted", check.getCaseExecuted());
        evidence.put("casePassed", check.getCasePassed());
        evidence.put("caseFailed", check.getCaseFailed());
        evidence.put("caseBlocked", check.getCaseBlocked());
        evidence.put("caseSkipped", check.getCaseSkipped());
        evidence.put("caseUntested", check.getCaseUntested());
        evidence.put("requiredTotal", check.getRequiredTotal());
        evidence.put("requiredPassed", check.getRequiredPassed());
        evidence.put("requiredFailed", check.getRequiredFailed());
        evidence.put("requiredUntested", check.getRequiredUntested());
        evidence.put("demandsTotal", check.getDemandsTotal());
        evidence.put("demandsCovered", check.getDemandsCovered());
        evidence.put("workItemsTotal", check.getWorkItemsTotal());
        evidence.put("workItemsCovered", check.getWorkItemsCovered());
        evidence.put("blockers", check.getBlockers());
        evidence.put("reminders", check.getReminders());
        evidence.put("demandTitles", check.getDemandTitles());
        evidence.put("caseSets", check.getCaseSets());
        List<Map<String, Object>> requiredCases = new ArrayList<Map<String, Object>>();
        for (ReleaseCheckCase c : check.getRequiredFailures()) requiredCases.add(requiredCaseEvidence(c));
        for (ReleaseCheckCase c : check.getRequiredUnexecuted()) requiredCases.add(requiredCaseEvidence(c));
        evidence.put("requiredCases", requiredCases);
        evidence.put("checkedAt", check.getCheckedAt() == null ? null : check.getCheckedAt().toString());
        return evidence;
    }

    private Map<String, Object> requiredCaseEvidence(ReleaseCheckCase c) {
        Map<String, Object> row = new LinkedHashMap<String, Object>();
        row.put("caseId", c.getCaseId());
        row.put("caseNo", c.getCaseNo());
        row.put("title", c.getTitle());
        row.put("demandTitle", c.getDemandTitle());
        row.put("result", Texts.trimToNull(c.getResult()) == null ? "untested" : c.getResult());
        return row;
    }

    /** 计划快照 = 计划本体 + 本次检查证据；无计划时也保留证据对象，历史口径一致 */
    private String planSnapshot(VersionReleasePlan plan, ReleaseCheckResponse check) {
        Map<String, Object> snapshot = new LinkedHashMap<String, Object>();
        if (plan != null) {
            Map<String, Object> body = json.convertValue(plan, new com.fasterxml.jackson.core.type.TypeReference<Map<String, Object>>() { });
            if (body != null) snapshot.putAll(body);
        }
        snapshot.put("testEvidence", testEvidence(check));
        return encode(snapshot);
    }

    /** 计划编辑器：只返回当前用户可管理的项目与版本，避免选出必然保存失败的组合。 */
    public ReleasePlanOptions planOptions(String userId, String workspaceId) {
        ReleasePlanOptions options = new ReleasePlanOptions();
        Map<String, ReleasePlanOptions.ProjectOption> projects = new LinkedHashMap<String, ReleasePlanOptions.ProjectOption>();
        Map<String, Boolean> manageable = new LinkedHashMap<String, Boolean>();
        for (ReleasePlanOptionRow row : mapper.selectPlanVersionOptions(workspaceId)) {
            Boolean manage = manageable.get(row.getReqId());
            if (manage == null) {
                manage = permissions.canManageRelease(userId, workspaceId, row.getReqId());
                manageable.put(row.getReqId(), manage);
            }
            if (!manage) continue;
            ReleasePlanOptions.ProjectOption project = projects.get(row.getReqId());
            if (project == null) {
                project = new ReleasePlanOptions.ProjectOption();
                project.setId(row.getReqId());
                project.setName(row.getProjectName());
                projects.put(row.getReqId(), project);
            }
            ReleasePlanOptions.VersionOption version = new ReleasePlanOptions.VersionOption();
            version.setId(row.getVersionId());
            version.setName(row.getVersionName());
            version.setStatus(row.getVersionStatus());
            version.setTargetDate(row.getTargetDate());
            project.getVersions().add(version);
        }
        options.getProjects().addAll(projects.values());
        return options;
    }

    /** 多版本计划的任务池：只返回所选版本已绑定的工作项，避免把其他版本任务混入计划。 */
    public List<Task> planTaskOptions(String userId, String workspaceId, List<String> versionIds) {
        List<String> ids = identities(versionIds, 32, "计划版本");
        if (ids.size() > 50) throw AppException.badRequest("一个计划最多包含 50 个版本");
        Map<String, String> projectNames = new HashMap<String, String>();
        for (String id : ids) {
            ProjectVersion version = requireVersion(userId, workspaceId, id);
            if (!projectNames.containsKey(version.getReqId())) {
                Requirement project = reqMapper.selectById(version.getReqId());
                if (project == null) throw AppException.notFound("项目不存在");
                projectNames.put(version.getReqId(), project.getName());
            }
        }
        List<Task> tasks = mapper.selectScopeForVersions(workspaceId, ids);
        versionTaskMapper.enrichTasks(workspaceId, tasks);
        taskPublication.enrichTasks(workspaceId, tasks);
        for (Task task : tasks) task.setReqName(projectNames.get(task.getReqId()));
        return tasks;
    }

    private List<PlanVersionRow> planVersions(String workspaceId, VersionReleasePlan plan) {
        List<PlanVersionRow> versions = mapper.selectPlanVersions(workspaceId, plan.getId());
        if (!versions.isEmpty() || Texts.trimToNull(plan.getVersionId()) == null) return versions;
        ProjectVersion version = versionMapper.selectById(plan.getVersionId());
        if (version == null) return versions;
        PlanVersionRow row = new PlanVersionRow();
        row.setVersionId(version.getId());
        row.setVersionName(version.getName());
        row.setReqId(version.getReqId());
        Requirement project = reqMapper.selectById(version.getReqId());
        row.setProjectName(project == null ? null : project.getName());
        row.setVersionStatus(version.getStatus());
        row.setTargetDate(version.getTargetDate());
        row.setReleased(Boolean.FALSE);
        versions.add(row);
        return versions;
    }

    /**
     * 计划跨项目，编号按空间取；并发新建撞 uk_plan_no 时重算重试（与其他编号同一口径）。
     * 只重试编号撞键：主键冲突是另一回事，不能并入同一段重试。
     * 取号走 number_seq（sql/87）：删除计划不回收编号。
     */
    private int insertPlanWithNo(VersionReleasePlan plan) {
        for (int attempt = 0; attempt < 3; attempt++) {
            plan.setPlanNo(numberSeq.nextPlan(plan.getWorkspaceId()));
            try {
                return mapper.insertPlan(plan);
            } catch (org.springframework.dao.DuplicateKeyException e) {
                String message = e.getMessage();
                if (message == null || !message.contains("uk_plan_no")) {
                    throw e;
                }
            }
        }
        throw AppException.badRequest("发布计划编号生成冲突，请重试");
    }

    private VersionReleasePlan hydratePlan(String workspaceId, VersionReleasePlan plan) {
        List<PlanVersionRow> versions = planVersions(workspaceId, plan);
        List<String> ids = new ArrayList<String>();
        int released = 0;
        for (PlanVersionRow row : versions) {
            ids.add(row.getVersionId());
            if (Boolean.TRUE.equals(row.getReleased())) released++;
        }
        plan.setVersions(versions);
        plan.setVersionIds(ids);
        plan.setVersionCount(ids.size());
        plan.setReleasedVersionCount(released);
        return plan;
    }

    /** 跨项目发布日程：只读汇总，可见范围与项目列表一致；不返回计划任务明细。 */
    public List<ReleasePlanRow> planSchedule(String userId, String workspaceId, String from, String to,
                                             String projectId, String environment, String status) {
        String reqId = Texts.trimToNull(projectId);
        if (reqId != null) access.assertView(workspaceId, userId, reqId);
        LocalDate fromDate = scheduleDate(from, "起始日期");
        LocalDate toDate = scheduleDate(to, "结束日期");
        if (fromDate != null && toDate != null && fromDate.isAfter(toDate)) {
            throw AppException.badRequest("起始日期不能晚于结束日期");
        }
        String env = Texts.trimToNull(environment);
        if (env != null && !Arrays.asList("production", "staging", "test").contains(env)) {
            throw AppException.badRequest("发布环境无效");
        }
        String viewerId = access.viewerScope(workspaceId, userId);
        List<ReleasePlanRow> rows = mapper.selectPlanSchedule(workspaceId, fromDate, toDate, reqId, env,
                scheduleStatuses(status), viewerId, 500);
        attachPlanReadiness(workspaceId, rows);
        return rows;
    }

    /**
     * 列表的就绪检查：按计划覆盖的每个版本跑真实检查，结论取最差、阻断与提醒数相加。
     * 只有「就绪 / 已完成」需要结论（草稿标未检查）；列表最多 500 行，超预算的行留空而不是拖慢整页。
     */
    private void attachPlanReadiness(String workspaceId, List<ReleasePlanRow> rows) {
        int budget = 200;
        for (int pass = 0; pass < 2; pass++) {
            for (ReleasePlanRow row : rows) {
                boolean wanted = pass == 0 ? "ready".equals(row.getStatus()) : "completed".equals(row.getStatus());
                if (!wanted) continue;
                List<PlanVersionRow> versions = new ArrayList<PlanVersionRow>(
                        mapper.selectPlanVersions(workspaceId, row.getId()));
                if (versions.isEmpty() && Texts.trimToNull(row.getVersionId()) != null) {
                    PlanVersionRow legacy = new PlanVersionRow();
                    legacy.setVersionId(row.getVersionId());
                    legacy.setReqId(row.getReqId());
                    legacy.setVersionStatus(row.getVersionStatus());
                    versions.add(legacy);
                }
                if (versions.isEmpty() || versions.size() > budget) continue;
                VersionReleasePlan plan = mapper.selectPlan(workspaceId, row.getId());
                if (plan == null) continue;
                plan.setPlannedTaskIds(mapper.selectPlannedTaskIds(workspaceId, row.getId()));
                budget -= versions.size();
                int blockers = 0, reminders = 0;
                boolean block = false, warn = false;
                for (PlanVersionRow versionRow : versions) {
                    ProjectVersion version = new ProjectVersion();
                    version.setId(versionRow.getVersionId());
                    version.setReqId(versionRow.getReqId());
                    version.setStatus(versionRow.getVersionStatus());
                    ReleaseCheckResponse check = evaluate(workspaceId, version, plan);
                    List<String> versionBlockers = check.getBlockers();
                    List<String> versionReminders = check.getReminders();
                    blockers += versionBlockers == null ? 0 : versionBlockers.size();
                    reminders += versionReminders == null ? 0 : versionReminders.size();
                    if ("block".equals(check.getVerdict())) block = true;
                    else if ("warn".equals(check.getVerdict())) warn = true;
                }
                row.setCheckBlockers(blockers);
                row.setCheckReminders(reminders);
                row.setCheckVerdict(block ? "block" : warn ? "warn" : "pass");
            }
        }
    }

    private LocalDate scheduleDate(String value, String label) {
        String text = Texts.trimToNull(value);
        if (text == null) return null;
        try {
            return LocalDate.parse(text);
        } catch (java.time.format.DateTimeParseException e) {
            throw AppException.badRequest(label + "格式应为 yyyy-MM-dd");
        }
    }

    /** open = 未完成（草稿 + 就绪）；all 或缺省 = 全部状态。 */
    private List<String> scheduleStatuses(String status) {
        String text = Texts.trimToNull(status);
        if (text == null || "all".equals(text)) return null;
        if ("open".equals(text)) return Arrays.asList("draft", "ready");
        if (!Arrays.asList("draft", "ready", "completed", "canceled").contains(text)) {
            throw AppException.badRequest("发布计划状态无效");
        }
        return Collections.singletonList(text);
    }

    private ProjectVersion lockVersion(String userId, String workspaceId, String id, String otherMember) {
        ProjectVersion initial = requireVersion(userId, workspaceId, id);
        permissions.assertManageRelease(userId, workspaceId, initial.getReqId());
        scopeLock.lockProjects(workspaceId, initial.getReqId());
        ProjectVersion current = requireVersionForUpdate(userId, workspaceId, id);
        if (!Objects.equals(initial.getReqId(), current.getReqId())) throw new AppException(409, "版本项目已变化");
        TreeSet<String> members = new TreeSet<String>();
        members.add(userId);
        if (Texts.trimToNull(otherMember) != null) members.add(otherMember);
        for (String member : members) {
            Map<String, Object> snapshot = memberMapper.selectDeliveryAccessForUpdate(workspaceId, member, null);
            if (member.equals(userId) && (snapshot == null || snapshot.get("role") == null)) throw AppException.badRequest("录入人必须是当前空间成员");
        }
        permissions.assertManageReleaseForUpdate(userId, workspaceId, current.getReqId());
        if (isEnded(current.getStatus())) {
            throw AppException.badRequest("已关闭或已取消的版本不能创建发布计划或记录发布");
        }
        return current;
    }

    private static boolean isEnded(String status) {
        return "closed".equals(status) || "canceled".equals(status);
    }

    @Transactional
    public VersionReleasePlan savePlan(String userId, String workspaceId, String versionId, ReleasePlanRequest request) {
        String owner = Texts.trimToNull(request.getOwnerUserId());
        VersionReleasePlan old = null;
        if (Texts.trimToNull(request.getId()) != null) {
            old = mapper.selectPlanForUpdate(workspaceId, request.getId());
            if (old == null || !planVersions(workspaceId, old).stream()
                    .anyMatch(row -> versionId.equals(row.getVersionId())))
                throw AppException.notFound("发布计划不存在");
            old.setPlannedTaskIds(mapper.selectPlannedTaskIdsForUpdate(workspaceId, old.getId()));
            if (!Objects.equals(old.getRevision(), request.getRevision()) || "completed".equals(old.getStatus()))
                throw new AppException(409, "计划已变化或已完成，请新建计划而非覆盖");
            /* 通知关注者前需要旧范围的版本 ID；hydrate 只补展示字段，不影响写入 */
            hydratePlan(workspaceId, old);
        }
        List<String> requestedVersions = request.getVersionIds() == null || request.getVersionIds().isEmpty()
                ? Collections.emptyList() : identities(request.getVersionIds(), 32, "计划版本");
        if (requestedVersions.size() > 50) throw AppException.badRequest("一个计划最多包含 50 个版本");
        List<ProjectVersion> versions = lockPlanVersions(userId, workspaceId, versionId, requestedVersions, old);
        List<String> versionIds = new ArrayList<String>();
        for (ProjectVersion version : versions) versionIds.add(version.getId());
        if (owner != null) {
            Map<String, Object> membership = memberMapper.selectDeliveryAccessForUpdate(workspaceId, owner, null);
            if (membership == null || membership.get("role") == null) throw AppException.badRequest("计划负责人必须是当前空间成员");
        }
        List<String> ids = identities(request.getPlannedTaskIds(), 32, "计划任务");
        List<String> targets = identities(request.getTargetKeys(), 128, "发布目标");
        dimensions(request.getEnvironment(), request.getCoverage(), targets);
        Map<String, Task> scope = new TreeMap<String, Task>();
        for (Task task : mapper.selectScopeForVersions(workspaceId, versionIds)) scope.put(task.getId(), task);
        if (!scope.keySet().containsAll(ids)) throw AppException.badRequest("计划任务必须属于计划包含的版本范围");
        String status = request.getStatus();
        if (!"draft".equals(status) && !"ready".equals(status) && !"canceled".equals(status)) {
            throw AppException.badRequest("请选择草稿、就绪或已取消状态");
        }
        if ("ready".equals(status) && (request.getPlannedAt() == null || owner == null || ids.isEmpty())) {
            throw AppException.badRequest("就绪计划必须填写时间、负责人及任务范围");
        }
        String reason = Texts.trimToNull(request.getReason());
        if ((old != null && "ready".equals(old.getStatus()) || "canceled".equals(status)) && reason == null) {
            throw AppException.badRequest("调整就绪计划或取消计划必须填写原因");
        }
        String primaryVersion = old != null && versionIds.contains(old.getVersionId()) ? old.getVersionId() : versionIds.get(0);
        VersionReleasePlan next = new VersionReleasePlan();
        next.setId(old == null ? Ids.gen("RP") : old.getId());
        next.setWorkspaceId(workspaceId);
        next.setVersionId(primaryVersion);
        next.setVersionIds(versionIds);
        next.setName(Texts.trimToNull(request.getName()));
        next.setPlannedAt(request.getPlannedAt());
        next.setOwnerUserId(owner);
        next.setNotes(Texts.trimToNull(request.getNotes()));
        next.setRisks(Texts.trimToNull(request.getRisks()));
        next.setStatus(status);
        next.setRevision(old == null ? 0L : old.getRevision());
        next.setEnvironment(request.getEnvironment());
        next.setTargetKeys(targets);
        next.setCoverage(request.getCoverage());
        next.setPlannedTaskIds(ids);
        next.setScopeToken(digest(encode(Arrays.asList(versionIds, ids, targets, next.getEnvironment(), next.getCoverage()))));
        int rows = old == null ? insertPlanWithNo(next) : mapper.updatePlan(next);
        if (rows != 1) {
            throw new AppException(409, "发布计划已被其他人修改");
        }
        if (old != null) {
            mapper.deletePlanTasks(workspaceId, next.getId());
            mapper.deletePlanVersions(workspaceId, next.getId());
        }
        for (ProjectVersion version : versions) {
            if (mapper.insertPlanVersion(workspaceId, next.getId(), version.getId(), version.getReqId()) != 1)
                throw new AppException(409, "计划版本写入冲突");
        }
        for (String id : ids) if (mapper.insertPlanTask(workspaceId, next.getId(), id) != 1) throw new AppException(409, "计划范围写入冲突");
        if (old != null && !Objects.equals(old.getPlannedAt(), next.getPlannedAt())) {
            releasePrep.resetMilestones(workspaceId, next.getId());
        }
        VersionReleasePlan saved = mapper.selectPlanForUpdate(workspaceId, next.getId());
        saved.setPlannedTaskIds(mapper.selectPlannedTaskIdsForUpdate(workspaceId, saved.getId()));
        hydratePlan(workspaceId, saved);
        for (String id : versionIds) log(userId, workspaceId, id, "release_plan", reason, old, saved);
        /* 关注者只收「计划发生了什么」；发送失败不影响保存结果 */
        try {
            releasePrep.notifyPlanChanged(userId, workspaceId, old, saved);
        } catch (Exception e) {
            log.warn("发布计划关注通知失败（不影响保存）：workspace={} plan={}", workspaceId, saved.getId(), e);
        }
        return saved;
    }

    /** 锁定计划涉及的全部项目与版本；任一项目无管理权限即拒绝，避免跨项目越权写入。 */
    private List<ProjectVersion> lockPlanVersions(String userId, String workspaceId, String anchorId,
                                                  List<String> requested, VersionReleasePlan old) {
        List<String> ids = new ArrayList<String>(requested);
        if (ids.isEmpty()) {
            if (old == null) {
                ids.add(anchorId);
            } else {
                for (PlanVersionRow row : planVersions(workspaceId, old)) ids.add(row.getVersionId());
                if (ids.isEmpty()) ids.add(old.getVersionId());
            }
        }
        if (!ids.contains(anchorId)) throw AppException.badRequest("当前版本必须包含在计划中");
        /* 已发布版本不能新加入计划；已在计划内的保留，避免编辑其他字段时被历史数据卡住 */
        Set<String> existingVersionIds = new HashSet<String>();
        if (old != null) {
            for (PlanVersionRow row : planVersions(workspaceId, old)) existingVersionIds.add(row.getVersionId());
        }
        Map<String, ProjectVersion> initial = new TreeMap<String, ProjectVersion>();
        for (String id : ids) initial.put(id, requireVersion(userId, workspaceId, id));
        SortedSet<String> projectIds = new TreeSet<String>();
        for (ProjectVersion version : initial.values()) {
            projectIds.add(version.getReqId());
            permissions.assertManageRelease(userId, workspaceId, version.getReqId());
        }
        scopeLock.lockProjects(workspaceId, projectIds.toArray(new String[0]));
        List<ProjectVersion> versions = new ArrayList<ProjectVersion>();
        for (ProjectVersion before : initial.values()) {
            ProjectVersion version = versionMapper.selectByIdForUpdate(workspaceId, before.getId());
            if (version == null || !Objects.equals(version.getReqId(), before.getReqId()))
                throw new AppException(409, "版本项目已变化");
            if (isEnded(version.getStatus())) {
                throw AppException.badRequest("已关闭或已取消的版本不能加入发布计划：" + version.getName());
            }
            if ("released".equals(version.getStatus()) && !existingVersionIds.contains(version.getId())) {
                throw AppException.badRequest("已发布的版本不能新加入发布计划：" + version.getName());
            }
            permissions.assertManageReleaseForUpdate(userId, workspaceId, version.getReqId());
            versions.add(version);
        }
        return versions;
    }

    @Transactional
    public ReleasePreviewResponse preview(String userId, String workspaceId, String versionId, ReleasePreviewRequest request) {
        validate(request);
        ProjectVersion version = lockVersion(userId, workspaceId, versionId, request.getExecutorUserId());
        Context c = context(workspaceId, version, request);
        ReleasePreviewResponse response = new ReleasePreviewResponse();
        response.setVersionId(versionId);
        response.setPlanId(request.getPlanId());
        response.setPlanRevision(c.plan == null ? null : c.plan.getRevision());
        response.setOccurredAt(request.getOccurredAt());
        response.setPublishedOn(request.getOccurredAt().toLocalDate());
        response.setEnvironment(request.getEnvironment()); response.setTargetKeys(request.getTargetKeys()); response.setCoverage(request.getCoverage());
        response.setActualTaskIds(request.getActualTaskIds());
        /* 多版本计划只在当前版本的预检里展示本版本的计划任务，其他版本由各自记录核对。 */
        List<String> scopedPlanned = new ArrayList<String>();
        if (c.plan != null) {
            Set<String> scopeIds = new HashSet<String>();
            for (Task task : c.scope) scopeIds.add(task.getId());
            for (String taskId : c.plan.getPlannedTaskIds()) if (scopeIds.contains(taskId)) scopedPlanned.add(taskId);
        }
        response.setPlannedTaskIds(scopedPlanned);
        response.setCandidates(new ArrayList<Task>(c.actual.values()));
        for (String id : c.omitted) {
            response.getExcluded().add(new ReleasePreviewResponse.ExcludedTask(c.planned.get(id),
                    request.getDeviationReason() != null ? request.getDeviationReason() : "本次实际范围未选择"));
        }
        response.setWarnings(c.warnings);
        response.setRequiresDeviationReason(!c.warnings.isEmpty());
        ReleaseCheckResponse testCheck = evaluate(workspaceId, version, c.plan);
        response.setTestCheck(testCheck);
        boolean testBlocked = "block".equals(testCheck.getVerdict());
        response.setCanPublish(!request.getActualTaskIds().isEmpty()
                && (c.warnings.isEmpty() || request.getDeviationReason() != null)
                && (!testBlocked || request.getDeviationReason() != null));
        response.setScopeToken(token(version, c, request));
        return response;
    }

    @Transactional
    public VersionRelease confirm(String userId, String workspaceId, String versionId, ReleaseConfirmRequest request) {
        validate(request);
        if (!Arrays.asList("success", "failed").contains(request.getResult())) throw AppException.badRequest("发布结果无效");
        if (Texts.trimToNull(request.getIdempotencyKey()) == null || request.getIdempotencyKey().length() > 64
                || request.getScopeToken() == null || !request.getScopeToken().matches("[a-f0-9]{64}")
                || (request.getPlanId() != null && request.getPlanRevision() == null)) throw AppException.badRequest("请提交完整预览信息");
        ProjectVersion version = lockVersion(userId, workspaceId, versionId, request.getExecutorUserId());
        // Replay precedes all readiness and scope checks; current recorder authorization still applies.
        String hash = digest(encode(Arrays.asList(userId, versionId, request)));
        VersionRelease repeated = mapper.selectByKeyForUpdate(workspaceId, versionId, request.getIdempotencyKey());
        if (repeated != null) {
            if (!hash.equals(repeated.getRequestHash())) {
                throw new AppException(409, "重复提交标识已用于不同的发布内容");
            }
            repeated.setItems(mapper.selectItemsForUpdate(workspaceId, repeated.getId()));
            return repeated;
        }
        Context c = context(workspaceId, version, request);
        if ((c.plan != null && !Objects.equals(c.plan.getRevision(), request.getPlanRevision()))
                || !token(version, c, request).equals(request.getScopeToken())) throw new AppException(409, "确认上下文已变化，请重新预览");
        boolean success = "success".equals(request.getResult());
        if (c.scopeDeviation && request.getDeviationReason() == null) throw new AppException(422, "计划或任务版本偏离必须说明原因");
        if (success && request.getActualTaskIds().isEmpty()) throw new AppException(422, "成功记录必须明确选择实际任务");
        if (success && !c.warnings.isEmpty() && request.getDeviationReason() == null) throw new AppException(422, "异常事实必须填写「未按计划发布的原因」");
        /* 发布检查阻断项不禁止记录事实，但必须留下未按计划发布的原因；结论随记录冻结 */
        ReleaseCheckResponse testCheck = evaluate(workspaceId, version, c.plan);
        if (success && "block".equals(testCheck.getVerdict()) && request.getDeviationReason() == null) {
            throw new AppException(422, "发布检查存在阻断项，请填写「未按计划发布的原因」后再确认");
        }
        String failure = Texts.trimToNull(request.getFailureReason());
        if (!success && failure == null) throw AppException.badRequest("失败记录必须说明原因");
        AppUser actor = userMapper.selectById(userId);
        VersionRelease record = new VersionRelease();
        record.setId(Ids.gen("RL"));
        record.setWorkspaceId(workspaceId);
        record.setReqId(version.getReqId());
        record.setVersionId(versionId);
        record.setPlanId(c.plan == null ? null : c.plan.getId());
        record.setPlanRevision(c.plan == null ? null : c.plan.getRevision());
        record.setResult(request.getResult());
        record.setOccurredAt(request.getOccurredAt().toLocalDateTime());
        record.setPublishedOn(record.getOccurredAt().toLocalDate());
        record.setRecordedAt(LocalDateTime.now(ZoneOffset.UTC).truncatedTo(ChronoUnit.MICROS));
        record.setEnvironment(request.getEnvironment()); record.setTargetKeys(request.getTargetKeys()); record.setCoverage(request.getCoverage());
        record.setArtifactRef(request.getArtifactRef()); record.setArtifactDigest(request.getArtifactDigest()); record.setOperation(request.getOperation());
        record.setRelatedReleaseId(request.getRelatedReleaseId()); record.setExecutorUserId(request.getExecutorUserId()); record.setExecutorName(c.executor.getDisplayName());
        record.setDeviationReason(request.getDeviationReason());
        record.setReleasedBy(userId);
        record.setReleasedByName(actor == null ? userId : actor.getDisplayName());
        record.setVersionName(version.getName());
        record.setProjectName(c.project.getName());
        record.setNotes(Texts.trimToNull(request.getNotes()));
        record.setFailureReason(success ? null : failure);
        record.setPublishedCount(success && !"rollback".equals(request.getOperation()) ? request.getActualTaskIds().size() : 0);
        record.setExcludedCount(c.omitted.size());
        record.setIdempotencyKey(request.getIdempotencyKey());
        record.setRequestHash(hash);
        record.setPlanSnapshot(planSnapshot(c.plan, testCheck));
        insertRecordWithNo(record);
        Map<String, Integer> counts = new LinkedHashMap<String, Integer>();
        for (String id : request.getActualTaskIds()) {
            Task task = c.actual.get(id);
            VersionReleaseItem item = "rollback".equals(request.getOperation()) ? copy(c.relatedItems.get(id), record)
                    : snapshot(record, task, (task.getDemandId() == null ? null : c.demands.get(task.getDemandId())), "candidate");
            item.setDisposition(success ? ("rollback".equals(request.getOperation()) ? "rolled_back" : "published") : "candidate");
            item.setReason(request.getDeviationReason());
            insertItem(record, item);
            /* 只有成功且非回滚才是发布事实：失败记录与回滚不往工作项动态里写「已发布」 */
            if (success && !"rollback".equals(request.getOperation()) && task != null) {
                writeReleaseTaskLog(record, task, userId);
            }
            if (task != null && task.getOwnerUserId() != null && !userId.equals(task.getOwnerUserId()))
                counts.put(task.getOwnerUserId(), counts.getOrDefault(task.getOwnerUserId(), 0) + 1);
        }
        for (String id : c.omitted) {
            Task task = c.planned.get(id);
            VersionReleaseItem item = snapshot(record, task, (task.getDemandId() == null ? null : c.demands.get(task.getDemandId())), "not_selected");
            item.setReason(request.getDeviationReason() != null ? request.getDeviationReason() : Objects.toString(failure, "本次实际范围未选择"));
            insertItem(record, item);
        }
        /* 多版本计划只有全部包含版本都完成成功的生产部署/重部署才收口；测试、预发、回滚与部分成功不完成计划。
           已取消的计划保持取消：发布事实照常记录，只补一条「已取消计划发生发布」提醒，不把状态改回完成。 */
        if (success && c.plan != null && "production".equals(record.getEnvironment())
                && !"rollback".equals(request.getOperation())) {
            int total = mapper.countPlanVersions(workspaceId, c.plan.getId());
            /* 没有版本关联行的历史计划按单版本处理，本次成功记录即视为全部完成。 */
            int released = total == 0 ? 1 : mapper.countPlanVersionsReleased(workspaceId, c.plan.getId());
            if (released >= Math.max(total, 1)) {
                String planStatus = c.plan.getStatus();
                if ("canceled".equals(planStatus)) {
                    releasePrep.notifyCanceledPlanReleased(userId, workspaceId, c.plan);
                } else if (!"completed".equals(planStatus)
                        && mapper.completePlan(workspaceId, c.plan.getId(), c.plan.getRevision()) != 1) {
                    throw new AppException(409, "计划状态写入冲突");
                }
            }
        }
        log(userId, workspaceId, versionId, "rollback".equals(request.getOperation()) ? "release_rollback" : success ? "release_success" : "release_failed",
                request.getDeviationReason() != null ? request.getDeviationReason() : success ? request.getNotes() : failure, null, record);
        /* 成功生产发布 / 回滚改变交付证据：同一事务内重新判定受影响需求，完成 ≠ 交付 */
        if (success && "production".equals(record.getEnvironment())) {
            java.util.LinkedHashSet<String> affected = new java.util.LinkedHashSet<String>();
            for (Task task : c.actual.values()) {
                if (task.getDemandId() != null) affected.add(task.getDemandId());
            }
            if ("rollback".equals(request.getOperation())) {
                /* 工作项可能已换需求：回滚同时按原发布条目快照的需求回判 */
                for (String taskId : request.getActualTaskIds()) {
                    VersionReleaseItem item = c.relatedItems.get(taskId);
                    if (item != null && item.getDemandId() != null) affected.add(item.getDemandId());
                }
            }
            demandCompletion.refreshCompletion(workspaceId, affected);
        }
        if (success && "production".equals(record.getEnvironment()) && !"rollback".equals(record.getOperation())) {
            /* 规则关闭只影响打扰，不影响发布事实与需求判定 */
            if (automation == null || automation.enabled(workspaceId, AutomationSettingsService.RELEASE_NOTIFY))
                scheduleNotifications(workspaceId, userId, version, counts);
            if (reports != null)
                reports.scheduleVersionReport(workspaceId, record.getVersionId(), record.getVersionName(),
                        record.getProjectName(), record.getReqId(), record.getPublishedCount());
        }
        VersionRelease saved = mapper.selectByKeyForUpdate(workspaceId, versionId, request.getIdempotencyKey());
        saved.setItems(mapper.selectItemsForUpdate(workspaceId, saved.getId()));
        return saved;
    }

    public List<VersionRelease> records(String userId, String workspaceId, String versionId) {
        requireVersion(userId, workspaceId, versionId);
        return records(userId, workspaceId, versionId, null);
    }

    public List<VersionRelease> records(String userId, String workspaceId, String versionId, String key) {
        requireVersion(userId, workspaceId, versionId);
        VersionRelease found = key == null ? null : mapper.selectByKey(workspaceId, versionId, key);
        List<VersionRelease> records = key == null ? mapper.selectRecords(workspaceId, versionId)
                : found == null ? Collections.emptyList() : Collections.singletonList(found);
        for (VersionRelease record : records) {
            record.setItems(mapper.selectItems(workspaceId, record.getId()));
            if (record.getRelatedReleaseId() != null) {
                record.setRelatedReleaseNo(mapper.selectReleaseNo(workspaceId, record.getRelatedReleaseId()));
            }
        }
        return records;
    }

    public List<Map<String, Object>> history(String userId, String workspaceId, String versionId) {
        requireVersion(userId, workspaceId, versionId);
        return mapper.selectLogs(workspaceId, versionId);
    }

    public void log(String userId, String workspaceId, String versionId, String action, String reason, Object before, Object after) {
        Map<String, Object> change = new LinkedHashMap<String, Object>();
        change.put("before", before);
        change.put("after", after);
        if (mapper.insertLog(workspaceId, versionId, action, userId, Texts.cut(Texts.trimToNull(reason), 500), encode(change)) != 1) {
            throw new AppException(409, "发布审计写入冲突");
        }
    }

    public void logTaskVersionChange(String userId, String workspaceId, Task task, String versionId,
                                     String versionName, String reason) {
        Map<String, Object> before = new LinkedHashMap<String, Object>();
        before.put("versionIds", task.getVersionIds());
        before.put("versionNames", task.getVersionNames());
        Map<String, Object> after = new LinkedHashMap<String, Object>();
        after.put("versionIds", versionId == null ? Collections.emptyList() : Collections.singletonList(versionId));
        after.put("versionNames", versionName == null ? Collections.emptyList() : Collections.singletonList(versionName));
        Map<String, Object> change = new LinkedHashMap<String, Object>();
        change.put("before", before);
        change.put("after", after);
        change.put("reason", reason);
        mapper.insertTaskChangeLog(workspaceId, task.getId(), userId,
                Texts.cut("计划交付版本：" + Objects.toString(task.getVersionNames(), "无") + " → "
                        + Objects.toString(versionName, "无") + "；" + inline(reason), 255), encode(change));
    }

    /** 工作项动态是单行摘要；理由里的换行折叠成「；」，change_data 里仍留原文。 */
    private static String inline(String value) {
        return value == null ? null : value.replaceAll("\\s*[\\r\\n]+\\s*", "；");
    }

    /**
     * 分配项目内编号后写入发布记录（sql/82）。并发确认会抢到同一个号，由 uk_release_no 拒绝后重算重试；
     * 失败的 INSERT 不会让 InnoDB 事务失效。幂等键撞键是另一回事，直接抛出，不伪装成编号冲突。
     */
    /** 工作项动态的发布节点：文案给人看，change_data 留发布记录的结构化证据（可回查 REL 编号）。 */
    private void writeReleaseTaskLog(VersionRelease record, Task task, String userId) {
        Map<String, Object> change = new LinkedHashMap<String, Object>();
        change.put("releaseId", record.getId());
        change.put("releaseNo", record.getReleaseNo());
        change.put("versionId", record.getVersionId());
        change.put("versionName", record.getVersionName());
        change.put("environment", record.getEnvironment());
        change.put("operation", record.getOperation());
        change.put("occurredAt", record.getOccurredAt() == null ? null : record.getOccurredAt().atOffset(ZoneOffset.UTC).toString());
        change.put("executorUserId", record.getExecutorUserId());
        change.put("executorName", record.getExecutorName());
        TaskLog entry = new TaskLog();
        entry.setWorkspaceId(record.getWorkspaceId());
        entry.setTaskId(task.getId());
        entry.setActorId(userId);
        entry.setAction("release");
        entry.setDetail(Texts.cut("随版本「" + record.getVersionName() + "」发布到" + environmentName(record.getEnvironment())
                + " · 发布时间 " + releaseMinuteText(record.getOccurredAt())
                + " · 执行人 " + record.getExecutorName(), 255));
        entry.setChangeData(encode(change));
        taskLogMapper.insert(entry);
    }

    private static String environmentName(String environment) {
        if ("production".equals(environment)) {
            return "生产";
        }
        if ("staging".equals(environment)) {
            return "预发布";
        }
        if ("test".equals(environment)) {
            return "测试";
        }
        return environment == null ? "未记录环境" : environment;
    }

    /* occurredAt 存的是 UTC：动态文案按服务器时区还原到本地分钟，与页面显示一致 */
    private static String releaseMinuteText(LocalDateTime utc) {
        return utc == null ? "未记录"
                : utc.atOffset(ZoneOffset.UTC).atZoneSameInstant(ZoneId.systemDefault()).format(MINUTE);
    }

    private void insertRecordWithNo(VersionRelease record) {
        for (int attempt = 0; attempt < 3; attempt++) {
            record.setReleaseNo(mapper.selectNextReleaseNo(record.getWorkspaceId(), record.getReqId()));
            try {
                if (mapper.insertRecord(record) != 1) throw new AppException(409, "发布记录写入冲突");
                return;
            } catch (org.springframework.dao.DuplicateKeyException e) {
                String message = e.getMessage();
                if (message == null || !message.contains("uk_release_no")) throw e;
                log.warn("发布记录编号并发冲突，重试第 {} 次：project={}", attempt + 2, record.getReqId());
            }
        }
        throw AppException.badRequest("发布记录编号生成冲突，请重试");
    }

    private VersionReleaseItem snapshot(VersionRelease record, Task task, Demand demand, String disposition) {
        VersionReleaseItem item = new VersionReleaseItem();
        item.setWorkspaceId(record.getWorkspaceId());
        item.setReleaseId(record.getId());
        item.setTaskId(task.getId());
        /* 编号在记录当时定格：工作项之后换项目会重新取号，历史证据不跟着变（sql/83） */
        item.setTaskItemNo(task.getItemNo());
        item.setTitle(task.getTitle());
        item.setItemType(task.getItemType());
        item.setOwnerUserId(task.getOwnerUserId());
        item.setOwnerName(task.getOwner());
        item.setDemandId(task.getDemandId());
        if (demand != null) {
            item.setDemandNo(demand.getDemandNo());
            item.setDemandTitle(demand.getTitle());
            item.setTargetVersionId(demand.getVersionId());
            item.setTargetVersionName(demand.getVersionName());
        }
        item.setBoardColumn(task.getBoardColumn());
        item.setCompletedAt(task.getCompletedAt());
        item.setDisposition(disposition);
        item.setWorkMinutes(task.getTotalMinutes() == null ? 0 : task.getTotalMinutes());
        item.setEstimateMinutes(task.getEstimateMinutes());
        item.setContentSummary(Texts.cut(Texts.trimToNull(task.getDescription()), 2000));
        return item;
    }

    private void insertItem(VersionRelease record, VersionReleaseItem item) {
        if (mapper.insertItem(item) != 1) throw new AppException(409, "发布快照写入冲突");
        record.getItems().add(item);
    }

    private VersionReleaseItem copy(VersionReleaseItem source, VersionRelease record) {
        VersionReleaseItem item = json.convertValue(source, VersionReleaseItem.class);
        item.setId(null); item.setWorkspaceId(record.getWorkspaceId()); item.setReleaseId(record.getId());
        return item;
    }

    private static class Context {
        VersionReleasePlan plan;
        ProjectVersion plannedVersion;
        List<Task> plannedScope;
        Requirement project;
        AppUser executor;
        VersionRelease related;
        Map<String, Task> actual = new TreeMap<String, Task>();
        Map<String, Task> planned = new TreeMap<String, Task>();
        Map<String, Demand> demands = new TreeMap<String, Demand>();
        Map<String, VersionReleaseItem> relatedItems = new TreeMap<String, VersionReleaseItem>();
        List<String> omitted = new ArrayList<String>();
        List<String> warnings = new ArrayList<String>();
        List<Task> scope;
        boolean scopeDeviation;
    }

    private Context context(String workspaceId, ProjectVersion version, ReleasePreviewRequest r) {
        Context c = new Context();
        c.project = mapper.selectProjectForUpdate(workspaceId, version.getReqId());
        if (c.project == null) throw AppException.notFound("项目不存在");
        Map<String, Object> membership = memberMapper.selectDeliveryAccessForUpdate(workspaceId, r.getExecutorUserId(), null);
        if (membership == null || membership.get("role") == null) throw AppException.badRequest("实际执行人必须是当前空间成员");
        c.executor = userMapper.selectById(r.getExecutorUserId());
        if (c.executor == null) throw AppException.badRequest("实际执行人不存在");
        if (Boolean.TRUE.equals(c.executor.getDisabled())) throw AppException.badRequest("实际执行人已停用");
        Map<String, Task> scope = taskMap(mapper.selectScope(workspaceId, version.getId()));
        c.scope = new ArrayList<Task>(scope.values());
        if (r.getPlanId() != null) {
            c.plan = mapper.selectPlanForUpdate(workspaceId, r.getPlanId());
            if (c.plan == null) throw AppException.notFound("发布计划不存在");
            hydratePlan(workspaceId, c.plan);
            List<String> planVersionIds = c.plan.getVersionIds();
            if (planVersionIds.isEmpty()) planVersionIds = Collections.singletonList(c.plan.getVersionId());
            if (!planVersionIds.contains(version.getId()))
                throw AppException.badRequest("实际版本必须属于计划包含的版本");
            if ("completed".equals(c.plan.getStatus())) throw new AppException(409, "完成计划不可复用，请新建计划或紧急记录");
            c.plannedVersion = version;
            c.plan.setPlannedTaskIds(mapper.selectPlannedTaskIdsForUpdate(workspaceId, c.plan.getId()));
            TreeSet<String> planProjects = new TreeSet<String>();
            for (PlanVersionRow row : c.plan.getVersions()) planProjects.add(row.getReqId());
            Map<String, Task> plannedScope = taskMap(mapper.selectScopeForVersions(workspaceId, planVersionIds));
            plannedScope.putAll(scope);
            c.plannedScope = new ArrayList<Task>(plannedScope.values());
            for (String id : c.plan.getPlannedTaskIds()) {
                Task task = plannedScope.get(id);
                if (task == null) task = mapper.selectTaskForUpdate(workspaceId, id);
                if (task == null || !workspaceId.equals(task.getWorkspaceId()) || !planProjects.contains(task.getReqId()))
                    throw new AppException(409, "计划任务身份或项目已变化");
                c.planned.put(id, task);
            }
            if (!"ready".equals(c.plan.getStatus())) c.warnings.add("计划非就绪状态，受控记录已发生事实");
            if (!Objects.equals(c.plan.getEnvironment(), r.getEnvironment()) || !Objects.equals(c.plan.getCoverage(), r.getCoverage())
                    || !new HashSet<String>(c.plan.getTargetKeys()).equals(new HashSet<String>(r.getTargetKeys()))) c.warnings.add("实际环境或目标范围偏离计划");
        }
        for (Demand demand : mapper.selectDemandsByProjectForUpdate(workspaceId, version.getReqId())) c.demands.put(demand.getId(), demand);
        /* 存量跨项目关联（sql/106 口径 7）：任务的需求可能属于其他项目，
           快照仍要留下需求编号与标题；按空间批量补齐，只读展示，不改关联本身 */
        List<String> legacyDemandIds = new ArrayList<String>();
        List<Task> demandRefTasks = new ArrayList<Task>(c.scope);
        if (c.plannedScope != null) demandRefTasks.addAll(c.plannedScope);
        demandRefTasks.addAll(c.planned.values());
        for (Task task : demandRefTasks) {
            String demandId = Texts.trimToNull(task.getDemandId());
            if (demandId != null && !c.demands.containsKey(demandId) && !legacyDemandIds.contains(demandId))
                legacyDemandIds.add(demandId);
        }
        if (!legacyDemandIds.isEmpty()) {
            for (Demand demand : demandMapper.selectByIds(workspaceId, legacyDemandIds)) {
                if (demand != null && demand.getId() != null) c.demands.put(demand.getId(), demand);
            }
            log.debug("发布快照回填跨项目关联需求：version={} 需求数={}", version.getId(), legacyDemandIds.size());
        }
        if (r.getRelatedReleaseId() != null) {
            c.related = mapper.selectRecordForUpdate(workspaceId, r.getRelatedReleaseId());
            if (c.related == null || !version.getReqId().equals(c.related.getReqId())) throw AppException.badRequest("关联事件必须属于同一项目");
            c.related.setItems(mapper.selectItemsForUpdate(workspaceId, c.related.getId()));
            for (VersionReleaseItem item : c.related.getItems()) if ("published".equals(item.getDisposition())) c.relatedItems.put(item.getTaskId(), item);
            if (c.related.getOccurredAt().isAfter(r.getOccurredAt().toLocalDateTime())) throw AppException.badRequest("关联事件不能晚于本次实际时间");
        }
        validateRelation(version, r, c);
        for (String id : r.getActualTaskIds()) {
            Task task = scope.get(id);
            if ("rollback".equals(r.getOperation())) {
                if (!c.relatedItems.containsKey(id)) throw AppException.badRequest("回滚任务必须是关联成功事件的实际任务子集");
                task = mapper.selectTaskForUpdate(workspaceId, id);
                if (task != null && version.getReqId().equals(task.getReqId())) c.actual.put(id, task);
                continue;
            }
            if (task == null) throw AppException.badRequest("实际任务不存在或不在当前版本范围");
            if (!workspaceId.equals(task.getWorkspaceId()) || !version.getReqId().equals(task.getReqId())) throw AppException.badRequest("实际任务必须属于同一空间及项目");
            c.actual.put(id, task);
            if (c.plan != null && !c.planned.containsKey(id)) c.warnings.add("任务 " + id + " 不在计划范围");
            /* occurredAt 存的是 UTC：完成日是本地日，比较前先换算到同一时区，否则跨零点会误报完成日晚于实际时间 */
            if (!Consts.COL_DONE.equals(task.getBoardColumn()) || task.getCompletedAt() == null || task.getCompletedAt().toLocalDate().isAfter(r.getOccurredAt().atZoneSameInstant(ZoneId.systemDefault()).toLocalDate()))
                c.warnings.add("任务 " + id + " 未完成或完成日晚于实际时间");
            Demand demand = (task.getDemandId() == null ? null : c.demands.get(task.getDemandId()));
            /* 存量跨项目关联（sql/106 口径 7）只读保留：目标版本属于需求原项目，
               不拿本版本对比，否则每次发布都会被强制填写偏离原因 */
            if (demand != null && version.getReqId().equals(demand.getReqId())
                    && (("closed".equals(demand.getStatus()) || "canceled".equals(demand.getStatus()))
                    || !Objects.equals(version.getId(), demand.getVersionId()))) c.warnings.add("任务 " + id + " 的需求已关闭或目标版本不同");
        }
        if (c.plan != null) {
            c.omitted.addAll(c.plan.getPlannedTaskIds());
            /* 多版本计划：本次实际记录只对比当前版本的计划任务，其他版本在其自己的记录中核对。 */
            c.omitted.retainAll(scope.keySet());
            c.omitted.removeAll(r.getActualTaskIds());
            if (!c.omitted.isEmpty()) c.warnings.add("部分计划任务未包含在本次实际交付");
        }
        if ("production".equals(r.getEnvironment()) && !"rollback".equals(r.getOperation())) {
            Set<String> targets = new HashSet<String>(r.getTargetKeys());
            for (VersionRelease prior : mapper.selectRecordsForUpdate(workspaceId, version.getId())) {
                if (!"success".equals(prior.getResult()) || !"production".equals(prior.getEnvironment())
                        || "rollback".equals(prior.getOperation())) continue;
                if (!Objects.equals(prior.getArtifactDigest(), r.getArtifactDigest()) || !Objects.equals(prior.getArtifactRef(), r.getArtifactRef()))
                    throw new AppException(409, "已有成功生产事件的产物不可更换，补丁请使用新版本");
                /* 同一计划、同一产物、同一目标集合的「部署」不是新事实：重复提交会虚增发布次数。
                   重新部署用 redeploy，回滚后恢复也用 redeploy，均不受此限。 */
                if ("deploy".equals(r.getOperation()) && Objects.equals(prior.getPlanId(), r.getPlanId())
                        && new HashSet<String>(prior.getTargetKeys()).equals(targets)) {
                    Integer releaseNo = mapper.selectReleaseNo(workspaceId, prior.getId());
                    throw new AppException(409, "已有相同的成功生产事件"
                            + (releaseNo == null ? "" : "（记录 REL-" + (releaseNo < 100 ? (releaseNo < 10 ? "00" : "0") : "") + releaseNo + "）")
                            + "，请勿重复记录；如需重新部署请使用「重部署」");
                }
            }
        }
        List<Task> tokenTasks = new ArrayList<Task>(c.scope);
        if (c.plannedScope != null) tokenTasks.addAll(c.plannedScope);
        tokenTasks.addAll(c.planned.values());
        tokenTasks.addAll(c.actual.values());
        populateTaskVersions(workspaceId, tokenTasks);
        return c;
    }

    /** Hydrate every locked task instance from the same batched current binding reads. */
    private void populateTaskVersions(String workspaceId, List<Task> tasks) {
        Map<String, List<Task>> byId = new TreeMap<String, List<Task>>();
        for (Task task : tasks) byId.computeIfAbsent(task.getId(), id -> new ArrayList<Task>()).add(task);
        List<String> ids = new ArrayList<String>(byId.keySet());
        for (int start = 0; start < ids.size(); start += 500) {
            List<String> batch = ids.subList(start, Math.min(start + 500, ids.size()));
            Map<String, Map<String, String>> versions = new HashMap<String, Map<String, String>>();
            for (TaskVersionBinding row : mapper.selectTaskVersionRowsForUpdate(workspaceId, batch)) {
                versions.computeIfAbsent(row.getTaskId(), id -> new TreeMap<String, String>())
                        .put(row.getVersionId(), row.getVersionName());
            }
            for (String id : batch) {
                Map<String, String> bindings = versions.getOrDefault(id, Collections.emptyMap());
                for (Task task : byId.get(id)) {
                    task.setVersionIds(new ArrayList<String>(bindings.keySet()));
                    task.setVersionNames(new ArrayList<String>(bindings.values()));
                }
            }
        }
    }

    private void validateRelation(ProjectVersion version, ReleasePreviewRequest r, Context c) {
        boolean rollback = "rollback".equals(r.getOperation()), redeploy = "redeploy".equals(r.getOperation());
        if ((rollback || redeploy) && c.related == null) throw AppException.badRequest("重部署或回滚必须关联成功事件");
        if (c.related == null) return;
        if (rollback || redeploy) {
            if (!"success".equals(c.related.getResult()) || "rollback".equals(c.related.getOperation()) || !r.getEnvironment().equals(c.related.getEnvironment())
                    || !Objects.equals(r.getArtifactRef(), c.related.getArtifactRef()) || !Objects.equals(r.getArtifactDigest(), c.related.getArtifactDigest())
                    || !c.related.getTargetKeys().containsAll(r.getTargetKeys())) throw AppException.badRequest("关联事件的环境、产物及目标范围不匹配（回滚 / 重部署须与被引用事件填相同的制品标识与 SHA256）");
            if (redeploy && !version.getId().equals(c.related.getVersionId())) throw AppException.badRequest("重部署必须使用相同版本");
            if (rollback && (r.getDeviationReason() == null || r.getTargetKeys().isEmpty())) throw AppException.badRequest("回滚必须说明原因并明确目标");
        } else if (!"failed".equals(c.related.getResult()) || r.getDeviationReason() == null) throw AppException.badRequest("真实重试必须关联失败事件并说明原因");
    }

    private void validate(ReleasePreviewRequest r) {
        if (r == null || r.getOccurredAt() == null || r.getOccurredAt().toInstant().isAfter(Instant.now())) throw AppException.badRequest("精确实际时间必填且不能在未来");
        r.setOccurredAt(r.getOccurredAt().withOffsetSameInstant(ZoneOffset.UTC).truncatedTo(ChronoUnit.MICROS));
        r.setPlanId(Texts.trimToNull(r.getPlanId())); r.setRelatedReleaseId(Texts.trimToNull(r.getRelatedReleaseId())); r.setDeviationReason(Texts.trimToNull(r.getDeviationReason()));
        r.setActualTaskIds(identities(r.getActualTaskIds(), 32, "实际任务")); r.setTargetKeys(identities(r.getTargetKeys(), 128, "发布目标"));
        dimensions(r.getEnvironment(), r.getCoverage(), r.getTargetKeys());
        String artifactRef = Texts.trimToNull(r.getArtifactRef());
        String artifactDigest = Texts.trimToNull(r.getArtifactDigest());
        if (!Arrays.asList("deploy", "redeploy", "rollback").contains(r.getOperation()) || artifactRef == null || artifactRef.length() > 500
                || Texts.trimToNull(r.getExecutorUserId()) == null)
            throw AppException.badRequest("操作、产物及实际执行人必填");
        /* 制品 SHA-256 选填：有 CI 的团队可填；填了仍必须是完整 64 位，不能拿 commit id 冒充 */
        if (artifactDigest != null && !artifactDigest.matches("[a-fA-F0-9]{64}"))
            throw AppException.badRequest("制品 SHA256 必须是 64 位十六进制，或留空表示未记录");
        r.setArtifactRef(artifactRef);
        r.setArtifactDigest(artifactDigest == null ? null : artifactDigest.toLowerCase(Locale.ROOT));
        if (r.getPlanId() == null && r.getDeviationReason() == null) throw AppException.badRequest("无计划紧急记录必须说明原因");
    }

    private List<String> identities(List<String> values, int length, String label) {
        if (values == null || values.size() > 500) throw AppException.badRequest(label + "必须显式提供且不超过500项");
        TreeSet<String> unique = new TreeSet<String>();
        for (String value : values) if (Texts.trimToNull(value) == null || value.length() > length || !value.equals(value.trim()) || !unique.add(value)) throw AppException.badRequest(label + "存在无效或重复标识");
        return new ArrayList<String>(unique);
    }

    private void dimensions(String environment, String coverage, List<String> targets) {
        if (!Arrays.asList("production", "staging", "test").contains(environment) || !Arrays.asList("full", "partial", "unknown").contains(coverage)) throw AppException.badRequest("环境或覆盖类型无效");
        if (!"unknown".equals(coverage) && targets.isEmpty()) throw AppException.badRequest("已知覆盖必须明确目标身份");
    }

    private Map<String, Task> taskMap(List<Task> tasks) {
        Map<String, Task> result = new TreeMap<String, Task>();
        for (Task task : tasks) result.put(task.getId(), task);
        return result;
    }

    private String token(ProjectVersion version, Context c, ReleasePreviewRequest r) {
        Map<String, Object> input = new LinkedHashMap<String, Object>();
        input.put("planId", r.getPlanId()); input.put("occurredAt", r.getOccurredAt()); input.put("environment", r.getEnvironment()); input.put("targetKeys", r.getTargetKeys()); input.put("coverage", r.getCoverage());
        input.put("artifactRef", r.getArtifactRef()); input.put("artifactDigest", r.getArtifactDigest()); input.put("operation", r.getOperation()); input.put("relatedReleaseId", r.getRelatedReleaseId());
        input.put("actualTaskIds", r.getActualTaskIds()); input.put("executorUserId", r.getExecutorUserId()); input.put("deviationReason", r.getDeviationReason());
        return digest(encode(Arrays.asList(input, version, c.project, c.plan, c.plannedVersion, c.plannedScope, c.scope, c.planned, c.actual, c.demands, c.related, c.executor)));
    }

    private String encode(Object value) {
        try {
            return json.writeValueAsString(value);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException(e);
        }
    }

    private String digest(String value) {
        try {
            byte[] bytes = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder result = new StringBuilder(64);
            for (byte b : bytes) {
                result.append(String.format("%02x", b & 255));
            }
            return result.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private void scheduleNotifications(String workspaceId, String userId, ProjectVersion version, Map<String, Integer> counts) {
        String versionId = version.getId(), versionName = version.getName(), projectId = version.getReqId();
        Map<String, Integer> recipients = new LinkedHashMap<String, Integer>(counts);
        Runnable send = () -> notificationTx.execute(status -> {
            for (Map.Entry<String, Integer> count : recipients.entrySet()) {
                notifications.notifyLinkedAs(count.getKey(), workspaceId, UserNotificationPreferenceService.DEMAND_STATUS,
                        "version_released",
                        "版本「" + versionName + "」已发布", "你负责的 " + count.getValue() + " 项任务已确认随该版本发布",
                        "version", versionId, projectId);
            }
            return null;
        });
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                try {
                    send.run();
                } catch (Exception e) {
                    log.warn("发布后的通知发送失败：version={}", versionId, e);
                }
            }
        });
    }
}
