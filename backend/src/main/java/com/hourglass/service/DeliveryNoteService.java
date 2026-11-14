package com.hourglass.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.hourglass.common.AppException;
import com.hourglass.common.Consts;
import com.hourglass.common.DefectMeta;
import com.hourglass.common.Ids;
import com.hourglass.common.Nos;
import com.hourglass.common.Texts;
import com.hourglass.dto.DeliveryNoteResponse;
import com.hourglass.dto.DeliveryNoteSaveRequest;
import com.hourglass.dto.DeliveryShareResponse;
import com.hourglass.dto.PlanVersionRow;
import com.hourglass.dto.PublicDeliveryNote;
import com.hourglass.dto.TestPlanView;
import com.hourglass.entity.AppUser;
import com.hourglass.entity.Category;
import com.hourglass.entity.DeliveryNote;
import com.hourglass.entity.DeliveryNoteShare;
import com.hourglass.entity.DeliveryNoteSnapshot;
import com.hourglass.entity.Demand;
import com.hourglass.entity.ProjectVersion;
import com.hourglass.entity.Requirement;
import com.hourglass.entity.Task;
import com.hourglass.entity.TimeAgg;
import com.hourglass.entity.VersionCommitmentTask;
import com.hourglass.entity.VersionRelease;
import com.hourglass.entity.VersionReleaseItem;
import com.hourglass.entity.VersionReleasePlan;
import com.hourglass.entity.Workspace;
import com.hourglass.mapper.CategoryMapper;
import com.hourglass.mapper.DeliveryNoteMapper;
import com.hourglass.mapper.DemandMapper;
import com.hourglass.mapper.ProjectVersionMapper;
import com.hourglass.mapper.ReleaseMapper;
import com.hourglass.mapper.RequirementMapper;
import com.hourglass.mapper.TaskMapper;
import com.hourglass.mapper.TestPlanMapper;
import com.hourglass.mapper.TimeLogMapper;
import com.hourglass.mapper.UserMapper;
import com.hourglass.mapper.VersionCommitmentMapper;
import com.hourglass.mapper.VersionTaskMapper;
import com.hourglass.mapper.WorkspaceMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 一页式交付说明：把版本、发布、需求、测试、缺陷、工时与变更聚合成一份可对外的事实清单。
 *
 * <p>三条硬口径：
 * ① 生成过程只读，不写任何业务表；只有「导出快照」落一条不可变记录；
 * ② 实际交付只认成功的生产发布记录，其余一律标注为草稿，完成数量不折算成已交付；
 * ③ 缺记录就标缺失，不推断、不补造，也不阻断其余区块。
 */
@Service
public class DeliveryNoteService {

    private static final int SHARE_DAYS = 30;
    private static final int MAX_NARRATIVE = 4000;
    private static final DateTimeFormatter DOC_DAY = DateTimeFormatter.ofPattern("yyyyMMdd");
    private static final List<String> TONES = Arrays.asList("customer", "manager", "internal");
    private static final List<String> CONFIRM_KEYS = Arrays.asList("summary", "change", "issue", "acceptance");

    private final ProjectVersionMapper versionMapper;
    private final RequirementMapper reqMapper;
    private final TaskMapper taskMapper;
    private final VersionTaskMapper versionTaskMapper;
    private final DemandMapper demandMapper;
    private final ReleaseMapper releaseMapper;
    private final VersionCommitmentMapper commitmentMapper;
    private final TestPlanMapper testPlanMapper;
    private final TimeLogMapper timeLogMapper;
    private final CategoryMapper categoryMapper;
    private final UserMapper userMapper;
    private final WorkspaceMapper workspaceMapper;
    private final DeliveryNoteMapper noteMapper;
    private final ProjectAccessService projectAccess;
    private final ObjectMapper json;

    public DeliveryNoteService(ProjectVersionMapper versionMapper, RequirementMapper reqMapper,
                               TaskMapper taskMapper, VersionTaskMapper versionTaskMapper,
                               DemandMapper demandMapper, ReleaseMapper releaseMapper,
                               VersionCommitmentMapper commitmentMapper, TestPlanMapper testPlanMapper,
                               TimeLogMapper timeLogMapper, CategoryMapper categoryMapper,
                               UserMapper userMapper, WorkspaceMapper workspaceMapper,
                               DeliveryNoteMapper noteMapper, ProjectAccessService projectAccess,
                               ObjectMapper json) {
        this.versionMapper = versionMapper;
        this.reqMapper = reqMapper;
        this.taskMapper = taskMapper;
        this.versionTaskMapper = versionTaskMapper;
        this.demandMapper = demandMapper;
        this.releaseMapper = releaseMapper;
        this.commitmentMapper = commitmentMapper;
        this.testPlanMapper = testPlanMapper;
        this.timeLogMapper = timeLogMapper;
        this.categoryMapper = categoryMapper;
        this.userMapper = userMapper;
        this.workspaceMapper = workspaceMapper;
        this.noteMapper = noteMapper;
        this.projectAccess = projectAccess;
        this.json = json;
    }

    /* ==================== 聚合 ==================== */

    public DeliveryNoteResponse aggregate(String workspaceId, String userId, String versionId, String releaseId) {
        ProjectVersion version = requireVersion(workspaceId, versionId);
        projectAccess.assertView(workspaceId, userId, version.getReqId());
        DeliveryNote note = noteMapper.selectByVersion(workspaceId, versionId);
        List<VersionRelease> records = releaseMapper.selectRecords(workspaceId, versionId);
        VersionRelease selected = pickRelease(records, wantedRelease(releaseId, note));
        DeliveryNoteResponse resp = build(workspaceId, userId, version, note, records, selected);
        resp.setCanEdit(projectAccess.canWrite(workspaceId, userId, version.getReqId()));
        resp.setCanSnapshot(resp.getCanEdit());
        resp.setCanShare(isDeliveryEvidence(selected) && !"internal".equals(toneOf(resp.getOptions())));
        return resp;
    }

    /** 事实聚合：编制侧与快照回放共用，不含任何权限判断 */
    private DeliveryNoteResponse build(String workspaceId, String userId, ProjectVersion version,
                                       DeliveryNote note, List<VersionRelease> records, VersionRelease selected) {
        String versionId = version.getId();
        String reqId = version.getReqId();
        Requirement project = reqId == null ? null : reqMapper.selectById(reqId);
        DeliveryNoteResponse r = new DeliveryNoteResponse();
        r.setVersionId(versionId);
        r.setVersionName(version.getName());
        r.setVersionStatus(version.getStatus());
        r.setVersionDescription(version.getDescription());
        r.setProjectId(reqId);
        r.setProjectName(project == null ? "未归属项目" : project.getName());
        r.setOwnerName(resolveOwner(project, userId));
        r.setTargetDate(version.getTargetDate());
        r.setGeneratedAt(LocalDateTime.now());
        r.setLocked(false);

        Map<String, Object> options = defaultOptions();
        String audience = null;
        String support = null;
        String acceptanceNote = null;
        if (note != null) {
            options.putAll(readMap(note.getOptions()));
            r.setNarratives(readStringMap(note.getNarratives()));
            r.setConfirmed(readList(note.getConfirmed()));
            r.setRevision(note.getRevision());
            audience = note.getAudience();
            support = note.getSupportContact();
            acceptanceNote = note.getAcceptance();
        }
        r.setOptions(options);
        r.setAudience(audience);
        r.setSupportContact(support);
        r.setAcceptanceNote(acceptanceNote);

        boolean evidence = isDeliveryEvidence(selected);
        r.setEvidenceKind(evidence ? "release_snapshot"
                : "released".equals(version.getStatus()) ? "no_release_record" : "planned_scope");
        r.setReleaseRecordId(selected == null ? null : selected.getId());
        r.setReleaseOptions(releaseOptions(records));
        r.setRelease(releaseInfo(selected, records, version.getTargetDate()));

        /* 当前状态：范围、缺陷、需求兑现都从这里派生 */
        List<Task> projectTasks = taskMapper.selectByReq(workspaceId, reqId);
        versionTaskMapper.enrichTasks(workspaceId, projectTasks);
        Map<String, Integer> minutes = taskMinutes(workspaceId, projectTasks);
        Map<String, String> modules = moduleNames(workspaceId);

        List<VersionReleaseItem> items = evidence
                ? releaseMapper.selectItems(workspaceId, selected.getId()) : Collections.<VersionReleaseItem>emptyList();
        Set<String> publishedIds = new LinkedHashSet<String>();
        Map<String, VersionReleaseItem> publishedItems = new LinkedHashMap<String, VersionReleaseItem>();
        for (VersionReleaseItem item : items) {
            if ("published".equals(item.getDisposition())) {
                publishedIds.add(item.getTaskId());
                publishedItems.put(item.getTaskId(), item);
            }
        }

        List<VersionCommitmentTask> commitment = new ArrayList<VersionCommitmentTask>();
        for (VersionCommitmentTask row : commitmentMapper.selectByReq(workspaceId, reqId)) {
            if (versionId.equals(row.getVersionId())) {
                commitment.add(row);
            }
        }
        List<Task> bound = new ArrayList<Task>();
        Map<String, Task> byId = new LinkedHashMap<String, Task>();
        for (Task t : projectTasks) {
            byId.put(t.getId(), t);
            if (t.getVersionIds().contains(versionId)) {
                bound.add(t);
            }
        }
        Set<String> boundIds = new LinkedHashSet<String>();
        for (Task t : bound) {
            boundIds.add(t.getId());
        }

        r.setBaseline(baseline(version, commitment, boundIds, byId, evidence, selected));
        fillScope(r, version, bound, commitment, byId, publishedIds, publishedItems, minutes, modules, evidence);
        fillDemands(r, workspaceId, versionId, bound, publishedIds, publishedItems, modules, evidence);
        fillChanges(r, workspaceId, versionId, version, selected, records);
        fillQuality(r, workspaceId, reqId, versionId);
        fillDefects(r, versionId, projectTasks, minutes, modules);
        fillEffort(r, bound, publishedItems, minutes, modules, evidence);
        fillPlan(r, workspaceId, versionId, selected);
        fillRisksAndAcceptance(r, version, evidence);
        fillEvidence(r, version, selected, records);
        fillCalibers(r);
        r.setRevisions(revisions(workspaceId, versionId));
        r.setDocNo(nextDocNo(workspaceId, versionId));
        r.setPeriodStart(periodStart(version, commitment));
        r.setPeriodEnd(periodEnd(version, selected));
        collectMissing(r);
        return r;
    }

    private LocalDate periodStart(ProjectVersion version, List<VersionCommitmentTask> commitment) {
        if (version.getStartDate() != null) {
            return version.getStartDate();
        }
        if (version.getCommitmentAt() != null) {
            return version.getCommitmentAt().toLocalDate();
        }
        return version.getCreatedAt() == null ? null : version.getCreatedAt().toLocalDate();
    }

