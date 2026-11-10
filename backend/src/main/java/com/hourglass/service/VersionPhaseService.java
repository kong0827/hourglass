package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.common.Consts;
import com.hourglass.dto.PhaseMemberTask;
import com.hourglass.dto.PhaseMemberTaskPage;
import com.hourglass.dto.PhaseMemberTaskSummary;
import com.hourglass.dto.PhaseStatsResponse;
import com.hourglass.dto.ReleaseNoteResponse;
import com.hourglass.dto.UserDayRow;
import com.hourglass.dto.VersionOverviewResponse;
import com.hourglass.dto.VersionStatsResponse;
import com.hourglass.entity.AppUser;
import com.hourglass.entity.Demand;
import com.hourglass.entity.DevBranch;
import com.hourglass.entity.ProjectVersion;
import com.hourglass.entity.Requirement;
import com.hourglass.entity.Task;
import com.hourglass.entity.VersionRelease;
import com.hourglass.entity.VersionReleaseItem;
import com.hourglass.mapper.DemandMapper;
import com.hourglass.mapper.DevBranchMapper;
import com.hourglass.mapper.ProjectVersionMapper;
import com.hourglass.mapper.ReleaseMapper;
import com.hourglass.mapper.RequirementMapper;
import com.hourglass.mapper.TimeLogMapper;
import com.hourglass.mapper.UserMapper;
import com.hourglass.mapper.VersionTaskMapper;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * M1 版本阶段视图统计（T1.3 / T1.4 / T1.6）。
 *
 * <p>三块口径：
 * <ul>
 * <li>版本卡 —— 项目任务按 version_task 归入版本，需求按 demand.version_id 归入；</li>
 * <li>阶段卡 —— 首版/迭代由「完成日（未完成按开始日）vs 首版上线日」自动归组，工时按 time_log 自然日归组；</li>
 * <li>发布说明 —— 发布版本下绑定的任务 + 指向该版本的需求清单。</li>
 * </ul>
 */
@Service
public class VersionPhaseService {

    private final ProjectVersionMapper versionMapper;
    private final VersionTaskMapper versionTaskMapper;
    private final RequirementMapper reqMapper;
    private final DemandMapper demandMapper;
    private final TimeLogMapper timeLogMapper;
    private final UserMapper userMapper;
    private final ProjectAccessService projectAccess;
    private final DevBranchMapper branchMapper;
    private final ReleasePermissionService permissions;
    private final ReleaseMapper releaseMapper;
    @org.springframework.beans.factory.annotation.Autowired
    private TaskPublicationService publications;

    public VersionPhaseService(ProjectVersionMapper versionMapper, VersionTaskMapper versionTaskMapper,
                               RequirementMapper reqMapper, DemandMapper demandMapper,
                               TimeLogMapper timeLogMapper, UserMapper userMapper,
                               ProjectAccessService projectAccess, DevBranchMapper branchMapper,
                               ReleasePermissionService permissions, ReleaseMapper releaseMapper) {
        this.versionMapper = versionMapper;
        this.versionTaskMapper = versionTaskMapper;
        this.reqMapper = reqMapper;
        this.demandMapper = demandMapper;
        this.timeLogMapper = timeLogMapper;
        this.userMapper = userMapper;
        this.projectAccess = projectAccess;
        this.branchMapper = branchMapper;
        this.permissions = permissions;
        this.releaseMapper = releaseMapper;
    }

    /** T1.3：按版本聚合（含待规划任务桶与需求池排期计数） */
    public VersionStatsResponse versionStats(String workspaceId, String reqId) {
        return versionStats(workspaceId, reqId, null);
    }

    public VersionStatsResponse versionStats(String workspaceId, String reqId, String userId) {
        Requirement req = requireProject(workspaceId, reqId);
        projectAccess.assertView(workspaceId, userId, reqId);
        return versionStats(workspaceId, req, versionMapper.selectByReq(workspaceId, reqId),
                versionTaskMapper.selectStatsByReq(workspaceId, reqId), branchBriefs(workspaceId), userId);
    }

