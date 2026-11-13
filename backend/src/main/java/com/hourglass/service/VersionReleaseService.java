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
import com.hourglass.dto.ReleasePreviewResponse;
import com.hourglass.dto.ReleasePreviewRequest;
import com.hourglass.dto.TaskVersionBinding;
import java.time.Instant;
import java.time.ZoneOffset;
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
    private final TransactionTemplate notificationTx;

    public VersionReleaseService(ReleaseMapper mapper, ProjectVersionMapper versionMapper,
                                 RequirementMapper reqMapper, DemandMapper demandMapper, UserMapper userMapper,
                                 VersionTaskMapper versionTaskMapper,
                                 WorkspaceMemberMapper memberMapper, DeliveryScopeLock scopeLock,
                                 ReleasePermissionService permissions, ProjectAccessService access,
                                 TaskPublicationService taskPublication, NotificationEventService notifications,
                                 ObjectMapper json, PlatformTransactionManager transactionManager) {
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

    /** 计划编辑器：只返回当前用户可管理的项目与版本，避免选出必然保存失败的组合。 */
    public ReleasePlanOptions planOptions(String userId, String workspaceId) {
        ReleasePlanOptions options = new ReleasePlanOptions();
        Map<String, ReleasePlanOptions.ProjectOption> projects = new LinkedHashMap<String, ReleasePlanOptions.ProjectOption>();
        for (ReleasePlanOptionRow row : mapper.selectPlanVersionOptions(workspaceId)) {
            if (!permissions.canManageProject(userId, workspaceId, row.getReqId())) continue;
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
        return mapper.selectPlanSchedule(workspaceId, fromDate, toDate, reqId, env,
                scheduleStatuses(status), viewerId, 500);
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
        permissions.assertManageProject(userId, workspaceId, initial.getReqId());
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
        permissions.assertManageProjectForUpdate(userId, workspaceId, current.getReqId());
        return current;
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
        int rows = old == null ? mapper.insertPlan(next) : mapper.updatePlan(next);
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
        VersionReleasePlan saved = mapper.selectPlanForUpdate(workspaceId, next.getId());
        saved.setPlannedTaskIds(mapper.selectPlannedTaskIdsForUpdate(workspaceId, saved.getId()));
        hydratePlan(workspaceId, saved);
        for (String id : versionIds) log(userId, workspaceId, id, "release_plan", reason, old, saved);
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
        Map<String, ProjectVersion> initial = new TreeMap<String, ProjectVersion>();
        for (String id : ids) initial.put(id, requireVersion(userId, workspaceId, id));
        SortedSet<String> projectIds = new TreeSet<String>();
        for (ProjectVersion version : initial.values()) {
            projectIds.add(version.getReqId());
            permissions.assertManageProject(userId, workspaceId, version.getReqId());
        }
        scopeLock.lockProjects(workspaceId, projectIds.toArray(new String[0]));
        List<ProjectVersion> versions = new ArrayList<ProjectVersion>();
        for (ProjectVersion before : initial.values()) {
            ProjectVersion version = versionMapper.selectByIdForUpdate(workspaceId, before.getId());
            if (version == null || !Objects.equals(version.getReqId(), before.getReqId()))
                throw new AppException(409, "版本项目已变化");
            permissions.assertManageProjectForUpdate(userId, workspaceId, version.getReqId());
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
        response.setCanPublish(!request.getActualTaskIds().isEmpty() && (c.warnings.isEmpty() || request.getDeviationReason() != null));
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
        if (success && !c.warnings.isEmpty() && request.getDeviationReason() == null) throw new AppException(422, "异常事实必须说明偏离原因");
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
        record.setPlanSnapshot(encode(c.plan));
        if (mapper.insertRecord(record) != 1) throw new AppException(409, "发布记录写入冲突");
        Map<String, Integer> counts = new LinkedHashMap<String, Integer>();
        for (String id : request.getActualTaskIds()) {
            Task task = c.actual.get(id);
            VersionReleaseItem item = "rollback".equals(request.getOperation()) ? copy(c.relatedItems.get(id), record)
                    : snapshot(record, task, (task.getDemandId() == null ? null : c.demands.get(task.getDemandId())), "candidate");
            item.setDisposition(success ? ("rollback".equals(request.getOperation()) ? "rolled_back" : "published") : "candidate");
            item.setReason(request.getDeviationReason());
            insertItem(record, item);
            if (task != null && task.getOwnerUserId() != null && !userId.equals(task.getOwnerUserId()))
                counts.put(task.getOwnerUserId(), counts.getOrDefault(task.getOwnerUserId(), 0) + 1);
        }
        for (String id : c.omitted) {
            Task task = c.planned.get(id);
            VersionReleaseItem item = snapshot(record, task, (task.getDemandId() == null ? null : c.demands.get(task.getDemandId())), "not_selected");
            item.setReason(request.getDeviationReason() != null ? request.getDeviationReason() : Objects.toString(failure, "本次实际范围未选择"));
            insertItem(record, item);
        }
        /* 多版本计划只有全部包含版本都完成成功的生产部署/重部署才收口；测试、预发、回滚与部分成功不完成计划。 */
        if (success && c.plan != null && "production".equals(record.getEnvironment())
                && !"rollback".equals(request.getOperation())) {
            int total = mapper.countPlanVersions(workspaceId, c.plan.getId());
            /* 没有版本关联行的历史计划按单版本处理，本次成功记录即视为全部完成。 */
            int released = total == 0 ? 1 : mapper.countPlanVersionsReleased(workspaceId, c.plan.getId());
            if (released >= Math.max(total, 1)
                    && mapper.completePlan(workspaceId, c.plan.getId(), c.plan.getRevision()) != 1)
                throw new AppException(409, "计划状态写入冲突");
        }
        log(userId, workspaceId, versionId, "rollback".equals(request.getOperation()) ? "release_rollback" : success ? "release_success" : "release_failed",
                request.getDeviationReason() != null ? request.getDeviationReason() : success ? request.getNotes() : failure, null, record);
        if (success && "production".equals(record.getEnvironment()) && !"rollback".equals(record.getOperation()))
            scheduleNotifications(workspaceId, userId, version, counts);
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
                        + Objects.toString(versionName, "无") + "；" + reason, 255), encode(change));
    }

    private VersionReleaseItem snapshot(VersionRelease record, Task task, Demand demand, String disposition) {
        VersionReleaseItem item = new VersionReleaseItem();
        item.setWorkspaceId(record.getWorkspaceId());
        item.setReleaseId(record.getId());
        item.setTaskId(task.getId());
        item.setTitle(task.getTitle());
        item.setItemType(task.getItemType());
        item.setOwnerUserId(task.getOwnerUserId());
        item.setOwnerName(task.getOwner());
        item.setDemandId(task.getDemandId());
        if (demand != null) {
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
            if (!Consts.COL_DONE.equals(task.getBoardColumn()) || task.getCompletedAt() == null || task.getCompletedAt().isAfter(r.getOccurredAt().toLocalDate()))
                c.warnings.add("任务 " + id + " 未完成或完成日晚于实际时间");
            Demand demand = (task.getDemandId() == null ? null : c.demands.get(task.getDemandId()));
            if (demand != null && (("closed".equals(demand.getStatus()) || "canceled".equals(demand.getStatus()))
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
            for (VersionRelease prior : mapper.selectRecordsForUpdate(workspaceId, version.getId())) {
                if ("success".equals(prior.getResult()) && "production".equals(prior.getEnvironment()) && !"rollback".equals(prior.getOperation())
                        && (!Objects.equals(prior.getArtifactDigest(), r.getArtifactDigest()) || !Objects.equals(prior.getArtifactRef(), r.getArtifactRef())))
                    throw new AppException(409, "已有成功生产事件的产物不可更换，补丁请使用新版本");
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
                    || !r.getArtifactRef().equals(c.related.getArtifactRef()) || !r.getArtifactDigest().equals(c.related.getArtifactDigest())
                    || !c.related.getTargetKeys().containsAll(r.getTargetKeys())) throw AppException.badRequest("关联事件的环境、产物及目标范围不匹配");
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
        if (!Arrays.asList("deploy", "redeploy", "rollback").contains(r.getOperation()) || Texts.trimToNull(r.getArtifactRef()) == null || r.getArtifactRef().length() > 500
                || r.getArtifactDigest() == null || !r.getArtifactDigest().matches("[a-fA-F0-9]{64}") || Texts.trimToNull(r.getExecutorUserId()) == null)
            throw AppException.badRequest("操作、产物、SHA-256及实际执行人必填");
        r.setArtifactDigest(r.getArtifactDigest().toLowerCase(Locale.ROOT));
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
                notifications.notifyLinked(count.getKey(), workspaceId, UserNotificationPreferenceService.DEMAND_STATUS,
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