    private LocalDate periodEnd(ProjectVersion version, VersionRelease selected) {
        if (selected != null && selected.getPublishedOn() != null) {
            return selected.getPublishedOn();
        }
        if (version.getReleasedAt() != null) {
            return version.getReleasedAt().toLocalDate();
        }
        if (version.getEndedAt() != null) {
            return version.getEndedAt().toLocalDate();
        }
        return LocalDate.now();
    }

    private DeliveryNoteResponse.Baseline baseline(ProjectVersion version, List<VersionCommitmentTask> commitment,
                                                   Set<String> boundIds, Map<String, Task> byId,
                                                   boolean evidence, VersionRelease selected) {
        DeliveryNoteResponse.Baseline b = new DeliveryNoteResponse.Baseline();
        b.setCapturedAt(version.getCommitmentAt());
        b.setTaskCount(commitment.size());
        int estimate = 0;
        int added = 0;
        int addedEstimate = 0;
        int removed = 0;
        int removedEstimate = 0;
        Set<String> committedIds = new LinkedHashSet<String>();
        for (VersionCommitmentTask row : commitment) {
            estimate += nz(row.getEstimateMinutes());
            committedIds.add(row.getTaskId());
            if (!boundIds.contains(row.getTaskId())) {
                removed++;
                removedEstimate += nz(row.getEstimateMinutes());
                b.getRemovedTitles().add(row.getTaskTitle());
            }
        }
        for (String id : boundIds) {
            if (!committedIds.contains(id)) {
                added++;
                Task t = byId.get(id);
                int est = t == null ? 0 : nz(t.getEstimateMinutes());
                addedEstimate += est;
                b.getAddedTitles().add(t == null ? id : t.getTitle());
            }
        }
        b.setEstimateMinutes(estimate);
        b.setAddedCount(commitment.isEmpty() ? 0 : added);
        b.setAddedEstimateMinutes(commitment.isEmpty() ? 0 : addedEstimate);
        b.setRemovedCount(removed);
        b.setRemovedEstimateMinutes(removedEstimate);
        b.setTargetDate(version.getTargetDate());
        LocalDate publishedOn = selected == null ? null : selected.getPublishedOn();
        b.setLate(version.getCommitmentAt() != null && publishedOn != null
                && version.getCommitmentAt().toLocalDate().isAfter(publishedOn));
        return b;
    }

    private void fillScope(DeliveryNoteResponse r, ProjectVersion version, List<Task> bound,
                           List<VersionCommitmentTask> commitment, Map<String, Task> byId,
                           Set<String> publishedIds, Map<String, VersionReleaseItem> publishedItems,
                           Map<String, Integer> minutes, Map<String, String> modules, boolean evidence) {
        String versionId = version.getId();
        List<DeliveryNoteResponse.ScopeRow> rows = new ArrayList<DeliveryNoteResponse.ScopeRow>();
        int released = 0;
        int done = 0;
        int doing = 0;
        for (Task t : bound) {
            DeliveryNoteResponse.ScopeRow row = new DeliveryNoteResponse.ScopeRow();
            row.setId(t.getId());
            row.setItemNo(t.getItemNo());
            row.setTitle(t.getTitle());
            row.setModule(moduleName(modules, t.getCategoryId()));
            row.setItemType(t.getItemType() == null ? "task" : t.getItemType());
            row.setItemTypeName(typeName(row.getItemType()));
            row.setOwner(Texts.trimToNull(t.getOwner()) == null ? "待指派" : t.getOwner());
            row.setDemandId(t.getDemandId());
            row.setEstimateMinutes(nz(t.getEstimateMinutes()));
            row.setWorkMinutes(nz(minutes.get(t.getId())));
            boolean isPublished = publishedIds.contains(t.getId());
            if (isPublished) {
                released++;
                row.setState("released");
                VersionReleaseItem item = publishedItems.get(t.getId());
                row.setRef(itemLabel(t) + (item == null || item.getDemandTitle() == null ? "" : " · " + item.getDemandTitle()));
                row.setDemandTitle(item == null ? null : item.getDemandTitle());
            } else if (Consts.COL_DONE.equals(t.getBoardColumn())) {
                row.setState(evidence ? "pending" : "done");
                row.setRef(itemLabel(t) + " · 已完成，未纳入本次发布快照");
                row.setReason("未纳入发布快照");
            } else {
                row.setState("pending");
                row.setRef(itemLabel(t) + " · " + columnName(t.getBoardColumn()));
            }
            if (Consts.COL_DONE.equals(t.getBoardColumn())) {
                done++;
            } else if (Consts.COL_DOING.equals(t.getBoardColumn())
                    || Consts.COL_TEST.equals(t.getBoardColumn()) || Consts.COL_TESTING.equals(t.getBoardColumn())) {
                doing++;
            }
            rows.add(row);
        }
        /* 基线内已移出的项：承诺台账保留并标注去向，不静默消失 */
        int deferred = 0;
        for (VersionCommitmentTask row : commitment) {
            Task t = byId.get(row.getTaskId());
            if (t == null || t.getVersionIds().contains(versionId)) {
                continue;
            }
            deferred++;
            DeliveryNoteResponse.ScopeRow out = new DeliveryNoteResponse.ScopeRow();
            out.setId(t.getId());
            out.setItemNo(t.getItemNo());
            out.setTitle(t.getTitle());
            out.setModule(moduleName(modules, t.getCategoryId()));
            out.setItemType(t.getItemType() == null ? "task" : t.getItemType());
            out.setItemTypeName(typeName(out.getItemType()));
            out.setOwner(Texts.trimToNull(t.getOwner()) == null ? "待指派" : t.getOwner());
            out.setState("deferred");
            out.setDemandId(t.getDemandId());
            out.setEstimateMinutes(nz(row.getEstimateMinutes()));
            out.setWorkMinutes(nz(minutes.get(t.getId())));
            out.setTargetVersionName(t.getVersionNames().isEmpty() ? "待规划" : String.join(" / ", t.getVersionNames()));
            out.setRef(itemLabel(t) + " · 改版本至 " + out.getTargetVersionName());
            out.setReason("已移出本版本");
            rows.add(out);
        }
        r.setScope(rows);
        DeliveryNoteResponse.Counts c = new DeliveryNoteResponse.Counts();
        c.setCurrentBound(bound.size());
        c.setPlanned(bound.size() + deferred);
        c.setReleased(released);
        c.setDeferred(deferred);
        c.setPending(c.getPlanned() - released - deferred);
        c.setDone(done);
        c.setDoing(doing);
        r.setCounts(c);
    }

    private void fillDemands(DeliveryNoteResponse r, String workspaceId, String versionId, List<Task> bound,
                             Set<String> publishedIds, Map<String, VersionReleaseItem> publishedItems,
                             Map<String, String> modules, boolean evidence) {
        Map<String, Demand> demands = new LinkedHashMap<String, Demand>();
        for (Demand d : demandMapper.selectByVersion(workspaceId, versionId)) {
            demands.put(d.getId(), d);
        }
        /* 发布快照里出现过的需求也要在册：需求可能已改版本，但本次确实交付了它的一部分 */
        List<String> missingIds = new ArrayList<String>();
        for (Task t : bound) {
            if (t.getDemandId() != null && !demands.containsKey(t.getDemandId())) {
                missingIds.add(t.getDemandId());
            }
        }
        for (VersionReleaseItem item : publishedItems.values()) {
            if (item.getDemandId() != null && !demands.containsKey(item.getDemandId())) {
                missingIds.add(item.getDemandId());
            }
        }
        for (String id : new LinkedHashSet<String>(missingIds)) {
            Demand d = demandMapper.selectById(id);
            if (d != null && workspaceId.equals(d.getWorkspaceId())) {
                demands.put(id, d);
            }
        }
        Map<String, int[]> perDemand = new LinkedHashMap<String, int[]>();
        for (Task t : bound) {
            if (t.getDemandId() == null) {
                continue;
            }
            int[] agg = perDemand.get(t.getDemandId());
            if (agg == null) {
                agg = new int[2];
                perDemand.put(t.getDemandId(), agg);
            }
            agg[0]++;
            if (publishedIds.contains(t.getId())) {
                agg[1]++;
            }
        }
        for (VersionReleaseItem item : publishedItems.values()) {
            if (item.getDemandId() == null) {
                continue;
            }
            int[] agg = perDemand.get(item.getDemandId());
            if (agg == null) {
                agg = new int[2];
                perDemand.put(item.getDemandId(), agg);
            }
            if (!containsBoundTask(bound, item.getTaskId())) {
                agg[0]++;
                agg[1]++;
            }
        }
        List<DeliveryNoteResponse.DemandRow> rows = new ArrayList<DeliveryNoteResponse.DemandRow>();
        int fulfilled = 0;
        int partial = 0;
        int deferred = 0;
        int pending = 0;
        for (Demand d : demands.values()) {
            int[] agg = perDemand.get(d.getId());
            int total = agg == null ? 0 : agg[0];
            int rel = agg == null ? 0 : agg[1];
            DeliveryNoteResponse.DemandRow row = new DeliveryNoteResponse.DemandRow();
            row.setId(d.getId());
            row.setTitle(d.getTitle());
            row.setModule(moduleName(modules, d.getCategoryId()));
            row.setPriority(d.getPriority());
            row.setSource(d.getSource());
            row.setAcceptText(d.getAcceptText());
            row.setTaskCount(total);
            row.setReleasedCount(rel);
            row.setTargetVersionName(d.getVersionName());
            row.setDeliveredAt(d.getDeliveredAt());
            boolean moved = d.getVersionId() != null && !versionId.equals(d.getVersionId());
            if (total > 0 && rel == total) {
                row.setState("fulfilled");
                row.setNote("关联工作项全部纳入本次发布快照");
                fulfilled++;
            } else if (rel > 0) {
                row.setState("partial");
                row.setNote("已发布 " + rel + " / " + total + " 项，其余随后续版本");
                partial++;
            } else if (moved) {
                row.setState("deferred");
                row.setNote("目标版本已改为 " + (d.getVersionName() == null ? "其他版本" : d.getVersionName()));
                deferred++;
            } else {
                row.setState("pending");
                row.setNote(evidence ? "本次未发布" : "尚未确认生产发布");
                pending++;
            }
            rows.add(row);
        }
        r.setDemands(rows);
        DeliveryNoteResponse.DemandSummary s = new DeliveryNoteResponse.DemandSummary();
        s.setTotal(rows.size());
        s.setFulfilled(fulfilled);
        s.setPartial(partial);
        s.setDeferred(deferred);
        s.setPending(pending);
        s.setRatePct(rows.isEmpty() ? null : Math.round((fulfilled * 100f) / rows.size()));
        r.setDemandSummary(s);
    }

    private static boolean containsBoundTask(List<Task> bound, String taskId) {
        for (Task t : bound) {
            if (t.getId().equals(taskId)) {
                return true;
            }
        }
        return false;
    }