    /** 总览复用：项目、版本、任务数据由调用方一次取好，避免逐视图重复查询；分支简表也由总览一次取好共用 */
    private VersionStatsResponse versionStats(String workspaceId, Requirement req,
                                              List<ProjectVersion> versions, List<Task> tasks,
                                              Map<String, DevBranch> branchBriefs, String userId) {
        String reqId = req.getId();
        versionTaskMapper.enrichTasks(workspaceId, tasks);
        publications.enrichTasks(workspaceId, tasks);
        Map<String, Agg> byVersion = new HashMap<String, Agg>();
        Agg unbound = new Agg();
        java.util.Set<String> seen = new java.util.HashSet<String>();
        for (Task t : tasks) {
            if (!seen.add(t.getId())) continue;
            if (t.getVersionIds().isEmpty()) unbound.tasks.add(t);
            for (String versionId : t.getVersionIds()) aggOf(byVersion, versionId).tasks.add(t);
        }

        Map<String, int[]> demandCounts = new HashMap<String, int[]>();
        for (Demand d : demandMapper.selectByReq(workspaceId, reqId)) {
            if (d.getVersionId() == null || "rej".equals(d.getStatus())) {
                continue;
            }
            int[] c = demandCounts.get(d.getVersionId());
            if (c == null) {
                c = new int[2];
                demandCounts.put(d.getVersionId(), c);
            }
            c[0]++;
            if ("plan".equals(d.getStatus())) {
                c[1]++;
            }
        }

        VersionStatsResponse resp = new VersionStatsResponse();
        fillBucket(resp.getUnbound(), unbound);
        resp.getUnbound().setBranches(branchStatsOf(unbound.tasks, branchBriefs));
        boolean identified = userId != null && !userId.trim().isEmpty();
        boolean canManage = identified && permissions.canManageProject(userId, workspaceId, reqId);
        List<VersionRelease> projectRecords = versionTaskMapper.selectReleaseRecordsByReq(workspaceId, reqId);
        Map<String, List<VersionRelease>> recordsByVersion = new HashMap<String, List<VersionRelease>>();
        for (VersionRelease record : projectRecords)
            recordsByVersion.computeIfAbsent(record.getVersionId(), key -> new ArrayList<VersionRelease>()).add(record);
        for (ProjectVersion version : versions) {
            VersionStatsResponse.VersionStat stat = new VersionStatsResponse.VersionStat();
            stat.setId(version.getId());
            stat.setName(version.getName());
            stat.setDescription(version.getDescription());
            stat.setStatus(version.getStatus());
            stat.setStartDate(version.getStartDate());
            stat.setTargetDate(version.getTargetDate());
            stat.setReleasedAt(version.getReleasedAt());
            stat.setRevision(version.getRevision());
            List<VersionRelease> records = recordsByVersion.getOrDefault(version.getId(), java.util.Collections.emptyList());
            VersionRelease latest = latestSuccess(records);
            stat.setReleaseEvidenceKind(latest == null ? "planned_scope" : "release_snapshot");
            stat.setContentLocked(latest != null || "released".equals(version.getStatus()));
            stat.setReleaseRecordId(latest == null ? null : latest.getId());
            stat.setReleaseEventCount(records.size());
            int successCount = 0, published = 0, excluded = 0;
            java.util.Set<String> productionTasks = new java.util.HashSet<String>();
            for (VersionRelease record : records) {
                if (!"success".equals(record.getResult())) continue;
                successCount++;
                for (VersionReleaseItem item : record.getItems()) {
                    if ("published".equals(item.getDisposition())) {
                        published++;
                        if ("production".equals(record.getEnvironment()) && !"rollback".equals(record.getOperation()))
                            productionTasks.add(item.getTaskId());
                    } else excluded++;
                }
            }
            stat.setSuccessfulReleaseEventCount(successCount);
            stat.setPublishedTaskCount(published);
            stat.setExcludedTaskCount(excluded);
            stat.setUniqueProductionTaskCount(productionTasks.size());
            int effective = 0;
            for (String taskId : productionTasks) {
                TaskPublicationService.PublicationSummary summary = publications.project(taskId, projectRecords);
                if ("effective".equals(summary.getPublicationState()) && summary.getLatestEffectiveRecord() != null
                        && version.getId().equals(summary.getLatestEffectiveRecord().getVersionId())) effective++;
            }
            stat.setEffectiveProductionTaskCount(effective);
            stat.setCanManageReleasePlan(canManage);
            stat.setCanPublish(canManage);
            stat.setPreLaunchCount(0);
            Agg agg = aggOf(byVersion, version.getId());
            stat.setTaskCount(agg.tasks.size());
            fillDoneStats(stat, agg.tasks);
            stat.setBranches(branchStatsOf(agg.tasks, branchBriefs));
            int[] c = demandCounts.get(version.getId());
            stat.setDemandCount(c == null ? 0 : c[0]);
            stat.setScheduledDemandCount(c == null ? 0 : c[1]);
            resp.getVersions().add(stat);
        }
        return resp;
    }

    /** T1.4：首版/迭代阶段双统计（成员工时 + 新增需求/缺陷维护拆分） */
    public PhaseStatsResponse phaseStats(String workspaceId, String reqId) {
        return phaseStats(workspaceId, reqId, null);
    }

    public PhaseStatsResponse phaseStats(String workspaceId, String reqId, String userId) {
        Requirement req = requireProject(workspaceId, reqId);
        projectAccess.assertView(workspaceId, userId, reqId);
        return phaseStats(workspaceId, req, versionTaskMapper.selectStatsByReq(workspaceId, reqId),
                userId, null);
    }

    /** 总览复用：任务数据与成员名称缓存由调用方传入，成员名称跨项目只查一次 */
    private PhaseStatsResponse phaseStats(String workspaceId, Requirement req, List<Task> tasks,
                                          String userId, Map<String, String> userNameCache) {
        String reqId = req.getId();
        LocalDate firstReleased = req.getFirstReleasedAt();

        List<Task> mvpTasks = new ArrayList<Task>();
        List<Task> postTasks = new ArrayList<Task>();
        for (Task t : tasks) {
            LocalDate day = groupDay(t);
            if (firstReleased != null && day != null && day.isAfter(firstReleased)) {
                postTasks.add(t);
            } else {
                mvpTasks.add(t);
            }
        }

        PhaseStatsResponse resp = new PhaseStatsResponse();
        resp.setReqId(reqId);
        resp.setReqName(req.getName());
        resp.setFirstReleasedAt(firstReleased);
        fillPhase(resp.getMvp(), mvpTasks);
        fillPhase(resp.getPost(), postTasks);

        /* 工时按 time_log 自然日归组（与任务归组口径独立：只看发生日 vs 上线日） */
        Map<String, Integer> mvpHours = new HashMap<String, Integer>();
        Map<String, Integer> postHours = new HashMap<String, Integer>();
        for (UserDayRow row : timeLogMapper.sumUserDayMinutesByReq(workspaceId, reqId)) {
            if (row.getUserId() == null || row.getTotalMinutes() == null) {
                continue;
            }
            boolean post = firstReleased != null && row.getDay() != null && row.getDay().isAfter(firstReleased);
            Map<String, Integer> target = post ? postHours : mvpHours;
            Integer old = target.get(row.getUserId());
            target.put(row.getUserId(), (old == null ? 0 : old) + row.getTotalMinutes());
        }
        applyMemberHours(resp.getMvp(), mvpHours, userNameCache);
        applyMemberHours(resp.getPost(), postHours, userNameCache);
        return resp;
    }

    /**
     * 全部项目的版本总览（管理端）：逐项目复用阶段/版本统计，汇总首版与迭代的投入、准时率和版本节奏。
     */
    public VersionOverviewResponse overview(String workspaceId) {
        return overview(workspaceId, null);
    }