    private void fillChanges(DeliveryNoteResponse r, String workspaceId, String versionId,
                             ProjectVersion version, VersionRelease selected, List<VersionRelease> records) {
        List<DeliveryNoteResponse.ChangeRow> rows = new ArrayList<DeliveryNoteResponse.ChangeRow>();
        for (Map<String, Object> log : releaseMapper.selectLogs(workspaceId, versionId)) {
            String action = str(log.get("action"));
            /* 创建不是变更；发布结果由下面的发布记录逐条生成，日志再列一次会重复 */
            if ("version_create".equals(action) || "create".equals(action)
                    || "release_success".equals(action) || "release_failed".equals(action)
                    || "release_rollback".equals(action)) {
                continue;
            }
            DeliveryNoteResponse.ChangeRow row = new DeliveryNoteResponse.ChangeRow();
            row.setDate(toDate(log.get("createdAt")));
            row.setActorName(str(log.get("actorName")));
            row.setReason(str(log.get("reason")));
            row.setSource("版本日志 · " + actionName(action));
            Map<String, Object> change = readMap(str(log.get("changeData")));
            Map<String, Object> after = asMap(change.get("after"));
            /* 早期日志把字段直接平铺在 changeData 上，没有 before/after 包裹 */
            if (after.isEmpty()) {
                after = change;
            }
            if ("version_update".equals(action) || "update".equals(action)) {
                String target = str(after.get("targetDate"));
                String name = str(after.get("name"));
                row.setKind("date");
                row.setTitle(target != null ? "目标就绪日调整为 " + target
                        : name != null ? "版本信息调整为 " + name : "版本信息调整");
                row.getTags().add("版本信息");
                if (target != null) {
                    row.getTags().add("目标日 " + target);
                }
            } else if ("version_scope".equals(action) || "scope".equals(action)) {
                row.setKind("scope");
                row.setTitle("交付范围调整");
                row.getTags().add("范围变更");
                Object scoped = after.get("selected");
                if (!(scoped instanceof List)) {
                    scoped = change.get("after");
                }
                if (scoped instanceof List) {
                    row.getTags().add("调整为 " + ((List<?>) scoped).size() + " 项");
                }
            } else if ("version_start".equals(action) || "start".equals(action)) {
                row.setKind("status");
                row.setTitle("开始开发，承诺基线冻结");
                row.getTags().add("基线冻结");
            } else if ("version_close".equals(action) || "close".equals(action)
                    || "version_cancel".equals(action) || "cancel".equals(action)) {
                boolean closed = "version_close".equals(action) || "close".equals(action);
                row.setKind("status");
                row.setTitle(closed ? "版本关闭" : "版本取消");
                row.getTags().add("状态变更");
                row.getTags().add(closed ? "已关闭" : "已取消");
            } else if ("release_plan".equals(action)) {
                String plannedAt = str(after.get("plannedAt"));
                row.setKind("plan");
                row.setTitle(plannedAt == null ? "发布计划调整" : "发布计划定于 " + plainDateTime(plannedAt));
                row.getTags().add("发布计划");
                row.getTags().add(environmentName(str(after.get("environment"))));
                String coverage = str(after.get("coverage"));
                if (coverage != null) {
                    row.getTags().add(coverageName(coverage));
                }
                Object planned = after.get("plannedTaskIds");
                if (planned instanceof List) {
                    row.getTags().add("计划范围 " + ((List<?>) planned).size() + " 项");
                }
                String status = str(after.get("status"));
                if (status != null) {
                    row.getTags().add(planStatusName(status));
                }
                Object revision = after.get("revision");
                if (revision instanceof Number) {
                    row.getTags().add("计划第 " + revision + " 版");
                }
            } else if ("release".equals(action) || "version_release".equals(action)) {
                String releasedAt = str(after.get("releasedAt"));
                row.setKind("status");
                row.setTitle(releasedAt == null ? "版本标记为已发布" : "版本标记为已发布 · " + releasedAt);
                row.getTags().add("状态变更");
                if (releasedAt != null) {
                    row.getTags().add("发布日 " + releasedAt);
                }
            } else {
                row.setKind("status");
                row.setTitle(actionName(action));
                row.getTags().add("版本日志");
            }
            rows.add(row);
        }
        DeliveryNoteResponse.Baseline b = r.getBaseline();
        if (b != null && b.getCapturedAt() != null) {
            if (nz(b.getAddedCount()) > 0) {
                DeliveryNoteResponse.ChangeRow row = new DeliveryNoteResponse.ChangeRow();
                row.setDate(b.getCapturedAt().toLocalDate());
                row.setKind("add");
                row.setTitle("基线后新增 " + b.getAddedCount() + " 项：" + join(b.getAddedTitles(), 3));
                row.getTags().add("范围 +" + b.getAddedCount() + " 项");
                if (nz(b.getAddedEstimateMinutes()) > 0) {
                    row.getTags().add("预估 +" + hours(b.getAddedEstimateMinutes()));
                }
                row.setSource("承诺基线差集（开始开发时冻结）");
                rows.add(row);
            }
            if (nz(b.getRemovedCount()) > 0) {
                DeliveryNoteResponse.ChangeRow row = new DeliveryNoteResponse.ChangeRow();
                row.setDate(b.getCapturedAt().toLocalDate());
                row.setKind("move");
                row.setTitle("基线后移出 " + b.getRemovedCount() + " 项：" + join(b.getRemovedTitles(), 3));
                row.getTags().add("承诺保留 · 标注延后");
                if (nz(b.getRemovedEstimateMinutes()) > 0) {
                    row.getTags().add("预估 -" + hours(b.getRemovedEstimateMinutes()));
                }
                row.setSource("承诺基线差集（开始开发时冻结）");
                rows.add(row);
            }
        }
        for (VersionRelease record : records) {
            if (!"success".equals(record.getResult()) || "rollback".equals(record.getOperation())) {
                DeliveryNoteResponse.ChangeRow row = new DeliveryNoteResponse.ChangeRow();
                row.setDate(record.getPublishedOn());
                row.setKind("status");
                row.setTitle("rollback".equals(record.getOperation()) ? "执行回滚" : "发布尝试未成功");
                row.getTags().add(environmentName(record.getEnvironment()));
                row.getTags().add("rollback".equals(record.getOperation()) ? "回滚" : "失败");
                row.setReason(Texts.trimToNull(record.getFailureReason()) == null
                        ? record.getDeviationReason() : record.getFailureReason());
                row.setActorName(record.getExecutorName());
                row.setSource("发布记录 " + releaseLabel(record));
                rows.add(row);
            }
        }
        Collections.sort(rows, new Comparator<DeliveryNoteResponse.ChangeRow>() {
            @Override
            public int compare(DeliveryNoteResponse.ChangeRow a, DeliveryNoteResponse.ChangeRow b) {
                if (a.getDate() == null || b.getDate() == null) {
                    return a.getDate() == null ? 1 : -1;
                }
                return a.getDate().compareTo(b.getDate());
            }
        });
        r.setChanges(rows);
    }

    private void fillQuality(DeliveryNoteResponse r, String workspaceId, String reqId, String versionId) {
        List<TestPlanView> plans = new ArrayList<TestPlanView>();
        for (TestPlanView p : testPlanMapper.selectViewByReq(workspaceId, reqId, 0, 500)) {
            if (versionId.equals(p.getVersionId())) {
                plans.add(p);
            }
        }
        DeliveryNoteResponse.Quality q = new DeliveryNoteResponse.Quality();
        q.setPlanCount(plans.size());
        int cases = 0;
        int executed = 0;
        int passed = 0;
        int failed = 0;
        int blocked = 0;
        int skipped = 0;
        int defects = 0;
        for (TestPlanView p : plans) {
            cases += p.getCaseCount();
            executed += p.getExecutedCount();
            passed += p.getPassedCount();
            failed += p.getFailedCount();
            blocked += p.getBlockedCount();
            skipped += p.getSkippedCount();
            defects += p.getDefectCount();
        }
        q.setCaseCount(cases);
        q.setExecutedCount(executed);
        q.setPassedCount(passed);
        q.setFailedCount(failed);
        q.setBlockedCount(blocked);
        q.setSkippedCount(skipped);
        q.setUnexecutedCount(Math.max(0, cases - executed));
        q.setDefectCount(defects);
        int rateBase = executed - skipped;
        q.setPassRatePct(rateBase <= 0 ? null : Math.round(passed * 1000f / rateBase) / 10d);
        q.setCoveragePct(cases == 0 ? null : Math.round(executed * 1000f / cases) / 10d);
        q.setMissing(plans.isEmpty() || cases == 0);
        if (!plans.isEmpty()) {
            TestPlanView first = plans.get(0);
            q.setPlanId(first.getId());
            q.setPlanName(plans.size() == 1 ? first.getName() : first.getName() + " 等 " + plans.size() + " 个计划");
            q.setPlanStatus(first.getStatus());
        }
        r.setQuality(q);
    }

    private void fillDefects(DeliveryNoteResponse r, String versionId, List<Task> projectTasks,
                             Map<String, Integer> minutes, Map<String, String> modules) {
        DeliveryNoteResponse.Defects d = new DeliveryNoteResponse.Defects();
        Map<String, int[]> bySeverity = new LinkedHashMap<String, int[]>();
        for (String severity : DefectMeta.SEVERITIES) {
            bySeverity.put(severity, new int[2]);
        }
        int total = 0;
        int fixed = 0;
        int open = 0;
        int blockerOpen = 0;
        for (Task t : projectTasks) {
            if (!"bug".equals(t.getItemType())) {
                continue;
            }
            boolean related = versionId.equals(t.getFoundVersionId()) || t.getVersionIds().contains(versionId);
            if (!related) {
                continue;
            }
            total++;
            String severity = DefectMeta.isSeverity(t.getSeverity()) ? t.getSeverity() : DefectMeta.SEVERITY_MAJOR;
            boolean closed = Consts.COL_DONE.equals(t.getBoardColumn());
            int[] agg = bySeverity.get(severity);
            agg[0]++;
            DeliveryNoteResponse.DefectRow row = new DeliveryNoteResponse.DefectRow();
            row.setId(t.getId());
            row.setItemNo(t.getItemNo());
            row.setTitle(t.getTitle());
            row.setSeverity(severity);
            row.setSeverityName(severityName(severity));
            row.setOwner(Texts.trimToNull(t.getOwner()) == null ? "待指派" : t.getOwner());
            row.setBoardColumn(t.getBoardColumn());
            row.setColumnName(columnName(t.getBoardColumn()));
            row.setRegressionStatus(t.getRegressionStatus());
            row.setRegressionName(regressionName(t.getRegressionStatus()));
            row.setEnvironment(t.getEnvironment());
            row.setCompletedAt(t.getCompletedAt());
            row.setTargetVersionName(t.getVersionNames().isEmpty() ? null : String.join(" / ", t.getVersionNames()));
            row.setNote(Texts.trimToNull(t.getBlockedReason()));
            if (closed) {
                fixed++;
                d.getFixed().add(row);
            } else {
                open++;
                agg[1]++;
                boolean blocks = DefectMeta.SEVERITY_BLOCKER.equals(severity) || DefectMeta.SEVERITY_CRITICAL.equals(severity);
                row.setBlocksAcceptance(blocks);
                if (blocks) {
                    blockerOpen++;
                }
                d.getOpen().add(row);
            }
        }
        for (Map.Entry<String, int[]> entry : bySeverity.entrySet()) {
            if (entry.getValue()[0] == 0) {
                continue;
            }
            DeliveryNoteResponse.SeverityRow row = new DeliveryNoteResponse.SeverityRow();
            row.setSeverity(entry.getKey());
            row.setSeverityName(severityName(entry.getKey()));
            row.setTotal(entry.getValue()[0]);
            row.setOpen(entry.getValue()[1]);
            d.getBySeverity().add(row);
        }
        Collections.sort(d.getOpen(), new Comparator<DeliveryNoteResponse.DefectRow>() {
            @Override
            public int compare(DeliveryNoteResponse.DefectRow a, DeliveryNoteResponse.DefectRow b) {
                return Integer.compare(DefectMeta.SEVERITIES.indexOf(a.getSeverity()),
                        DefectMeta.SEVERITIES.indexOf(b.getSeverity()));
            }
        });
        d.setTotalCount(total);
        d.setFixedCount(fixed);
        d.setOpenCount(open);
        d.setBlockerOpenCount(blockerOpen);
        d.setMissing(total == 0);
        r.setDefects(d);
    }

    private void fillEffort(DeliveryNoteResponse r, List<Task> bound, Map<String, VersionReleaseItem> publishedItems,
                            Map<String, Integer> minutes, Map<String, String> modules, boolean evidence) {
        DeliveryNoteResponse.Effort e = new DeliveryNoteResponse.Effort();
        Map<String, Integer> byModule = new LinkedHashMap<String, Integer>();
        Map<String, Integer> byMember = new LinkedHashMap<String, Integer>();
        int work = 0;
        int estimate = 0;
        for (Task t : bound) {
            VersionReleaseItem item = evidence ? publishedItems.get(t.getId()) : null;
            int w = item != null ? nz(item.getWorkMinutes()) : nz(minutes.get(t.getId()));
            int est = item != null ? nz(item.getEstimateMinutes()) : nz(t.getEstimateMinutes());
            work += w;
            estimate += est;
            if (w > 0) {
                String module = moduleName(modules, t.getCategoryId());
                byModule.put(module, nz(byModule.get(module)) + w);
                String member = Texts.trimToNull(t.getOwner()) == null ? "待指派" : t.getOwner();
                byMember.put(member, nz(byMember.get(member)) + w);
            }
        }
        e.setWorkMinutes(work);
        e.setEstimateMinutes(estimate);
        e.setDeviationMinutes(work - estimate);
        e.setDeviationPct(estimate == 0 ? null : Math.round((work - estimate) * 1000f / estimate) / 10d);
        e.setMemberCount(byMember.size());
        e.setByModule(bars(byModule, work));
        e.setByMember(bars(byMember, work));
        e.setMissing(work == 0);
        r.setEffort(e);
    }

    private static List<DeliveryNoteResponse.Bar> bars(Map<String, Integer> source, int total) {
        List<Map.Entry<String, Integer>> entries = new ArrayList<Map.Entry<String, Integer>>(source.entrySet());
        Collections.sort(entries, new Comparator<Map.Entry<String, Integer>>() {
            @Override
            public int compare(Map.Entry<String, Integer> a, Map.Entry<String, Integer> b) {
                int byValue = Integer.compare(b.getValue(), a.getValue());
                return byValue != 0 ? byValue : a.getKey().compareTo(b.getKey());
            }
        });
        List<DeliveryNoteResponse.Bar> list = new ArrayList<DeliveryNoteResponse.Bar>();
        for (Map.Entry<String, Integer> entry : entries) {
            DeliveryNoteResponse.Bar bar = new DeliveryNoteResponse.Bar();
            bar.setName(entry.getKey());
            bar.setMinutes(entry.getValue());
            bar.setPct(total == 0 ? 0 : Math.round(entry.getValue() * 100f / total));
            list.add(bar);
        }
        return list;
    }

    private void fillRisksAndAcceptance(DeliveryNoteResponse r, ProjectVersion version, boolean evidence) {
        List<DeliveryNoteResponse.RiskRow> risks = new ArrayList<DeliveryNoteResponse.RiskRow>();
        /* 顺序即优先级：阻塞验收的缺陷 → 缺失的回归 → 其余遗留缺陷 → 部分兑现 → 延后 → 未纳入。
           风险表只列需要单独跟踪的事项，未纳入发布的承诺按状态汇总成一行，逐项清单留在「交付范围」。 */
        List<DeliveryNoteResponse.DefectRow> openDefects = r.getDefects().getOpen();
        for (DeliveryNoteResponse.DefectRow row : openDefects) {
            if (Boolean.TRUE.equals(row.getBlocksAcceptance())) {
                risks.add(defectRisk(row));
            }
        }
        if (Boolean.TRUE.equals(r.getQuality().getMissing())) {
            DeliveryNoteResponse.RiskRow risk = new DeliveryNoteResponse.RiskRow();
            risk.setTitle("回归验证");
            risk.setImpact("本次未创建测试计划");
            risk.setOwner("待指派");
            risk.setNext("发布后补做回归并关联本版本");
            risk.setStatus("未验证");
            risk.setTone("bad");
            risks.add(risk);
        } else if (r.getQuality().getPassRatePct() == null) {
            /* 圈选了用例但全部跳过：分母为 0，没有有效执行，不能当成已验证 */
            DeliveryNoteResponse.RiskRow risk = new DeliveryNoteResponse.RiskRow();
            risk.setTitle("回归验证");
            risk.setImpact("用例全部跳过，没有有效执行结果");
            risk.setOwner("待指派");
            risk.setNext("补做有效执行并把结果关联本版本");
            risk.setStatus("未验证");
            risk.setTone("bad");
            risks.add(risk);
        }
        for (DeliveryNoteResponse.DefectRow row : openDefects) {
            if (!Boolean.TRUE.equals(row.getBlocksAcceptance())) {
                risks.add(defectRisk(row));
            }
        }
        for (DeliveryNoteResponse.DemandRow row : r.getDemands()) {
            if (!"partial".equals(row.getState())) {
                continue;
            }
            DeliveryNoteResponse.RiskRow risk = new DeliveryNoteResponse.RiskRow();
            risk.setRefId(row.getId());
            risk.setTitle(row.getTitle());
            risk.setImpact("部分发布（" + row.getReleasedCount() + " / " + row.getTaskCount() + "）");
            risk.setNext("剩余部分随后续版本发布");
            risk.setStatus("部分发布");
            risk.setTone("pri");
            risks.add(risk);
        }
        addScopeRisks(risks, r.getScope(), "deferred", evidence);
        addScopeRisks(risks, r.getScope(), "pending", evidence);
        r.setRisks(risks);

        DeliveryNoteResponse.Acceptance a = new DeliveryNoteResponse.Acceptance();
        if (evidence) {
            String releaseNo = r.getRelease() == null ? "" : Nos.release(r.getRelease().getReleaseNo());
            a.getBasis().add("生产发布记录 " + (releaseNo.isEmpty() ? r.getReleaseRecordId() : releaseNo)
                    + "（不可变快照，含逐项处理结果）");
        }
        if (r.getBaseline() != null && r.getBaseline().getCapturedAt() != null) {
            a.getBasis().add("承诺基线（开始开发时冻结 " + r.getBaseline().getTaskCount() + " 项）");
        }
        if (!Boolean.TRUE.equals(r.getQuality().getMissing())) {
            int valid = nz(r.getQuality().getExecutedCount()) - nz(r.getQuality().getSkippedCount());
            a.getBasis().add("测试计划执行结果：" + r.getQuality().getPlanName() + "，已执行 "
                    + r.getQuality().getExecutedCount() + " / " + r.getQuality().getCaseCount() + " 条"
                    + (nz(r.getQuality().getSkippedCount()) > 0 ? "（有效执行 " + Math.max(0, valid) + " 条）" : ""));
        }
        if (!r.getChanges().isEmpty()) {
            a.getBasis().add("变更台账 " + r.getChanges().size() + " 条，均含操作人与来源");
        }
        for (DeliveryNoteResponse.DemandRow row : r.getDemands()) {
            if (Texts.trimToNull(row.getAcceptText()) != null && !"deferred".equals(row.getState())) {
                a.getConditions().add(row.getTitle() + "：" + oneLine(row.getAcceptText()));
            }
        }
        a.setBlockerCount(r.getDefects().getBlockerOpenCount());
        if (!evidence) {
            a.setConclusionKind("unverified");
        } else if (nz(r.getDefects().getBlockerOpenCount()) > 0 || Boolean.TRUE.equals(r.getQuality().getMissing())
                || r.getQuality().getPassRatePct() == null
                || nz(r.getCounts().getPending()) > 0 || nz(r.getDemandSummary().getPartial()) > 0) {
            a.setConclusionKind("partial");
        } else {
            a.setConclusionKind("verified");
        }
        a.setSignOffPending(true);
        a.setNote(r.getAcceptanceNote());
        r.setAcceptance(a);
    }

    /** 发布窗口与回滚约定：取本次发布依据的那条计划，没有发布记录时取最近一条未取消的计划。 */
    private void fillPlan(DeliveryNoteResponse r, String workspaceId, String versionId, VersionRelease selected) {
        List<VersionReleasePlan> plans = releaseMapper.selectPlans(workspaceId, versionId);
        if (plans.isEmpty()) {
            return;
        }
        VersionReleasePlan picked = null;
        if (selected != null && Texts.trimToNull(selected.getPlanId()) != null) {
            for (VersionReleasePlan plan : plans) {
                if (plan.getId().equals(selected.getPlanId())) {
                    picked = plan;
                    break;
                }
            }
        }
        if (picked == null) {
            for (VersionReleasePlan plan : plans) {
                if (!"canceled".equals(plan.getStatus())) {
                    picked = plan;
                    break;
                }
            }
        }
        if (picked == null) {
            return;
        }
        DeliveryNoteResponse.PlanInfo info = new DeliveryNoteResponse.PlanInfo();
        info.setId(picked.getId());
        info.setPlannedAt(picked.getPlannedAt());
        info.setStatus(picked.getStatus());
        info.setStatusName(planStatusName(picked.getStatus()));
        info.setEnvironment(picked.getEnvironment());
        info.setEnvironmentName(environmentName(picked.getEnvironment()));
        info.setCoverage(picked.getCoverage());
        info.setTargets(picked.getTargetKeys());
        info.setNotes(Texts.trimToNull(picked.getNotes()));
        info.setRisks(Texts.trimToNull(picked.getRisks()));
        info.setTaskCount(releaseMapper.selectPlannedTaskIds(workspaceId, picked.getId()).size());
        AppUser owner = picked.getOwnerUserId() == null ? null : userMapper.selectById(picked.getOwnerUserId());
        info.setOwnerName(owner == null ? null : Texts.trimToNull(owner.getDisplayName()));
        for (PlanVersionRow row : releaseMapper.selectPlanVersions(workspaceId, picked.getId())) {
            info.getVersionNames().add(row.getProjectName() + " · " + row.getVersionName());
        }
        info.setVersionCount(info.getVersionNames().size());
        r.setPlan(info);
    }