    public VersionOverviewResponse overview(String workspaceId, String userId) {
        VersionOverviewResponse out = new VersionOverviewResponse();
        VersionOverviewResponse.Totals totals = out.getTotals();
        totals.setProjectCount(0);
        totals.setVersionCount(0);
        totals.setReleasedCount(0);
        totals.setActiveCount(0);
        totals.setPlannedCount(0);
        totals.setMvpWorkMinutes(0);
        totals.setIterationWorkMinutes(0);
        totals.setTotalWorkMinutes(0);
        totals.setMvpDoneTasks(0);
        totals.setIterationDoneTasks(0);
        int mvpOnTimeSum = 0, mvpOnTimeN = 0, postOnTimeSum = 0, postOnTimeN = 0;
        int mvpDevSum = 0, mvpDevN = 0, postDevSum = 0, postDevN = 0;

        java.util.Set<String> hidden = projectAccess.hiddenProjectIds(workspaceId, userId);
        /* 成员名称跨项目复用缓存；每个项目的任务只查一次，阶段/版本两路统计共用；分支简表同理 */
        Map<String, String> userNameCache = new HashMap<String, String>();
        Map<String, DevBranch> branchBriefs = branchBriefs(workspaceId);
        for (Requirement p : reqMapper.selectAll(workspaceId)) {
            if (hidden.contains(p.getId())) {
                continue;
            }
            List<Task> projectTasks = versionTaskMapper.selectStatsByReq(workspaceId, p.getId());
            PhaseStatsResponse ps = phaseStats(workspaceId, p, projectTasks, userId, userNameCache);
            VersionStatsResponse vs = versionStats(workspaceId, p,
                    versionMapper.selectByReq(workspaceId, p.getId()), projectTasks, branchBriefs, userId);

            VersionOverviewResponse.ProjectOverview po = new VersionOverviewResponse.ProjectOverview();
            po.setReqId(p.getId());
            po.setReqName(p.getName());
            po.setFirstReleasedAt(ps.getFirstReleasedAt());
            po.setMvpWorkMinutes(nz(ps.getMvp().getWorkMinutes()));
            po.setMvpDoneTasks(nz(ps.getMvp().getDoneTasks()));
            po.setMvpOnTimePct(ps.getMvp().getOnTimePct());
            po.setMvpDeviationPct(ps.getMvp().getDeviationPct());
            po.setIterationWorkMinutes(nz(ps.getPost().getWorkMinutes()));
            po.setIterationDoneTasks(nz(ps.getPost().getDoneTasks()));
            po.setIterationOnTimePct(ps.getPost().getOnTimePct());
            po.setIterationDeviationPct(ps.getPost().getDeviationPct());
            po.setTotalWorkMinutes(po.getMvpWorkMinutes() + po.getIterationWorkMinutes());

            int released = 0, active = 0, planned = 0;
            VersionStatsResponse.VersionStat latest = null;
            for (VersionStatsResponse.VersionStat v : vs.getVersions()) {
                if ("released".equals(v.getStatus())) {
                    released++;
                } else if ("active".equals(v.getStatus())) {
                    active++;
                } else {
                    planned++;
                }
                if (latest == null || newerVersion(v, latest)) {
                    latest = v;
                }
            }
            int versionCount = vs.getVersions().size();
            po.setVersionCount(versionCount);
            po.setReleasedCount(released);
            po.setActiveCount(active);
            po.setPlannedCount(planned);
            if (latest != null) {
                po.setLatestVersionName(latest.getName());
                po.setLatestVersionStatus(latest.getStatus());
                po.setLatestVersionTarget(latest.getTargetDate());
                po.setLatestVersionWorkMinutes(latest.getWorkMinutes());
                po.setLatestVersionOnTimePct(latest.getOnTimePct());
                po.setLatestVersionDeviationPct(latest.getDeviationPct());
            }
            out.getProjects().add(po);

            totals.setProjectCount(totals.getProjectCount() + 1);
            totals.setVersionCount(totals.getVersionCount() + versionCount);
            totals.setReleasedCount(totals.getReleasedCount() + released);
            totals.setActiveCount(totals.getActiveCount() + active);
            totals.setPlannedCount(totals.getPlannedCount() + planned);
            totals.setMvpWorkMinutes(totals.getMvpWorkMinutes() + po.getMvpWorkMinutes());
            totals.setIterationWorkMinutes(totals.getIterationWorkMinutes() + po.getIterationWorkMinutes());
            totals.setTotalWorkMinutes(totals.getTotalWorkMinutes() + po.getTotalWorkMinutes());
            totals.setMvpDoneTasks(totals.getMvpDoneTasks() + po.getMvpDoneTasks());
            totals.setIterationDoneTasks(totals.getIterationDoneTasks() + po.getIterationDoneTasks());
            if (po.getMvpOnTimePct() != null) {
                mvpOnTimeSum += po.getMvpOnTimePct();
                mvpOnTimeN++;
            }
            if (po.getIterationOnTimePct() != null) {
                postOnTimeSum += po.getIterationOnTimePct();
                postOnTimeN++;
            }
            if (po.getMvpDeviationPct() != null) {
                mvpDevSum += po.getMvpDeviationPct();
                mvpDevN++;
            }
            if (po.getIterationDeviationPct() != null) {
                postDevSum += po.getIterationDeviationPct();
                postDevN++;
            }
        }
        totals.setMvpOnTimePct(average(mvpOnTimeSum, mvpOnTimeN));
        totals.setIterationOnTimePct(average(postOnTimeSum, postOnTimeN));
        totals.setMvpDeviationPct(average(mvpDevSum, mvpDevN));
        totals.setIterationDeviationPct(average(postDevSum, postDevN));
        return out;
    }

    /** 版本新旧：有目标日期的按日期，缺失的按上线时间，最后按 ID 兜底 */
    private static boolean newerVersion(VersionStatsResponse.VersionStat a, VersionStatsResponse.VersionStat b) {
        LocalDate da = a.getTargetDate() != null ? a.getTargetDate()
                : (a.getReleasedAt() == null ? null : a.getReleasedAt().toLocalDate());
        LocalDate db = b.getTargetDate() != null ? b.getTargetDate()
                : (b.getReleasedAt() == null ? null : b.getReleasedAt().toLocalDate());
        if (da == null && db == null) {
            return a.getId() != null && a.getId().compareTo(b.getId()) > 0;
        }
        if (da == null) {
            return false;
        }
        if (db == null) {
            return true;
        }
        return da.isAfter(db);
    }