    private static DeliveryNoteResponse.RiskRow defectRisk(DeliveryNoteResponse.DefectRow row) {
        DeliveryNoteResponse.RiskRow risk = new DeliveryNoteResponse.RiskRow();
        risk.setRefId(itemLabel(row.getItemNo(), row.getId()));
        risk.setTitle(row.getTitle() + "（" + row.getSeverityName() + "）");
        risk.setImpact(Boolean.TRUE.equals(row.getBlocksAcceptance()) ? "可能阻塞验收" : "遗留问题，影响有限");
        risk.setOwner(row.getOwner());
        risk.setNext(row.getTargetVersionName() == null ? "待排期修复" : "随 " + row.getTargetVersionName() + " 修复");
        risk.setStatus(row.getRegressionName() == null ? row.getColumnName() : row.getRegressionName());
        risk.setTone(Boolean.TRUE.equals(row.getBlocksAcceptance()) ? "bad" : "");
        return risk;
    }

    /** 超过 6 项就收成一页里的一行：逐项清单在「交付范围」，风险表不重复铺开。 */
    private static void addScopeRisks(List<DeliveryNoteResponse.RiskRow> risks,
                                      List<DeliveryNoteResponse.ScopeRow> scope, String state, boolean evidence) {
        List<DeliveryNoteResponse.ScopeRow> matched = new ArrayList<DeliveryNoteResponse.ScopeRow>();
        for (DeliveryNoteResponse.ScopeRow row : scope) {
            if (state.equals(row.getState())) {
                matched.add(row);
            }
        }
        if (matched.isEmpty()) {
            return;
        }
        boolean deferred = "deferred".equals(state);
        if (matched.size() > 6) {
            DeliveryNoteResponse.RiskRow risk = new DeliveryNoteResponse.RiskRow();
            risk.setTitle(matched.size() + " 项承诺" + (deferred ? "已改到其他版本" : evidence ? "未纳入本次发布" : "尚未确认发布"));
            risk.setImpact("逐项清单见「交付范围」");
            risk.setOwner(join(owners(matched), 3));
            risk.setNext(deferred ? "随各自目标版本发布" : evidence ? "确认后续版本或补录发布" : "完成开发并确认生产发布");
            risk.setStatus(deferred ? "已改版本" : evidence ? "待安排" : "进行中");
            risk.setTone(deferred || evidence ? "warn" : "pri");
            risks.add(risk);
            return;
        }
        for (DeliveryNoteResponse.ScopeRow row : matched) {
            DeliveryNoteResponse.RiskRow risk = new DeliveryNoteResponse.RiskRow();
            risk.setRefId(itemLabel(row.getItemNo(), row.getId()));
            risk.setTitle(row.getTitle());
            risk.setOwner(row.getOwner());
            if (deferred) {
                risk.setImpact("延后至 " + row.getTargetVersionName());
                risk.setNext("随 " + row.getTargetVersionName() + " 发布");
                risk.setStatus("已改版本");
                risk.setTone("warn");
            } else {
                risk.setImpact(evidence ? "本次未纳入发布快照" : "尚未确认生产发布");
                risk.setNext(evidence ? "确认后续版本或补录发布" : "完成开发并确认生产发布");
                risk.setStatus(evidence ? "待安排" : "进行中");
                risk.setTone(evidence ? "warn" : "pri");
            }
            risks.add(risk);
        }
    }

    private static List<String> owners(List<DeliveryNoteResponse.ScopeRow> rows) {
        List<String> names = new ArrayList<String>();
        for (DeliveryNoteResponse.ScopeRow row : rows) {
            String name = Texts.trimToNull(row.getOwner());
            if (name != null && !names.contains(name)) {
                names.add(name);
            }
        }
        return names;
    }

    private void fillEvidence(DeliveryNoteResponse r, ProjectVersion version, VersionRelease selected,
                              List<VersionRelease> records) {
        List<DeliveryNoteResponse.EvidenceRow> list = r.getEvidence();
        if (selected != null) {
            list.add(evidenceRow("发布记录", releaseLabel(selected) + " · " + environmentName(selected.getEnvironment())
                    + " · " + dateTime(selected.getOccurredAt()) + " · " + resultName(selected.getResult())
                    + " · " + nz(selected.getPublishedCount()) + " 项快照", "note",
                    "success".equals(selected.getResult()) ? "ok" : "warn", 0, false, false, "phase", selected.getId()));
        } else {
            list.add(evidenceRow("发布记录", "尚无成功的生产发布记录，本说明为内部草稿", "note", "warn", 0, false, true, "phase", version.getId()));
        }
        list.add(evidenceRow("版本范围快照", version.getName() + " · "
                + (version.getCommitmentAt() == null ? "未冻结承诺基线" : "基线冻结于 " + dateTime(version.getCommitmentAt()))
                + " · 发布后内容只读", "layers", "", 0, false, version.getCommitmentAt() == null, "phase", version.getId()));
        DeliveryNoteResponse.PlanInfo plan = r.getPlan();
        if (plan != null) {
            list.add(evidenceRow("发布计划", plan.getId() + " · " + plan.getEnvironmentName()
                    + " · 窗口 " + (plan.getPlannedAt() == null ? "未定" : dateTime(plan.getPlannedAt()))
                    + " · " + plan.getStatusName() + " · 计划范围 " + nz(plan.getTaskCount()) + " 项",
                    "calendar", "", 1, false, false, "phase", version.getId()));
        }
        DeliveryNoteResponse.Quality q = r.getQuality();
        list.add(evidenceRow("测试报告", Boolean.TRUE.equals(q.getMissing()) ? "未创建测试计划，无可用报告"
                : q.getPlanName() + " · " + q.getCaseCount() + " 条用例 · 通过 " + q.getPassedCount()
                + " / 已执行 " + q.getExecutedCount(), "test",
                Boolean.TRUE.equals(q.getMissing()) ? "warn" : "plum", 1, false, q.getMissing(), "testcases", q.getPlanId()));
        if (!r.getDemands().isEmpty()) {
            List<String> ids = new ArrayList<String>();
            for (DeliveryNoteResponse.DemandRow row : r.getDemands()) {
                ids.add(row.getId());
            }
            list.add(evidenceRow("需求来源", join(ids, 8), "demands", "", 1, false, false, "demands", null));
        }
        list.add(evidenceRow("变更台账", r.getChanges().isEmpty() ? "无变更记录"
                : r.getChanges().size() + " 条变更 · 均含操作人与来源", "swap",
                r.getChanges().isEmpty() ? "warn" : "", 1, false, r.getChanges().isEmpty(), "phase", version.getId()));
        list.add(evidenceRow("工时明细", Boolean.TRUE.equals(r.getEffort().getMissing()) ? "该版本范围内无计时与补记记录"
                : hours(r.getEffort().getWorkMinutes()) + " · " + r.getEffort().getMemberCount() + " 人 · 计时 + 补记",
                "clock", Boolean.TRUE.equals(r.getEffort().getMissing()) ? "warn" : "", 2, true,
                r.getEffort().getMissing(), "report", null));
        if (selected != null && Texts.trimToNull(selected.getArtifactRef()) != null) {
            list.add(evidenceRow("发布制品校验值", selected.getArtifactRef()
                    + (Texts.trimToNull(selected.getArtifactDigest()) == null ? "" : " · SHA256 " + selected.getArtifactDigest()),
                    "lock", "", 2, true, false, "phase", selected.getId()));
        }
        if (records.size() > 1) {
            list.add(evidenceRow("发布尝试历史", "共 " + records.size() + " 次记录，含失败与回滚，可逐条回溯",
                    "note", "", 2, true, false, "phase", version.getId()));
        }
    }

    private static DeliveryNoteResponse.EvidenceRow evidenceRow(String name, String meta, String icon, String color,
                                                                int level, boolean internal, boolean missing,
                                                                String view, String refId) {
        DeliveryNoteResponse.EvidenceRow row = new DeliveryNoteResponse.EvidenceRow();
        row.setName(name);
        row.setMeta(meta);
        row.setIcon(icon);
        row.setColor(color);
        row.setLevel(level);
        row.setInternal(internal);
        row.setMissing(missing);
        row.setView(view);
        row.setRefId(refId);
        return row;
    }

    private void fillCalibers(DeliveryNoteResponse r) {
        List<DeliveryNoteResponse.CaliberRow> list = r.getCalibers();
        list.add(caliber("承诺台账", "当前绑定本版本的工作项 + 承诺基线内已移出的工作项；移出项保留并标注去向",
                "version_task / version_commitment_task"));
        list.add(caliber("已发布", "选中发布记录快照中处理结果为「已发布」的工作项数，不取当前完成状态",
                "version_release_item.disposition = published"));
        list.add(caliber("需求兑现率", "关联工作项全部纳入发布快照的需求数 / 本次涉及需求总数",
                "demand + version_release_item"));
        list.add(caliber("回归通过率", "通过 / （已执行 − 跳过）；跳过表示本次不适用，不计入分母",
                "test_plan_case.result"));
        list.add(caliber("执行覆盖", "已执行 / 圈选用例总数", "test_plan_case"));
        list.add(caliber("实际投入", "版本范围内工作项的计时 + 补记合计；有发布快照时取快照内工时，不用于计费结算",
                "time_log / version_release_item.work_minutes"));
        list.add(caliber("工时偏差", "（实际投入 − 预估工时）/ 预估工时；预估为 0 时不给偏差率",
                "task.estimate_minutes"));
        list.add(caliber("未关闭缺陷", "发现版本或计划版本指向本版本、且当前不在「已完成」列的缺陷",
                "task.item_type = bug"));
        list.add(caliber("阻塞验收", "未关闭且严重度为阻断 / 严重的缺陷；一般与轻微不阻塞",
                "task.severity"));
        list.add(caliber("发布延迟", "实际发布日 − 目标就绪日（自然日）；无目标日时不给延迟",
                "version_release.published_on / project_version.target_date"));
    }

    private static DeliveryNoteResponse.CaliberRow caliber(String name, String definition, String source) {
        DeliveryNoteResponse.CaliberRow row = new DeliveryNoteResponse.CaliberRow();
        row.setName(name);
        row.setDefinition(definition);
        row.setSource(source);
        return row;
    }

    private void collectMissing(DeliveryNoteResponse r) {
        List<String> missing = r.getMissing();
        if (!"release_snapshot".equals(r.getEvidenceKind())) {
            missing.add("未确认成功的生产发布：本文档为内部草稿，客户版不可导出与分享");
        }
        if (r.getBaseline() == null || r.getBaseline().getCapturedAt() == null) {
            missing.add("未冻结承诺基线：无法给出「最初承诺 vs 现在」的对照");
        } else if (Boolean.TRUE.equals(r.getBaseline().getLate())) {
            missing.add("承诺基线建立晚于发布日：此前变更没有对照，不反推原因");
        }
        if (Boolean.TRUE.equals(r.getQuality().getMissing())) {
            missing.add("未创建测试计划或未圈选用例：没有通过率与执行覆盖，不推断质量水平");
        } else if (r.getQuality().getPassRatePct() == null) {
            missing.add("回归用例全部跳过：没有有效执行结果，不推断质量水平");
        }
        if (Boolean.TRUE.equals(r.getEffort().getMissing())) {
            missing.add("版本范围内没有计时与补记：投入无法给出，不用完成数量或预估反推");
        }
        if (Boolean.TRUE.equals(r.getDefects().getMissing())) {
            missing.add("没有与本版本关联的缺陷记录：已知问题清单为空，不代表没有质量问题");
        }
        if (r.getDemands().isEmpty()) {
            missing.add("本次交付未关联需求池条目：无法给出需求兑现率");
        }
    }

    /* ==================== 人工层 ==================== */

    @Transactional
    public DeliveryNoteResponse save(String workspaceId, String userId, String versionId,
                                     DeliveryNoteSaveRequest req) {
        ProjectVersion version = requireVersion(workspaceId, versionId);
        projectAccess.assertWrite(workspaceId, userId, version.getReqId());
        DeliveryNote current = noteMapper.selectByVersionForUpdate(workspaceId, versionId);
        long expected = current == null ? 0L : nz(current.getRevision());
        if (req.getRevision() != null && req.getRevision() != expected) {
            throw new AppException(409, "交付说明已被他人修改，请刷新后重试");
        }
        DeliveryNote note = new DeliveryNote();
        note.setWorkspaceId(workspaceId);
        note.setVersionId(versionId);
        note.setReqId(version.getReqId());
        note.setAudience(cut(req.getAudience(), 120));
        note.setSupportContact(cut(req.getSupportContact(), 200));
        note.setAcceptance(cut(req.getAcceptanceNote(), 1000));
        note.setOptions(writeJson(sanitizeOptions(req.getOptions(), current)));
        note.setNarratives(writeJson(sanitizeNarratives(req.getNarratives())));
        note.setConfirmed(writeJson(sanitizeConfirmed(req.getConfirmed())));
        note.setUpdatedBy(userId);
        noteMapper.upsert(note);
        return aggregate(workspaceId, userId, versionId, null);
    }

    private Map<String, Object> sanitizeOptions(Map<String, Object> incoming, DeliveryNote current) {
        Map<String, Object> options = defaultOptions();
        if (current != null) {
            options.putAll(readMap(current.getOptions()));
        }
        if (incoming == null) {
            return options;
        }
        for (Map.Entry<String, Object> entry : incoming.entrySet()) {
            if (options.containsKey(entry.getKey()) && entry.getValue() != null) {
                options.put(entry.getKey(), entry.getValue());
            }
        }
        if (!TONES.contains(str(options.get("tone")))) {
            options.put("tone", "customer");
        }
        String releaseId = cut(str(options.get("releaseId")), 64);
        options.put("releaseId", releaseId == null ? "" : releaseId);
        return options;
    }

    private Map<String, String> sanitizeNarratives(Map<String, String> incoming) {
        Map<String, String> out = new LinkedHashMap<String, String>();
        if (incoming == null) {
            return out;
        }
        List<String> allowed = Arrays.asList("summary", "change", "issue", "acceptance", "internal", "note");
        for (Map.Entry<String, String> entry : incoming.entrySet()) {
            if (!allowed.contains(entry.getKey())) {
                continue;
            }
            String value = cut(entry.getValue(), MAX_NARRATIVE);
            if (value != null) {
                out.put(entry.getKey(), value);
            }
        }
        return out;
    }

    private List<String> sanitizeConfirmed(List<String> incoming) {
        List<String> out = new ArrayList<String>();
        if (incoming == null) {
            return out;
        }
        for (String key : incoming) {
            if (CONFIRM_KEYS.contains(key) && !out.contains(key)) {
                out.add(key);
            }
        }
        return out;
    }

    public static Map<String, Object> defaultOptions() {
        Map<String, Object> o = new LinkedHashMap<String, Object>();
        o.put("tone", "customer");
        o.put("releaseId", "");
        o.put("includeUnreleased", true);
        o.put("granularity", "module");
        o.put("showChanges", true);
        o.put("showEffort", false);
        o.put("effortDim", "module");
        o.put("evidence", 1);
        o.put("verbosity", 1);
        o.put("density", "cozy");
        o.put("brand", true);
        o.put("watermark", false);
        o.put("showDemands", true);
        o.put("showDefects", true);
        o.put("showRelease", true);
        o.put("showAcceptance", true);
        o.put("showSupport", true);
        o.put("showCaliber", false);
        o.put("showRevisions", false);
        return o;
    }

    /* ==================== 不可变快照 ==================== */

    @Transactional
    public DeliveryNoteResponse createSnapshot(String workspaceId, String userId, String versionId,
                                               DeliveryNoteSaveRequest req) {
        ProjectVersion version = requireVersion(workspaceId, versionId);
        projectAccess.assertWrite(workspaceId, userId, version.getReqId());
        if (req != null) {
            save(workspaceId, userId, versionId, req);
        }
        DeliveryNote note = noteMapper.selectByVersion(workspaceId, versionId);
        List<VersionRelease> records = releaseMapper.selectRecords(workspaceId, versionId);
        VersionRelease selected = pickRelease(records, wantedRelease(null, note));
        String tone = note == null ? "customer" : toneOf(readMap(note.getOptions()));
        if ("customer".equals(tone) && !isDeliveryEvidence(selected)) {
            throw new AppException(422, "未确认成功的生产发布，客户版不可导出；请切到管理版或内部版");
        }
        DeliveryNoteResponse payload = build(workspaceId, userId, version, note, records, selected);
        payload.setCanEdit(false);
        payload.setCanSnapshot(false);
        payload.setCanShare(false);
        payload.setLocked(true);
        stripForTone(payload, tone);

        /* 先锁住该版本既有快照，避免并发导出取到同一个 seq 撞唯一键 */
        noteMapper.selectSnapshotIdsByVersion(workspaceId, versionId);
        Integer maxSeq = noteMapper.selectMaxSeq(workspaceId, versionId);
        int seq = maxSeq == null ? 1 : maxSeq + 1;
        String docNo = "DS-" + LocalDate.now().format(DOC_DAY) + "-" + String.format("%02d", seq);
        payload.setDocNo(docNo);
        String body = writeJson(payload);

        DeliveryNoteSnapshot snapshot = new DeliveryNoteSnapshot();
        snapshot.setId(Ids.gen("DN"));
        snapshot.setWorkspaceId(workspaceId);
        snapshot.setVersionId(versionId);
        snapshot.setReqId(version.getReqId());
        snapshot.setReleaseId(selected == null ? null : selected.getId());
        snapshot.setSeq(seq);
        snapshot.setDocNo(docNo);
        snapshot.setTone(tone);
        snapshot.setPayload(body);
        snapshot.setContentHash(sha256(body));
        snapshot.setTitle(payload.getProjectName() + " · " + payload.getVersionName());
        snapshot.setCreatedBy(userId);
        AppUser user = userMapper.selectById(userId);
        snapshot.setCreatedByName(user == null ? null : user.getDisplayName());
        if (noteMapper.insertSnapshot(snapshot) != 1) {
            throw new AppException(409, "快照编号冲突，请重试");
        }
        payload.setSnapshotId(snapshot.getId());
        payload.setSnapshotSeq(seq);
        payload.setContentHash(snapshot.getContentHash());
        payload.setGeneratedAt(snapshot.getCreatedAt() == null ? LocalDateTime.now() : snapshot.getCreatedAt());
        payload.setRevisions(revisions(workspaceId, versionId));
        return payload;
    }

    /** 语气投影落到数据层：客户版快照物理不含成员明细、制品校验值与内部备注，分享链接拿不到 */
    private void stripForTone(DeliveryNoteResponse payload, String tone) {
        if (!"internal".equals(tone)) {
            payload.getNarratives().remove("internal");
        }
        if ("customer".equals(tone)) {
            payload.getEffort().setByMember(new ArrayList<DeliveryNoteResponse.Bar>());
            if (payload.getRelease() != null) {
                /* 制品坐标与部署目标是内部运行信息，客户版只给发布记录本身 */
                payload.getRelease().setArtifactDigest(null);
                payload.getRelease().setArtifactRef(null);
                payload.getRelease().setTargets(new ArrayList<String>());
            }
            List<DeliveryNoteResponse.EvidenceRow> kept = new ArrayList<DeliveryNoteResponse.EvidenceRow>();
            for (DeliveryNoteResponse.EvidenceRow row : payload.getEvidence()) {
                if (!Boolean.TRUE.equals(row.getInternal())) {
                    kept.add(row);
                }
            }
            payload.setEvidence(kept);
            for (DeliveryNoteResponse.DefectRow row : payload.getDefects().getOpen()) {
                row.setOwner(null);
            }
            for (DeliveryNoteResponse.DefectRow row : payload.getDefects().getFixed()) {
                row.setOwner(null);
            }
            for (DeliveryNoteResponse.RiskRow row : payload.getRisks()) {
                row.setOwner(null);
            }
            if (payload.getPlan() != null) {
                payload.getPlan().setOwnerName(null);
                /* 计划里的部署目标与发布记录同源，都是机房主机键，客户版同样物理剔除 */
                payload.getPlan().setTargets(new ArrayList<String>());
            }
        }
    }

    public DeliveryNoteResponse snapshotDetail(String workspaceId, String userId, String snapshotId) {
        DeliveryNoteSnapshot snapshot = requireSnapshot(workspaceId, snapshotId);
        projectAccess.assertView(workspaceId, userId, snapshot.getReqId());
        return frozen(snapshot);
    }

    private DeliveryNoteResponse frozen(DeliveryNoteSnapshot snapshot) {
        DeliveryNoteResponse payload;
        try {
            payload = json.readValue(snapshot.getPayload(), DeliveryNoteResponse.class);
        } catch (Exception ex) {
            throw new AppException(500, "快照内容解析失败：" + snapshot.getDocNo());
        }
        payload.setLocked(true);
        payload.setCanEdit(false);
        payload.setCanSnapshot(false);
        payload.setSnapshotId(snapshot.getId());
        payload.setSnapshotSeq(snapshot.getSeq());
        payload.setContentHash(snapshot.getContentHash());
        payload.setDocNo(snapshot.getDocNo());
        DeliveryNoteShare share = noteMapper.selectShareBySnapshot(snapshot.getWorkspaceId(), snapshot.getId());
        payload.setCanShare(share != null && !expired(share) && !"internal".equals(snapshot.getTone()));
        return payload;
    }