    private static int nz(Integer v) {
        return v == null ? 0 : v;
    }

    private static Integer average(int sum, int count) {
        return count == 0 ? null : Math.round((float) sum / count);
    }

    /** T1.6：发布说明（版本任务 + 需求清单） */
    public ReleaseNoteResponse releaseNote(String workspaceId, String versionId) {
        return releaseNote(workspaceId, versionId, null);
    }

    public ReleaseNoteResponse releaseNote(String workspaceId, String versionId, String userId) {
        ProjectVersion version = versionMapper.selectById(versionId);
        if (version == null || !workspaceId.equals(version.getWorkspaceId())) {
            throw AppException.notFound("版本不存在：" + versionId);
        }
        projectAccess.assertView(workspaceId, userId, version.getReqId());
        VersionRelease record = latestSuccess(releaseMapper.selectRecords(workspaceId, versionId));
        if (record != null) return snapshotReleaseNote(workspaceId, record);
        ReleaseNoteResponse resp = new ReleaseNoteResponse();
        /* 历史无记录只保留动态统计兼容，不把统计折算制造成实际发布证据。 */
        resp.setEvidenceKind("released".equals(version.getStatus()) ? "no_release_record" : "planned_scope");
        resp.setVersion(version);
        resp.setGeneratedAt(version.getReleasedAt() != null
                ? version.getReleasedAt().toLocalDate() : LocalDate.now());

        List<Task> all = versionTaskMapper.selectStatsByReq(workspaceId, version.getReqId());
        versionTaskMapper.enrichTasks(workspaceId, all);
        publications.enrichTasks(workspaceId, all);
        int done = 0;
        int workMinutes = 0;
        int estimateMinutes = 0;
        for (Task t : all) {
            boolean inVersion = t.getVersionIds().contains(versionId);
            if (!inVersion) {
                continue;
            }
            resp.getTasks().add(t);
            workMinutes += t.getTotalMinutes() == null ? 0 : t.getTotalMinutes();
            estimateMinutes += t.getEstimateMinutes() == null ? 0 : t.getEstimateMinutes();
            if (Consts.COL_DONE.equals(t.getBoardColumn())) {
                done++;
            }
        }
        resp.setDemands(demandMapper.selectByVersion(workspaceId, versionId));
        resp.setTotalCount(resp.getTasks().size());
        resp.setDoneCount(done);
        resp.setWorkMinutes(workMinutes);
        resp.setEstimateMinutes(estimateMinutes);
        return resp;
    }

    /**
     * 「实际交付」证据只取成功的生产发布：回滚是独立事实（其影响已体现在当前生效数），
     * 测试环境部署也不代表交付——否则回滚后「查看实际记录」会指向一条没有发布项的回滚记录。
     */
    private VersionRelease latestSuccess(List<VersionRelease> records) {
        return records.stream().filter(r -> "success".equals(r.getResult())
                        && "production".equals(r.getEnvironment()) && !"rollback".equals(r.getOperation()))
                .max(java.util.Comparator.comparing(VersionRelease::getOccurredAt,
                        java.util.Comparator.nullsFirst(java.util.Comparator.naturalOrder()))
                        .thenComparing(VersionRelease::getRecordedAt,
                                java.util.Comparator.nullsFirst(java.util.Comparator.naturalOrder()))
                        .thenComparing(VersionRelease::getId)).orElse(null);
    }