    public List<DeliveryNoteResponse.RevisionRow> revisions(String workspaceId, String versionId) {
        List<DeliveryNoteResponse.RevisionRow> rows = new ArrayList<DeliveryNoteResponse.RevisionRow>();
        for (DeliveryNoteSnapshot snapshot : noteMapper.selectSnapshotsByVersion(workspaceId, versionId)) {
            DeliveryNoteResponse.RevisionRow row = new DeliveryNoteResponse.RevisionRow();
            row.setId(snapshot.getId());
            row.setDocNo(snapshot.getDocNo());
            row.setSeq(snapshot.getSeq());
            row.setTone(snapshot.getTone());
            row.setCreatedByName(snapshot.getCreatedByName());
            row.setCreatedAt(snapshot.getCreatedAt());
            row.setContentHash(snapshot.getContentHash());
            row.setShared(noteMapper.selectShareBySnapshot(workspaceId, snapshot.getId()) != null);
            rows.add(row);
        }
        return rows;
    }

    /* ==================== 只读分享 ==================== */

    public DeliveryShareResponse shareInfo(String workspaceId, String userId, String snapshotId) {
        DeliveryNoteSnapshot snapshot = requireSnapshot(workspaceId, snapshotId);
        projectAccess.assertView(workspaceId, userId, snapshot.getReqId());
        DeliveryNoteShare share = noteMapper.selectShareBySnapshot(workspaceId, snapshotId);
        if (share == null || expired(share)) {
            return null;
        }
        return shareView(snapshot, share);
    }

    @Transactional
    public DeliveryShareResponse createShare(String workspaceId, String userId, String snapshotId,
                                             Boolean allowDownload, Integer days) {
        DeliveryNoteSnapshot snapshot = requireSnapshot(workspaceId, snapshotId);
        projectAccess.assertWrite(workspaceId, userId, snapshot.getReqId());
        if ("internal".equals(snapshot.getTone())) {
            throw new AppException(422, "内部版含内部备注，不能对外分享；请重新生成客户版或管理版快照");
        }
        DeliveryNoteShare share = new DeliveryNoteShare();
        share.setWorkspaceId(workspaceId);
        share.setSnapshotId(snapshotId);
        share.setToken(Ids.genToken());
        share.setAllowDownload(allowDownload == null || allowDownload);
        int effectiveDays = days == null ? SHARE_DAYS : Math.max(1, Math.min(365, days));
        share.setExpiresAt(LocalDateTime.now().plusDays(effectiveDays));
        noteMapper.upsertShare(share);
        return shareView(snapshot, noteMapper.selectShareBySnapshot(workspaceId, snapshotId));
    }

    @Transactional
    public void revokeShare(String workspaceId, String userId, String snapshotId) {
        DeliveryNoteSnapshot snapshot = requireSnapshot(workspaceId, snapshotId);
        projectAccess.assertWrite(workspaceId, userId, snapshot.getReqId());
        noteMapper.deleteShare(workspaceId, snapshotId);
    }

    /** 公开只读：按 token 取冻结载荷，无效或过期一律 404，不泄露空间与版本是否存在 */
    @Transactional
    public PublicDeliveryNote publicShare(String token) {
        if (Texts.trimToNull(token) == null) {
            throw AppException.notFound("分享链接无效或已过期");
        }
        DeliveryNoteShare share = noteMapper.selectShareByToken(token.trim());
        if (share == null || expired(share)) {
            throw AppException.notFound("分享链接无效或已过期");
        }
        DeliveryNoteSnapshot snapshot = noteMapper.selectSnapshotById(share.getSnapshotId());
        if (snapshot == null || !snapshot.getWorkspaceId().equals(share.getWorkspaceId())
                || "internal".equals(snapshot.getTone())) {
            throw AppException.notFound("分享链接无效或已过期");
        }
        DeliveryNoteResponse payload = frozen(snapshot);
        /* 双保险：即使历史快照里残留内部字段，公开出口再剥一次 */
        stripForTone(payload, snapshot.getTone());
        payload.setCanShare(false);
        payload.setRevision(null);
        payload.setRevisions(new ArrayList<DeliveryNoteResponse.RevisionRow>());
        Workspace ws = workspaceMapper.selectById(share.getWorkspaceId());
        PublicDeliveryNote out = new PublicDeliveryNote();
        out.setWorkspaceName(ws == null ? null : ws.getName());
        out.setDocNo(snapshot.getDocNo());
        out.setTitle(snapshot.getTitle());
        out.setTone(snapshot.getTone());
        out.setContentHash(snapshot.getContentHash());
        out.setCreatedAt(snapshot.getCreatedAt());
        out.setExpiresAt(share.getExpiresAt());
        out.setAllowDownload(share.getAllowDownload());
        out.setNote(payload);
        noteMapper.increaseViewCount(share.getWorkspaceId(), share.getSnapshotId());
        return out;
    }

    private DeliveryShareResponse shareView(DeliveryNoteSnapshot snapshot, DeliveryNoteShare share) {
        DeliveryShareResponse out = new DeliveryShareResponse();
        out.setSnapshotId(snapshot.getId());
        out.setDocNo(snapshot.getDocNo());
        out.setToken(share.getToken());
        out.setAllowDownload(share.getAllowDownload());
        out.setViewCount(share.getViewCount());
        out.setCreatedAt(share.getCreatedAt());
        out.setExpiresAt(share.getExpiresAt());
        return out;
    }

    private static boolean expired(DeliveryNoteShare share) {
        return share.getExpiresAt() != null && share.getExpiresAt().isBefore(LocalDateTime.now());
    }

    /* ==================== 发布记录 ==================== */

    /** 编制时选定的发布记录随草稿保存，导出快照才会冻结同一条依据；空串表示自动取最近一次成功生产发布 */
    private String wantedRelease(String releaseId, DeliveryNote note) {
        if (Texts.trimToNull(releaseId) != null) {
            return releaseId;
        }
        return note == null ? null : str(readMap(note.getOptions()).get("releaseId"));
    }

    private VersionRelease pickRelease(List<VersionRelease> records, String releaseId) {
        if (Texts.trimToNull(releaseId) != null && !"none".equals(releaseId)) {
            for (VersionRelease record : records) {
                if (record.getId().equals(releaseId)) {
                    return record;
                }
            }
            throw AppException.notFound("发布记录不存在：" + releaseId);
        }
        VersionRelease best = null;
        for (VersionRelease record : records) {
            if (!isDeliveryEvidence(record)) {
                continue;
            }
            if (best == null || compareRelease(record, best) > 0) {
                best = record;
            }
        }
        return best;
    }

    private static int compareRelease(VersionRelease a, VersionRelease b) {
        LocalDateTime ta = a.getOccurredAt() == null ? a.getRecordedAt() : a.getOccurredAt();
        LocalDateTime tb = b.getOccurredAt() == null ? b.getRecordedAt() : b.getOccurredAt();
        if (ta != null && tb != null && !ta.equals(tb)) {
            return ta.compareTo(tb);
        }
        if (ta == null && tb != null) {
            return -1;
        }
        if (ta != null && tb == null) {
            return 1;
        }
        return a.getId().compareTo(b.getId());
    }

    private static boolean isDeliveryEvidence(VersionRelease record) {
        return record != null && "success".equals(record.getResult())
                && "production".equals(record.getEnvironment()) && !"rollback".equals(record.getOperation());
    }

    private List<DeliveryNoteResponse.ReleaseOption> releaseOptions(List<VersionRelease> records) {
        List<DeliveryNoteResponse.ReleaseOption> list = new ArrayList<DeliveryNoteResponse.ReleaseOption>();
        List<VersionRelease> sorted = new ArrayList<VersionRelease>(records);
        Collections.sort(sorted, new Comparator<VersionRelease>() {
            @Override
            public int compare(VersionRelease a, VersionRelease b) {
                return compareRelease(b, a);
            }
        });
        for (VersionRelease record : sorted) {
            DeliveryNoteResponse.ReleaseOption option = new DeliveryNoteResponse.ReleaseOption();
            option.setId(record.getId());
            option.setReleaseNo(record.getReleaseNo());
            option.setEnvironment(record.getEnvironment());
            option.setEnvironmentName(environmentName(record.getEnvironment()));
            option.setResult(record.getResult());
            option.setOperation(record.getOperation());
            option.setPublishedOn(record.getPublishedOn());
            option.setOccurredAt(record.getOccurredAt());
            option.setItemCount(nz(record.getPublishedCount()));
            option.setProduction("production".equals(record.getEnvironment()));
            option.setSuccess("success".equals(record.getResult()));
            option.setDeliveryEvidence(isDeliveryEvidence(record));
            option.setLabel(releaseLabel(record) + " · " + option.getEnvironmentName() + " · "
                    + dateTime(record.getOccurredAt()) + " · " + resultName(record.getResult())
                    + ("rollback".equals(record.getOperation()) ? "（回滚）" : "")
                    + " · " + option.getItemCount() + " 项");
            list.add(option);
        }
        return list;
    }

    private DeliveryNoteResponse.ReleaseInfo releaseInfo(VersionRelease record, List<VersionRelease> records,
                                                         LocalDate targetDate) {
        int attempts = records.size();
        int success = 0;
        int rollback = 0;
        for (VersionRelease item : records) {
            if ("success".equals(item.getResult())) {
                success++;
            }
            if ("rollback".equals(item.getOperation())) {
                rollback++;
            }
        }
        if (record == null) {
            return null;
        }
        DeliveryNoteResponse.ReleaseInfo info = new DeliveryNoteResponse.ReleaseInfo();
        info.setId(record.getId());
        info.setReleaseNo(record.getReleaseNo());
        info.setEnvironment(record.getEnvironment());
        info.setEnvironmentName(environmentName(record.getEnvironment()));
        info.setResult(record.getResult());
        info.setOperation(record.getOperation());
        info.setOperationName(operationName(record.getOperation()));
        info.setCoverage(record.getCoverage());
        info.setPublishedOn(record.getPublishedOn());
        info.setOccurredAt(record.getOccurredAt());
        info.setRecordedAt(record.getRecordedAt());
        info.setTargets(record.getTargetKeys() == null ? new ArrayList<String>() : record.getTargetKeys());
        info.setArtifactRef(record.getArtifactRef());
        info.setArtifactDigest(record.getArtifactDigest());
        info.setExecutorName(record.getExecutorName());
        info.setReleasedByName(record.getReleasedByName());
        info.setDeviationReason(record.getDeviationReason());
        info.setFailureReason(record.getFailureReason());
        info.setNotes(record.getNotes());
        info.setRelatedReleaseId(record.getRelatedReleaseId());
        if (record.getRelatedReleaseId() != null) {
            info.setRelatedReleaseNo(releaseMapper.selectReleaseNo(record.getWorkspaceId(), record.getRelatedReleaseId()));
        }
        info.setPublishedCount(nz(record.getPublishedCount()));
        info.setExcludedCount(nz(record.getExcludedCount()));
        info.setAttemptCount(attempts);
        info.setSuccessCount(success);
        info.setRollbackCount(rollback);
        if (targetDate != null && record.getPublishedOn() != null) {
            info.setDelayDays((int) ChronoUnit.DAYS.between(targetDate, record.getPublishedOn()));
        }
        return info;
    }

    /* ==================== 工具 ==================== */