    /** 实际发布证据仅来自不可变记录；不查询当前任务、需求或版本日期补齐缺失字段。 */
    private ReleaseNoteResponse snapshotReleaseNote(String workspaceId, VersionRelease record) {
        ReleaseNoteResponse resp = new ReleaseNoteResponse();
        resp.setEvidenceKind("release_snapshot");
        resp.setReleaseRecordId(record.getId());
        resp.setRecordedAt(record.getRecordedAt());
        resp.setGeneratedAt(record.getPublishedOn());

        ProjectVersion capturedVersion = new ProjectVersion();
        capturedVersion.setId(record.getVersionId());
        capturedVersion.setWorkspaceId(record.getWorkspaceId());
        capturedVersion.setReqId(record.getReqId());
        capturedVersion.setName(record.getVersionName());
        capturedVersion.setStatus("released");
        capturedVersion.setRevision(null);
        capturedVersion.setReleasedAt(record.getPublishedOn() == null ? null : record.getPublishedOn().atStartOfDay());
        resp.setVersion(capturedVersion);

        Map<String, Demand> capturedDemands = new java.util.LinkedHashMap<String, Demand>();
        int done = 0;
        int workMinutes = 0;
        int estimateMinutes = 0;
        for (VersionReleaseItem item : releaseMapper.selectItems(workspaceId, record.getId())) {
            if (!"published".equals(item.getDisposition())) {
                continue;
            }
            Task task = new Task();
            task.setId(item.getTaskId());
            task.setWorkspaceId(record.getWorkspaceId());
            task.setReqId(record.getReqId());
            task.setReqName(record.getProjectName());
            task.setTitle(item.getTitle());
            task.setItemType(item.getItemType());
            task.setOwnerUserId(item.getOwnerUserId());
            task.setOwner(item.getOwnerName());
            task.setDemandId(item.getDemandId());
            task.setVersionIds(new ArrayList<String>(java.util.Collections.singletonList(record.getVersionId())));
            task.setVersionNames(new ArrayList<String>(java.util.Collections.singletonList(record.getVersionName())));
            task.setBoardColumn(item.getBoardColumn());
            task.setCompletedAt(item.getCompletedAt());
            if (Consts.COL_DONE.equals(item.getBoardColumn())) {
                done++;
            }
            task.setTotalMinutes(item.getWorkMinutes());
            task.setEstimateMinutes(item.getEstimateMinutes());
            resp.getTasks().add(task);
            workMinutes += nz(item.getWorkMinutes());
            estimateMinutes += nz(item.getEstimateMinutes());

            if (item.getDemandId() != null && !capturedDemands.containsKey(item.getDemandId())) {
                Demand demand = new Demand();
                demand.setId(item.getDemandId());
                demand.setWorkspaceId(record.getWorkspaceId());
                demand.setReqId(record.getReqId());
                demand.setTitle(item.getDemandTitle());
                demand.setVersionId(item.getTargetVersionId());
                demand.setVersionName(item.getTargetVersionName());
                demand.setRevision(null);
                capturedDemands.put(demand.getId(), demand);
            }
        }
        publications.enrichTasks(workspaceId, resp.getTasks());
        resp.setDemands(new ArrayList<Demand>(capturedDemands.values()));
        resp.setTotalCount(resp.getTasks().size());
        resp.setDoneCount(done);
        resp.setWorkMinutes(workMinutes);
        resp.setEstimateMinutes(estimateMinutes);
        return resp;
    }

    /* ------------------------------------------------------------------ */

    private Requirement requireProject(String workspaceId, String reqId) {
        Requirement req = reqMapper.selectById(reqId);
        if (req == null || !workspaceId.equals(req.getWorkspaceId())) {
            throw AppException.notFound("项目不存在：" + reqId);
        }
        return req;
    }

    private static class Agg {
        final List<Task> tasks = new ArrayList<Task>();
    }

    /** 任务归组日：完成日优先，未完成按开始日，再退截止日（与阶段归组同口径） */
    private LocalDate groupDay(Task t) {
        if (t.getCompletedAt() != null) {
            return t.getCompletedAt();
        }
        if (t.getStartDate() != null) {
            return t.getStartDate();
        }
        return t.getDueDate();
    }

    /** 最早已发布版本（上线前未绑版本任务的归入目标） */
    private String earliestReleasedVersionId(List<ProjectVersion> versions) {
        ProjectVersion best = null;
        for (ProjectVersion v : versions) {
            if (!"released".equals(v.getStatus()) || v.getReleasedAt() == null) {
                continue;
            }
            if (best == null || v.getReleasedAt().isBefore(best.getReleasedAt())) {
                best = v;
            }
        }
        return best == null ? null : best.getId();
    }

    private Agg aggOf(Map<String, Agg> byVersion, String versionId) {
        Agg agg = byVersion.get(versionId);
        if (agg == null) {
            agg = new Agg();
            byVersion.put(versionId, agg);
        }
        return agg;
    }

    /** 分支简表（id → 分支）：版本统计推导分支进度用，分支本身不绑版本 */
    private Map<String, DevBranch> branchBriefs(String workspaceId) {
        Map<String, DevBranch> map = new HashMap<String, DevBranch>();
        for (DevBranch b : branchMapper.selectBriefsByWorkspace(workspaceId)) {
            map.put(b.getId(), b);
        }
        return map;
    }

    /**
     * 分支进度：按 task.branch_id 聚合当前口径下的任务数（上线前自动归入的任务同样计入，
     * 与版本卡任务数同源）；按分支状态 dev → testing → merging → released 排序，未挂分支的任务忽略。
     */
    private List<VersionStatsResponse.BranchStat> branchStatsOf(List<Task> tasks,
                                                                Map<String, DevBranch> branchBriefs) {
        Map<String, Integer> counts = new java.util.LinkedHashMap<String, Integer>();
        for (Task t : tasks) {
            if (t.getBranchId() == null) {
                continue;
            }
            Integer old = counts.get(t.getBranchId());
            counts.put(t.getBranchId(), old == null ? 1 : old + 1);
        }
        List<VersionStatsResponse.BranchStat> out = new ArrayList<VersionStatsResponse.BranchStat>();
        for (Map.Entry<String, Integer> e : counts.entrySet()) {
            DevBranch b = branchBriefs.get(e.getKey());
            if (b == null) {
                continue;
            }
            VersionStatsResponse.BranchStat stat = new VersionStatsResponse.BranchStat();
            stat.setBranchId(b.getId());
            stat.setName(b.getName());
            stat.setStatus(b.getStatus());
            stat.setTaskCount(e.getValue());
            out.add(stat);
        }
        Collections.sort(out, (a, b) -> {
            int d = branchRank(a.getStatus()) - branchRank(b.getStatus());
            return d != 0 ? d : String.valueOf(a.getName()).compareTo(String.valueOf(b.getName()));
        });
        return out;
    }

    private static int branchRank(String status) {
        if ("dev".equals(status)) {
            return 0;
        }
        if ("testing".equals(status)) {
            return 1;
        }
        if ("merging".equals(status)) {
            return 2;
        }
        return 3;
    }

    private void fillDoneStats(VersionStatsResponse.VersionStat stat, List<Task> tasks) {
        int done = 0;
        int work = 0;
        int doneWork = 0;
        int estimate = 0;
        int estimatedWork = 0;
        int estimatedTotal = 0;
        int onTime = 0;
        int withDue = 0;
        int remaining = 0;
        for (Task t : tasks) {
            boolean isDone = Consts.COL_DONE.equals(t.getBoardColumn());
            int minutes = t.getTotalMinutes() == null ? 0 : t.getTotalMinutes();
            /* 投入工时按全部已记工时（开发中版本的"已投入"同样累计） */
            work += minutes;
            if (isDone) {
                done++;
                /* 任务均耗时只按完成任务自己的实际工时 */
                doneWork += minutes;
                if (t.getEstimateMinutes() != null) {
                    estimatedWork += minutes;
                    estimatedTotal += t.getEstimateMinutes();
                }
                if (t.getDueDate() != null) {
                    withDue++;
                    if (t.getCompletedAt() != null && !t.getCompletedAt().isAfter(t.getDueDate())) {
                        onTime++;
                    }
                }
            } else if (t.getEstimateMinutes() != null) {
                remaining += t.getEstimateMinutes();
            }
            estimate += t.getEstimateMinutes() == null ? 0 : t.getEstimateMinutes();
        }
        stat.setDoneCount(done);
        stat.setDoingCount(tasks.size() - done);
        stat.setWorkMinutes(work);
        stat.setEstimateMinutes(estimate);
        stat.setRemainingMinutes(remaining);
        stat.setDeviationPct(pct(estimatedWork - estimatedTotal, estimatedTotal));
        stat.setOnTimePct(pct(onTime, withDue));
        stat.setAvgTaskMinutes(done == 0 ? null : Math.round((float) doneWork / done));
    }

    private void fillBucket(VersionStatsResponse.Bucket bucket, Agg agg) {
        int done = 0;
        int work = 0;
        int estimate = 0;
        int remaining = 0;
        for (Task t : agg.tasks) {
            boolean isDone = Consts.COL_DONE.equals(t.getBoardColumn());
            if (isDone) {
                done++;
                work += t.getTotalMinutes() == null ? 0 : t.getTotalMinutes();
            } else if (t.getEstimateMinutes() != null) {
                remaining += t.getEstimateMinutes();
            }
            estimate += t.getEstimateMinutes() == null ? 0 : t.getEstimateMinutes();
        }
        bucket.setTaskCount(agg.tasks.size());
        bucket.setDoneCount(done);
        bucket.setDoingCount(agg.tasks.size() - done);
        bucket.setWorkMinutes(work);
        bucket.setEstimateMinutes(estimate);
        bucket.setRemainingMinutes(remaining);
    }