    /** 对外展示优先用项目内编号；未取号才回退原 ID，不编造编号 */
    private static String itemLabel(Task t) {
        return itemLabel(t.getItemNo(), t.getId());
    }

    private static String itemLabel(Integer itemNo, String id) {
        String no = Nos.workItem(itemNo);
        return no.isEmpty() ? id : no;
    }

    private static String releaseLabel(VersionRelease record) {
        String no = Nos.release(record.getReleaseNo());
        return no.isEmpty() ? record.getId() : no;
    }

    private ProjectVersion requireVersion(String workspaceId, String versionId) {
        ProjectVersion version = versionMapper.selectById(versionId);
        if (version == null || !workspaceId.equals(version.getWorkspaceId())) {
            throw AppException.notFound("版本不存在：" + versionId);
        }
        return version;
    }

    private DeliveryNoteSnapshot requireSnapshot(String workspaceId, String snapshotId) {
        DeliveryNoteSnapshot snapshot = noteMapper.selectSnapshotById(snapshotId);
        if (snapshot == null || !workspaceId.equals(snapshot.getWorkspaceId())) {
            throw AppException.notFound("交付说明快照不存在：" + snapshotId);
        }
        return snapshot;
    }

    private String nextDocNo(String workspaceId, String versionId) {
        Integer maxSeq = noteMapper.selectMaxSeq(workspaceId, versionId);
        int seq = maxSeq == null ? 1 : maxSeq + 1;
        return "DS-" + LocalDate.now().format(DOC_DAY) + "-" + String.format("%02d", seq);
    }

    private String resolveOwner(Requirement project, String userId) {
        String id = project == null ? null : project.getOwnerUserId();
        if (id == null) {
            id = userId;
        }
        AppUser user = id == null ? null : userMapper.selectById(id);
        return user == null || Texts.trimToNull(user.getDisplayName()) == null ? "未指派" : user.getDisplayName();
    }

    private Map<String, Integer> taskMinutes(String workspaceId, List<Task> tasks) {
        Map<String, Integer> map = new LinkedHashMap<String, Integer>();
        if (tasks.isEmpty()) {
            return map;
        }
        List<String> ids = new ArrayList<String>();
        for (Task t : tasks) {
            ids.add(t.getId());
        }
        for (int from = 0; from < ids.size(); from += 500) {
            for (TimeAgg agg : timeLogMapper.sumByTaskIds(workspaceId, ids.subList(from, Math.min(from + 500, ids.size())))) {
                map.put(agg.getTaskId(), nz(agg.getTotalMinutes()));
            }
        }
        return map;
    }

    private Map<String, String> moduleNames(String workspaceId) {
        Map<String, String> map = new LinkedHashMap<String, String>();
        for (Category category : categoryMapper.selectByWorkspace(workspaceId)) {
            map.put(category.getId(), category.getName());
        }
        return map;
    }

    private static String moduleName(Map<String, String> modules, String categoryId) {
        String name = categoryId == null ? null : modules.get(categoryId);
        return name == null ? "未分模块" : name;
    }

    private static String toneOf(Map<String, Object> options) {
        String tone = str(options.get("tone"));
        return TONES.contains(tone) ? tone : "customer";
    }

    private Map<String, Object> readMap(String raw) {
        if (Texts.trimToNull(raw) == null) {
            return new LinkedHashMap<String, Object>();
        }
        try {
            return json.readValue(raw, new TypeReference<LinkedHashMap<String, Object>>() { });
        } catch (Exception ex) {
            return new LinkedHashMap<String, Object>();
        }
    }

    private Map<String, String> readStringMap(String raw) {
        Map<String, String> out = new LinkedHashMap<String, String>();
        for (Map.Entry<String, Object> entry : readMap(raw).entrySet()) {
            if (entry.getValue() != null) {
                out.put(entry.getKey(), String.valueOf(entry.getValue()));
            }
        }
        return out;
    }

    private List<String> readList(String raw) {
        if (Texts.trimToNull(raw) == null) {
            return new ArrayList<String>();
        }
        try {
            return json.readValue(raw, new TypeReference<ArrayList<String>>() { });
        } catch (Exception ex) {
            return new ArrayList<String>();
        }
    }

    private String writeJson(Object value) {
        try {
            return json.writeValueAsString(value);
        } catch (Exception ex) {
            throw new AppException(500, "交付说明内容序列化失败");
        }
    }

    private static String sha256(String text) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] bytes = digest.digest(text.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(bytes.length * 2);
            for (byte b : bytes) {
                sb.append(Character.forDigit((b >> 4) & 0xF, 16)).append(Character.forDigit(b & 0xF, 16));
            }
            return sb.toString();
        } catch (Exception ex) {
            throw new AppException(500, "内容校验值计算失败");
        }
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> asMap(Object value) {
        return value instanceof Map ? (Map<String, Object>) value : new LinkedHashMap<String, Object>();
    }

    private static String str(Object value) {
        return value == null ? null : Texts.trimToNull(String.valueOf(value));
    }

    private static LocalDate toDate(Object value) {
        if (value instanceof LocalDateTime) {
            return ((LocalDateTime) value).toLocalDate();
        }
        if (value instanceof LocalDate) {
            return (LocalDate) value;
        }
        if (value instanceof java.sql.Timestamp) {
            return ((java.sql.Timestamp) value).toLocalDateTime().toLocalDate();
        }
        String raw = str(value);
        if (raw == null || raw.length() < 10) {
            return null;
        }
        try {
            return LocalDate.parse(raw.substring(0, 10));
        } catch (Exception ex) {
            return null;
        }
    }

    private static String dateTime(LocalDateTime value) {
        return value == null ? "未记录" : value.format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm"));
    }

    private static String join(List<String> values, int limit) {
        if (values.isEmpty()) {
            return "无";
        }
        List<String> head = values.subList(0, Math.min(limit, values.size()));
        return String.join(" / ", head) + (values.size() > limit ? " 等 " + values.size() + " 项" : "");
    }

    private static String hours(Integer minutes) {
        int value = nz(minutes);
        if (value == 0) {
            return "0h";
        }
        float h = value / 60f;
        return (Math.abs(h - Math.rint(h)) < 0.05 ? String.valueOf((int) Math.rint(h)) : String.format("%.1f", h)) + "h";
    }

    private static String cut(String raw, int max) {
        String value = Texts.trimToNull(raw);
        return value == null ? null : value.length() <= max ? value : value.substring(0, max);
    }

    private static int nz(Integer value) {
        return value == null ? 0 : value;
    }

    private static long nz(Long value) {
        return value == null ? 0L : value;
    }

    private static String typeName(String itemType) {
        if ("story".equals(itemType)) {
            return "用户故事";
        }
        if ("bug".equals(itemType)) {
            return "缺陷";
        }
        if ("epic".equals(itemType)) {
            return "史诗";
        }
        return "任务";
    }

    private static String columnName(String column) {
        if (Consts.COL_DOING.equals(column)) {
            return "进行中";
        }
        if (Consts.COL_TEST.equals(column)) {
            return "待测试";
        }
        if (Consts.COL_TESTING.equals(column)) {
            return "测试中";
        }
        if (Consts.COL_DONE.equals(column)) {
            return "已完成";
        }
        return "待处理";
    }

    private static String severityName(String severity) {
        if (DefectMeta.SEVERITY_BLOCKER.equals(severity)) {
            return "阻断";
        }
        if (DefectMeta.SEVERITY_CRITICAL.equals(severity)) {
            return "严重";
        }
        if (DefectMeta.SEVERITY_MINOR.equals(severity)) {
            return "轻微";
        }
        return "一般";
    }

    private static String regressionName(String status) {
        if (DefectMeta.REGRESSION_PASSED.equals(status)) {
            return "回归通过";
        }
        if (DefectMeta.REGRESSION_FAILED.equals(status)) {
            return "回归不通过";
        }
        if (DefectMeta.REGRESSION_PENDING.equals(status)) {
            return "待回归";
        }
        return null;
    }

    /** 变更台账对外可读：日志动作码只留在 source 里，标题与标签一律用中文。 */
    private static String actionName(String action) {
        if (action == null) {
            return "版本记录调整";
        }
        if ("version_update".equals(action) || "update".equals(action)) {
            return "版本信息调整";
        }
        if ("version_scope".equals(action) || "scope".equals(action)) {
            return "交付范围调整";
        }
        if ("version_start".equals(action) || "start".equals(action)) {
            return "开始开发";
        }
        if ("version_close".equals(action) || "close".equals(action)) {
            return "版本关闭";
        }
        if ("version_cancel".equals(action) || "cancel".equals(action)) {
            return "版本取消";
        }
        if ("release_plan".equals(action)) {
            return "发布计划调整";
        }
        if ("release".equals(action) || "version_release".equals(action)) {
            return "版本发布";
        }
        if ("release_success".equals(action)) {
            return "发布成功";
        }
        if ("release_failed".equals(action)) {
            return "发布失败";
        }
        if ("release_rollback".equals(action)) {
            return "执行回滚";
        }
        if ("version_create".equals(action) || "create".equals(action)) {
            return "版本创建";
        }
        return "版本记录调整";
    }

    private static String coverageName(String coverage) {
        if ("full".equals(coverage)) {
            return "全量";
        }
        if ("partial".equals(coverage)) {
            return "部分";
        }
        return "覆盖未知";
    }

    private static String planStatusName(String status) {
        if ("draft".equals(status)) {
            return "草稿";
        }
        if ("ready".equals(status)) {
            return "已就绪";
        }
        if ("completed".equals(status)) {
            return "已完成";
        }
        if ("canceled".equals(status)) {
            return "已取消";
        }
        return status;
    }

    /** 验收标准是多行编号文本，压成一段完整句子，避免一页纸里出现整块换行墙。 */
    private static String oneLine(String raw) {
        String value = Texts.trimToNull(raw);
        return value == null ? null : value.replaceAll("\\s*[\r\n]+\\s*", " ").replaceAll("[ \\t]{2,}", " ").trim();
    }

    /** 日志里的 ISO 时间串去掉秒与 T，避免对外文档出现 2026-11-25T20:00:00。 */
    private static String plainDateTime(String raw) {
        String value = raw.replace('T', ' ');
        return value.length() >= 16 ? value.substring(0, 16) : value;
    }

    private static String environmentName(String environment) {
        if ("production".equals(environment)) {
            return "生产";
        }
        if ("staging".equals(environment)) {
            return "预发";
        }
        if ("test".equals(environment)) {
            return "测试";
        }
        return environment == null ? "未记录" : environment;
    }

    private static String resultName(String result) {
        if ("success".equals(result)) {
            return "成功";
        }
        if ("failed".equals(result)) {
            return "失败";
        }
        return result == null ? "未记录" : result;
    }

    private static String operationName(String operation) {
        if ("deploy".equals(operation)) {
            return "部署";
        }
        if ("redeploy".equals(operation)) {
            return "重部署";
        }
        if ("rollback".equals(operation)) {
            return "回滚";
        }
        return operation == null ? "未记录" : operation;
    }
}