    private void fillPhase(PhaseStatsResponse.Phase phase, List<Task> tasks) {
        int done = 0;
        int doneWork = 0;
        int onTime = 0;
        int withDue = 0;
        int story = 0;
        int bug = 0;
        int estimatedWork = 0;
        int estimatedTotal = 0;
        for (Task t : tasks) {
            boolean isDone = Consts.COL_DONE.equals(t.getBoardColumn());
            if (!isDone) {
                continue;
            }
            done++;
            int minutes = t.getTotalMinutes() == null ? 0 : t.getTotalMinutes();
            doneWork += minutes;
            if (t.getEstimateMinutes() != null) {
                estimatedWork += minutes;
                estimatedTotal += t.getEstimateMinutes();
            }
            if (t.getDueDate() != null) {
                withDue++;
                if (t.getCompletedAt() != null && !t.getCompletedAt().isAfter(t.getDueDate())) {
                    onTime++;
                }
            }
            if ("story".equals(t.getItemType())) {
                story++;
            } else if ("bug".equals(t.getItemType())) {
                bug++;
            }
        }
        phase.setDoneTasks(done);
        phase.setDeviationPct(pct(estimatedWork - estimatedTotal, estimatedTotal));
        phase.setOnTimePct(pct(onTime, withDue));
        phase.setStoryCount(story);
        phase.setBugCount(bug);
        /* 任务均耗时只按完成任务自己的实际工时，与版本卡同口径 */
        phase.setAvgTaskMinutes(done == 0 ? null : Math.round((float) doneWork / done));
    }

    private void applyMemberHours(PhaseStatsResponse.Phase phase, Map<String, Integer> hours,
                                  Map<String, String> userNameCache) {
        List<PhaseStatsResponse.MemberHours> list = phase.getMemberHours();
        int total = 0;
        for (Map.Entry<String, Integer> e : hours.entrySet()) {
            int minutes = e.getValue() == null ? 0 : e.getValue();
            if (minutes <= 0) {
                continue;
            }
            PhaseStatsResponse.MemberHours mh = new PhaseStatsResponse.MemberHours();
            mh.setUserId(e.getKey());
            mh.setName(resolveUserName(e.getKey(), userNameCache));
            mh.setMinutes(minutes);
            list.add(mh);
            total += minutes;
        }
        Collections.sort(list, (a, b) -> b.getMinutes() - a.getMinutes());
        phase.setWorkMinutes(total);
        phase.setMemberCount(list.size());
        phase.setAvgMemberMinutes(list.isEmpty() ? null : Math.round((float) total / list.size()));
    }

    /** 成员名称解析：传入缓存时按用户去重，避免总览里成员数 × 项目数的重复查询 */
    private String resolveUserName(String userId, Map<String, String> cache) {
        if (cache != null && cache.containsKey(userId)) {
            return cache.get(userId);
        }
        AppUser u = userMapper.selectById(userId);
        String name = u == null ? userId : u.getDisplayName();
        if (cache != null) {
            cache.put(userId, name);
        }
        return name;
    }

    /**
     * 成员阶段工时下钻：返回该成员在本项目的「任务 × 阶段」计时。
     * 与阶段卡 memberHours 同源（time_log 按计时人 + 自然日归组），因此合计能对上。
     * 汇总（行数 / 首版 / 迭代分钟）由 SQL 直接算出，明细分页返回。
     */
    public PhaseMemberTaskPage memberTasks(String workspaceId, String reqId, String userId, String viewerId,
                                          int offset, int limit) {
        requireProject(workspaceId, reqId);
        projectAccess.assertView(workspaceId, viewerId, reqId);
        String target = userId == null ? null : userId.trim();
        if (target == null || target.isEmpty()) {
            throw AppException.badRequest("缺少成员参数");
        }
        int safeOffset = Math.max(0, offset);
        int safeLimit = limit <= 0 ? 100 : Math.min(limit, 100);

        PhaseMemberTaskSummary summary = timeLogMapper.summaryMemberTaskPhaseByReq(workspaceId, reqId, target);
        List<PhaseMemberTask> items = summary.getTotal() <= safeOffset
                ? new ArrayList<PhaseMemberTask>()
                : timeLogMapper.selectMemberTaskPhasePageByReq(workspaceId, reqId, target, safeOffset, safeLimit);

        PhaseMemberTaskPage page = new PhaseMemberTaskPage();
        page.setTotal(summary.getTotal());
        page.setOffset(safeOffset);
        page.setLimit(safeLimit);
        page.setHasMore(safeOffset + items.size() < summary.getTotal());
        page.setItems(items);
        page.setMvpMinutes(summary.getMvpMinutes());
        page.setPostMinutes(summary.getPostMinutes());
        return page;
    }

    /** 百分比（四舍五入取整）；分母为 0 时返回 null 表示"无数据" */
    private Integer pct(int numerator, int denominator) {
        if (denominator <= 0) {
            return null;
        }
        return Math.round(numerator * 100f / denominator);
    }
}
