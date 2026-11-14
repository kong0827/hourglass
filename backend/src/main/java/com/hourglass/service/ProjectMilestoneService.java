package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.common.Consts;
import com.hourglass.common.Ids;
import com.hourglass.common.Texts;
import com.hourglass.dto.MilestoneActionRequest;
import com.hourglass.dto.MilestoneSaveRequest;
import com.hourglass.dto.MilestoneTaskLink;
import com.hourglass.dto.MilestoneUpdateRequest;
import com.hourglass.dto.MilestoneView;
import com.hourglass.entity.AppUser;
import com.hourglass.entity.ProjectMilestone;
import com.hourglass.entity.ProjectVersion;
import com.hourglass.entity.Requirement;
import com.hourglass.entity.Task;
import com.hourglass.entity.VersionRelease;
import com.hourglass.mapper.ProjectMilestoneMapper;
import com.hourglass.mapper.ProjectVersionMapper;
import com.hourglass.mapper.ReleaseMapper;
import com.hourglass.mapper.RequirementMapper;
import com.hourglass.mapper.TaskMapper;
import com.hourglass.mapper.UserMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 项目级里程碑：一条里程碑只表达一条达成条件。
 *
 * <p>状态由证据推导，不存状态字段：发布型只看 production 成功记录（回滚后标记 rolled back），
 * 工作项型看关联工作项是否全部完成，人工型只在确认时写一次达成时间。
 */
@Service
public class ProjectMilestoneService {

    private static final String KIND_VERSION = "version";
    private static final String KIND_TASKS = "tasks";
    private static final String KIND_MANUAL = "manual";

    private final ProjectMilestoneMapper milestoneMapper;
    private final ProjectVersionMapper versionMapper;
    private final TaskMapper taskMapper;
    private final RequirementMapper reqMapper;
    private final ReleaseMapper releaseMapper;
    private final UserMapper userMapper;
    private final ProjectAccessService projectAccess;

    public ProjectMilestoneService(ProjectMilestoneMapper milestoneMapper, ProjectVersionMapper versionMapper,
                                   TaskMapper taskMapper, RequirementMapper reqMapper, ReleaseMapper releaseMapper,
                                   UserMapper userMapper, ProjectAccessService projectAccess) {
        this.milestoneMapper = milestoneMapper;
        this.versionMapper = versionMapper;
        this.taskMapper = taskMapper;
        this.reqMapper = reqMapper;
        this.releaseMapper = releaseMapper;
        this.userMapper = userMapper;
        this.projectAccess = projectAccess;
    }

    public List<MilestoneView> list(String workspaceId, String reqId, String userId) {
        Requirement req = requireProject(workspaceId, reqId);
        projectAccess.assertView(workspaceId, userId, reqId);
        List<ProjectMilestone> milestones = milestoneMapper.selectByReq(workspaceId, reqId);
        if (milestones.isEmpty()) {
            return Collections.emptyList();
        }
        List<Task> tasks = taskMapper.selectByReq(workspaceId, reqId);
        Map<String, Task> taskById = new HashMap<String, Task>();
        for (Task t : tasks) {
            taskById.put(t.getId(), t);
        }
        Map<String, List<MilestoneTaskLink>> linksByMilestone = new HashMap<String, List<MilestoneTaskLink>>();
        for (MilestoneTaskLink link : milestoneMapper.selectTaskLinksByReq(workspaceId, reqId)) {
            linksByMilestone.computeIfAbsent(link.getMilestoneId(), key -> new ArrayList<MilestoneTaskLink>()).add(link);
        }
        Map<String, ProjectVersion> versionById = new HashMap<String, ProjectVersion>();
        for (ProjectVersion v : versionMapper.selectByReq(workspaceId, reqId)) {
            versionById.put(v.getId(), v);
        }
        Map<String, AppUser> users = usersOf(milestones, req);
        Map<String, List<VersionRelease>> releasesByVersion = new HashMap<String, List<VersionRelease>>();
        List<MilestoneView> out = new ArrayList<MilestoneView>();
        for (ProjectMilestone milestone : milestones) {
            List<MilestoneTaskLink> links = linksByMilestone.get(milestone.getId());
            List<Task> linked = new ArrayList<Task>();
            if (links != null) {
                for (MilestoneTaskLink link : links) {
                    Task task = taskById.get(link.getTaskId());
                    if (task != null) {
                        linked.add(task);
                    }
                }
            }
            List<VersionRelease> records = Collections.emptyList();
            if (KIND_VERSION.equals(milestone.getKind()) && milestone.getVersionId() != null) {
                records = releasesByVersion.computeIfAbsent(milestone.getVersionId(),
                        key -> releaseMapper.selectRecords(workspaceId, key));
            }
            out.add(toView(milestone, linked, versionById.get(milestone.getVersionId()), records, users));
        }
        return out;
    }

    @Transactional
    public MilestoneView create(String userId, String workspaceId, MilestoneSaveRequest request) {
        Requirement req = requireProject(workspaceId, request.getReqId());
        projectAccess.assertWrite(workspaceId, userId, req.getId());
        String kind = normalizeKind(request.getKind());
        ProjectVersion version = null;
        List<Task> tasks = Collections.emptyList();
        if (KIND_VERSION.equals(kind)) {
            version = requireVersion(workspaceId, req.getId(), request.getVersionId());
            if ("closed".equals(version.getStatus()) || "canceled".equals(version.getStatus())) {
                throw AppException.badRequest("已关闭或已取消的版本不能再创建发布型里程碑");
            }
        } else if (KIND_TASKS.equals(kind)) {
            tasks = requireTasks(workspaceId, req.getId(), request.getTaskIds());
        }
        String name = Texts.trimToNull(request.getName());
        if (name == null) {
            name = defaultName(kind, version, tasks);
        }
        ProjectMilestone milestone = new ProjectMilestone();
        milestone.setId(Ids.gen("M"));
        milestone.setWorkspaceId(workspaceId);
        milestone.setReqId(req.getId());
        milestone.setName(Texts.cut(name, 120));
        milestone.setKind(kind);
        milestone.setVersionId(version == null ? null : version.getId());
        milestone.setTargetDate(request.getTargetDate() != null
                ? request.getTargetDate() : defaultTargetDate(kind, version, tasks));
        String owner = Texts.trimToNull(request.getOwnerUserId());
        milestone.setOwnerUserId(owner == null ? req.getOwnerUserId() : owner);
        milestone.setKeyMilestone(request.getKeyMilestone() == null || request.getKeyMilestone());
        milestone.setNote(Texts.cut(Texts.trimToNull(request.getNote()), 500));
        milestoneMapper.insert(milestone);
        if (!tasks.isEmpty()) {
            milestoneMapper.insertTasks(workspaceId, milestone.getId(), idsOf(tasks));
        }
        log(workspaceId, milestone.getId(), "create", "创建里程碑 · " + kindName(kind), userId);
        return detail(workspaceId, milestone.getId(), userId);
    }

    public MilestoneView detail(String workspaceId, String id, String userId) {
        ProjectMilestone milestone = get(workspaceId, id);
        projectAccess.assertView(workspaceId, userId, milestone.getReqId());
        Requirement req = requireProject(workspaceId, milestone.getReqId());
        List<Task> tasks = Collections.emptyList();
        if (KIND_TASKS.equals(milestone.getKind())) {
            Set<String> wanted = new HashSet<String>();
            for (MilestoneTaskLink link : milestoneMapper.selectTaskLinksByReq(workspaceId, milestone.getReqId())) {
                if (milestone.getId().equals(link.getMilestoneId())) {
                    wanted.add(link.getTaskId());
                }
            }
            tasks = new ArrayList<Task>();
            for (Task task : taskMapper.selectByReq(workspaceId, milestone.getReqId())) {
                if (wanted.contains(task.getId())) {
                    tasks.add(task);
                }
            }
        }
        ProjectVersion version = milestone.getVersionId() == null ? null : versionMapper.selectById(milestone.getVersionId());
        List<VersionRelease> records = version == null || !KIND_VERSION.equals(milestone.getKind())
                ? Collections.<VersionRelease>emptyList()
                : releaseMapper.selectRecords(workspaceId, version.getId());
        Map<String, AppUser> users = usersOf(Collections.singletonList(milestone), req);
        MilestoneView view = toView(milestone, tasks, version, records, users);
        view.setLogs(logs(workspaceId, milestone.getId(), users));
        return view;
    }

    @Transactional
    public MilestoneView update(String userId, String workspaceId, String id, MilestoneUpdateRequest request) {
        ProjectMilestone current = get(workspaceId, id);
        projectAccess.assertWrite(workspaceId, userId, current.getReqId());
        ProjectMilestone milestone = milestoneMapper.selectByIdForUpdate(workspaceId, id);
        if (milestone == null) {
            throw AppException.notFound("里程碑不存在：" + id);
        }
        requireRevision(request.getRevision(), milestone.getRevision());
        if (milestone.getCanceledAt() != null) {
            throw AppException.badRequest("已取消的里程碑不能编辑");
        }
        String name = Texts.trimToNull(request.getName());
        if (name == null) {
            name = milestone.getName();
        }
        String owner = request.getOwnerUserId() == null ? milestone.getOwnerUserId()
                : Texts.trimToNull(request.getOwnerUserId());
        Boolean key = request.getKeyMilestone() == null ? milestone.getKeyMilestone() : request.getKeyMilestone();
        String note = request.getNote() == null ? milestone.getNote()
                : Texts.cut(Texts.trimToNull(request.getNote()), 500);
        if (milestoneMapper.updateMeta(workspaceId, id, Texts.cut(name, 120), owner, key, note,
                milestone.getRevision()) != 1) {
            throw new AppException(409, "里程碑已被其他人修改，请刷新后重试");
        }
        log(workspaceId, id, "update", "更新里程碑信息", userId);
        return detail(workspaceId, id, userId);
    }

    @Transactional
    public MilestoneView reschedule(String userId, String workspaceId, String id, MilestoneActionRequest request) {
        ProjectMilestone current = get(workspaceId, id);
        projectAccess.assertWrite(workspaceId, userId, current.getReqId());
        if (request.getTargetDate() == null) {
            throw AppException.badRequest("请选择新的目标日期");
        }
        String reason = requiredReason(request.getReason(), "请填写改期原因");
        ProjectMilestone milestone = lockEditable(workspaceId, id, request.getRevision());
        if (request.getTargetDate().equals(milestone.getTargetDate())) {
            throw AppException.badRequest("目标日期没有变化");
        }
        if (milestoneMapper.reschedule(workspaceId, id, request.getTargetDate(), milestone.getRevision()) != 1) {
            throw new AppException(409, "里程碑已被其他人修改，请刷新后重试");
        }
        log(workspaceId, id, "reschedule",
                milestone.getTargetDate() + " → " + request.getTargetDate() + " · " + reason, userId);
        return detail(workspaceId, id, userId);
    }

    @Transactional
    public MilestoneView cancel(String userId, String workspaceId, String id, MilestoneActionRequest request) {
        ProjectMilestone current = get(workspaceId, id);
        projectAccess.assertWrite(workspaceId, userId, current.getReqId());
        String reason = requiredReason(request.getReason(), "请填写取消原因");
        ProjectMilestone milestone = milestoneMapper.selectByIdForUpdate(workspaceId, id);
        if (milestone == null) {
            throw AppException.notFound("里程碑不存在：" + id);
        }
        requireRevision(request.getRevision(), milestone.getRevision());
        if (milestone.getCanceledAt() != null) {
            throw AppException.badRequest("里程碑已取消");
        }
        if (milestoneMapper.cancel(workspaceId, id, reason, milestone.getRevision()) != 1) {
            throw new AppException(409, "里程碑已被其他人修改，请刷新后重试");
        }
        log(workspaceId, id, "cancel", "取消里程碑 · " + reason, userId);
        return detail(workspaceId, id, userId);
    }

    /** 人工确认：只有人工型可以标记达成；自动型不接受手动标记。 */
    @Transactional
    public MilestoneView achieve(String userId, String workspaceId, String id, MilestoneActionRequest request) {
        ProjectMilestone current = get(workspaceId, id);
        projectAccess.assertWrite(workspaceId, userId, current.getReqId());
        if (!KIND_MANUAL.equals(current.getKind())) {
            throw AppException.badRequest("只有人工确认型里程碑可以手动标记达成");
        }
        ProjectMilestone milestone = lockEditable(workspaceId, id, request.getRevision());
        if (milestone.getAchievedAt() != null) {
            throw AppException.badRequest("里程碑已经达成");
        }
        String note = Texts.cut(Texts.trimToNull(request.getNote()), 500);
        if (milestoneMapper.achieveManual(workspaceId, id, note, userId, milestone.getRevision()) != 1) {
            throw new AppException(409, "里程碑已被其他人修改，请刷新后重试");
        }
        log(workspaceId, id, "achieve",
                "确认达成" + (note == null ? "" : " · " + note), userId);
        return detail(workspaceId, id, userId);
    }

    /** 撤销人工达成：保留日志与证据链，回到未达成。 */
    @Transactional
    public MilestoneView revoke(String userId, String workspaceId, String id, MilestoneActionRequest request) {
        ProjectMilestone current = get(workspaceId, id);
        projectAccess.assertWrite(workspaceId, userId, current.getReqId());
        if (!KIND_MANUAL.equals(current.getKind())) {
            throw AppException.badRequest("只有人工确认型里程碑可以撤销达成");
        }
        ProjectMilestone milestone = lockEditable(workspaceId, id, request.getRevision());
        if (milestone.getAchievedAt() == null) {
            throw AppException.badRequest("里程碑尚未达成");
        }
        String reason = Texts.cut(Texts.trimToNull(request.getReason()), 500);
        if (milestoneMapper.revokeManual(workspaceId, id, milestone.getRevision()) != 1) {
            throw new AppException(409, "里程碑已被其他人修改，请刷新后重试");
        }
        log(workspaceId, id, "revoke",
                "撤销达成" + (reason == null ? "" : " · " + reason), userId);
        return detail(workspaceId, id, userId);
    }

    @Transactional
    public void deleteByReq(String workspaceId, String reqId) {
        milestoneMapper.deleteLogsByReq(workspaceId, reqId);
        milestoneMapper.deleteTaskLinksByReq(workspaceId, reqId);
        milestoneMapper.deleteByReq(workspaceId, reqId);
    }

    private ProjectMilestone lockEditable(String workspaceId, String id, Long revision) {
        ProjectMilestone milestone = milestoneMapper.selectByIdForUpdate(workspaceId, id);
        if (milestone == null) {
            throw AppException.notFound("里程碑不存在：" + id);
        }
        requireRevision(revision, milestone.getRevision());
        if (milestone.getCanceledAt() != null) {
            throw AppException.badRequest("已取消的里程碑不能继续操作");
        }
        return milestone;
    }

    private static void requireRevision(Long requested, Long current) {
        if (requested == null) {
            throw AppException.badRequest("缺少里程碑版本号，请刷新后重试");
        }
        if (!requested.equals(current)) {
            throw new AppException(409, "里程碑已被其他人修改，请刷新后重试");
        }
    }

    private ProjectMilestone get(String workspaceId, String id) {
        ProjectMilestone milestone = milestoneMapper.selectById(workspaceId, id);
        if (milestone == null) {
            throw AppException.notFound("里程碑不存在：" + id);
        }
        return milestone;
    }

    private Requirement requireProject(String workspaceId, String reqId) {
        Requirement req = reqMapper.selectById(reqId);
        if (req == null || !workspaceId.equals(req.getWorkspaceId())) {
            throw AppException.notFound("项目不存在：" + reqId);
        }
        return req;
    }

    private ProjectVersion requireVersion(String workspaceId, String reqId, String versionId) {
        String id = Texts.trimToNull(versionId);
        if (id == null) {
            throw AppException.badRequest("请选择版本");
        }
        ProjectVersion version = versionMapper.selectById(id);
        if (version == null || !workspaceId.equals(version.getWorkspaceId()) || !reqId.equals(version.getReqId())) {
            throw AppException.badRequest("版本不存在或不属于该项目");
        }
        return version;
    }

    private List<Task> requireTasks(String workspaceId, String reqId, List<String> rawIds) {
        Set<String> ids = new LinkedHashSet<String>();
        if (rawIds != null) {
            for (String raw : rawIds) {
                String id = Texts.trimToNull(raw);
                if (id != null) {
                    ids.add(id);
                }
            }
        }
        if (ids.isEmpty()) {
            throw AppException.badRequest("请选择关联工作项");
        }
        if (milestoneMapper.verifyTasks(workspaceId, reqId, new ArrayList<String>(ids)) != ids.size()) {
            throw AppException.badRequest("关联工作项不存在、已删除或不属于该项目");
        }
        List<Task> tasks = new ArrayList<Task>();
        for (Task task : taskMapper.selectByReq(workspaceId, reqId)) {
            if (ids.contains(task.getId())) {
                tasks.add(task);
            }
        }
        return tasks;
    }

    private String normalizeKind(String raw) {
        if (KIND_VERSION.equals(raw) || KIND_TASKS.equals(raw) || KIND_MANUAL.equals(raw)) {
            return raw;
        }
        throw AppException.badRequest("达成方式只能是版本发布后、工作项完成后或人工确认");
    }

    private static String defaultName(String kind, ProjectVersion version, List<Task> tasks) {
        if (KIND_VERSION.equals(kind)) {
            return Texts.cut(version.getName() + " 发布", 120);
        }
        if (KIND_TASKS.equals(kind)) {
            return tasks.size() == 1 ? Texts.cut(tasks.get(0).getTitle() + " 完成", 120) : "关联工作项全部完成";
        }
        return "项目里程碑";
    }

    private static LocalDate defaultTargetDate(String kind, ProjectVersion version, List<Task> tasks) {
        if (KIND_VERSION.equals(kind) && version.getTargetDate() != null) {
            return version.getTargetDate();
        }
        LocalDate latest = null;
        if (KIND_TASKS.equals(kind)) {
            for (Task task : tasks) {
                LocalDate day = task.getDueDate() != null ? task.getDueDate() : task.getStartDate();
                if (day != null && (latest == null || day.isAfter(latest))) {
                    latest = day;
                }
            }
        }
        return latest == null ? LocalDate.now().plusDays(14) : latest;
    }

    private static List<String> idsOf(List<Task> tasks) {
        List<String> ids = new ArrayList<String>();
        for (Task task : tasks) {
            ids.add(task.getId());
        }
        return ids;
    }

    private static String requiredReason(String raw, String message) {
        String reason = Texts.trimToNull(raw);
        if (reason == null) {
            throw AppException.badRequest(message);
        }
        return Texts.cut(reason, 500);
    }

    private Map<String, AppUser> usersOf(List<ProjectMilestone> milestones, Requirement req) {
        Set<String> ids = new LinkedHashSet<String>();
        if (req.getOwnerUserId() != null) {
            ids.add(req.getOwnerUserId());
        }
        for (ProjectMilestone m : milestones) {
            if (m.getOwnerUserId() != null) {
                ids.add(m.getOwnerUserId());
            }
            if (m.getConfirmedByUserId() != null) {
                ids.add(m.getConfirmedByUserId());
            }
        }
        Map<String, AppUser> users = new HashMap<String, AppUser>();
        if (ids.isEmpty()) {
            return users;
        }
        for (AppUser user : userMapper.selectByIds(new ArrayList<String>(ids))) {
            users.put(user.getId(), user);
        }
        return users;
    }

    private List<MilestoneView.MilestoneLog> logs(String workspaceId, String milestoneId, Map<String, AppUser> users) {
        List<MilestoneView.MilestoneLog> out = new ArrayList<MilestoneView.MilestoneLog>();
        for (Map<String, Object> row : milestoneMapper.selectLogs(workspaceId, milestoneId)) {
            MilestoneView.MilestoneLog log = new MilestoneView.MilestoneLog();
            log.setAction((String) row.get("action"));
            log.setDetail((String) row.get("detail"));
            String operatorId = (String) row.get("operatorUserId");
            log.setOperatorUserId(operatorId);
            if (operatorId != null && !users.containsKey(operatorId)) {
                AppUser operator = userMapper.selectById(operatorId);
                if (operator != null) {
                    users.put(operatorId, operator);
                }
            }
            log.setOperatorName(displayName(users, operatorId));
            Object created = row.get("createdAt");
            if (created instanceof LocalDateTime) {
                log.setCreatedAt((LocalDateTime) created);
            } else if (created instanceof java.sql.Timestamp) {
                log.setCreatedAt(((java.sql.Timestamp) created).toLocalDateTime());
            }
            out.add(log);
        }
        return out;
    }

    private static String displayName(Map<String, AppUser> users, String userId) {
        if (userId == null || userId.trim().isEmpty()) {
            return "";
        }
        AppUser user = users.get(userId);
        if (user == null) {
            return userId;
        }
        return user.getDisplayName() == null || user.getDisplayName().trim().isEmpty()
                ? user.getUsername() : user.getDisplayName();
    }

    private MilestoneView toView(ProjectMilestone m, List<Task> tasks, ProjectVersion version,
                                 List<VersionRelease> records, Map<String, AppUser> users) {
        MilestoneView view = new MilestoneView();
        view.setId(m.getId());
        view.setReqId(m.getReqId());
        view.setName(m.getName());
        view.setKind(m.getKind());
        view.setVersionId(m.getVersionId());
        view.setVersionName(version == null ? null : version.getName());
        view.setTargetDate(m.getTargetDate());
        view.setOwnerUserId(m.getOwnerUserId());
        view.setOwnerName(displayName(users, m.getOwnerUserId()));
        view.setKeyMilestone(m.getKeyMilestone() == null || m.getKeyMilestone());
        view.setNote(m.getNote());
        view.setCanceledAt(m.getCanceledAt());
        view.setCancelReason(m.getCancelReason());
        view.setRevision(m.getRevision());
        view.setConfirmedByUserId(m.getConfirmedByUserId());
        view.setConfirmedByName(displayName(users, m.getConfirmedByUserId()));
        view.setAchievedNote(m.getAchievedNote());
        for (Task task : tasks) {
            MilestoneView.MilestoneTask mt = new MilestoneView.MilestoneTask();
            mt.setId(task.getId());
            mt.setTitle(task.getTitle());
            mt.setBoardColumn(task.getBoardColumn());
            mt.setCompletedAt(task.getCompletedAt() == null ? null : task.getCompletedAt().atStartOfDay());
            view.getTasks().add(mt);
        }
        int done = 0;
        for (Task task : tasks) {
            if (Consts.COL_DONE.equals(task.getBoardColumn())) {
                done++;
            }
        }
        view.setTaskCount(tasks.size());
        view.setDoneTaskCount(done);

        LocalDateTime achievedAt = null;
        String source = null;
        boolean rolledBack = false;
        if (m.getCanceledAt() != null) {
            view.setStatus("canceled");
            return view;
        }
        if (KIND_MANUAL.equals(m.getKind())) {
            achievedAt = m.getAchievedAt();
            source = achievedAt == null ? null : KIND_MANUAL;
        } else if (KIND_TASKS.equals(m.getKind())) {
            if (!tasks.isEmpty() && done == tasks.size()) {
                source = KIND_TASKS;
                for (Task task : tasks) {
                    if (task.getCompletedAt() != null
                            && (achievedAt == null
                            || task.getCompletedAt().atStartOfDay().isAfter(achievedAt))) {
                        achievedAt = task.getCompletedAt().atStartOfDay();
                    }
                }
            }
        } else if (KIND_VERSION.equals(m.getKind())) {
            List<VersionRelease> sorted = new ArrayList<VersionRelease>(records);
            sorted.sort(java.util.Comparator
                    .comparing(VersionRelease::getOccurredAt, java.util.Comparator.nullsFirst(java.util.Comparator.naturalOrder()))
                    .thenComparing(VersionRelease::getRecordedAt, java.util.Comparator.nullsFirst(java.util.Comparator.naturalOrder()))
                    .thenComparing(VersionRelease::getId));
            /* 按目标回放：回滚只撤销它引用的那次发布，之后的成功重部署让版本重新生效 */
            Map<String, VersionRelease> effective = new java.util.TreeMap<String, VersionRelease>();
            LocalDateTime firstSuccess = null;
            LocalDateTime lastSuccess = null;
            VersionRelease lastEvidence = null;
            int successCount = 0;
            for (VersionRelease record : sorted) {
                if (!"success".equals(record.getResult()) || !"production".equals(record.getEnvironment())) {
                    continue;
                }
                LocalDateTime at = record.getOccurredAt() == null ? record.getRecordedAt() : record.getOccurredAt();
                if ("rollback".equals(record.getOperation())) {
                    if (record.getRelatedReleaseId() != null) {
                        for (String target : record.getTargetKeys().isEmpty()
                                ? new ArrayList<String>(effective.keySet()) : record.getTargetKeys()) {
                            VersionRelease deployed = effective.get(target);
                            if (deployed != null && deployed.getId().equals(record.getRelatedReleaseId())) {
                                effective.remove(target);
                            }
                        }
                    }
                    continue;
                }
                if (!"deploy".equals(record.getOperation()) && !"redeploy".equals(record.getOperation())) {
                    continue;
                }
                /* 设计口径：测试环境、部分成功（覆盖不全）、失败、回滚都不算达成 */
                if (!"full".equals(record.getCoverage())) {
                    continue;
                }
                successCount++;
                if (at != null && (firstSuccess == null || at.isBefore(firstSuccess))) {
                    firstSuccess = at;
                }
                if (at != null && (lastSuccess == null || at.isAfter(lastSuccess))) {
                    lastSuccess = at;
                    lastEvidence = record;
                }
                if (record.getTargetKeys().isEmpty()) {
                    effective.put("__scope__", record);
                } else {
                    for (String target : record.getTargetKeys()) {
                        effective.put(target, record);
                    }
                }
            }
            view.setReleaseCount(successCount);
            if (firstSuccess != null) {
                achievedAt = firstSuccess;
                source = KIND_VERSION;
                view.setReleaseRecordId(lastEvidence == null ? null : lastEvidence.getId());
                view.setReleaseAt(lastSuccess);
                rolledBack = effective.isEmpty();
            }
        }
        view.setAchievedAt(achievedAt);
        view.setAchievedSource(source);
        view.setRolledBack(rolledBack);
        if (achievedAt != null) {
            view.setStatus(rolledBack ? "achieved_rolled_back" : "achieved");
        } else if (m.getTargetDate() != null && m.getTargetDate().isBefore(LocalDate.now())) {
            view.setStatus("overdue");
        } else {
            view.setStatus("pending");
        }
        return view;
    }

    /** 日志 detail 列只有 500 字符，原因/说明可达 500，拼接前缀前先截断 */
    private void log(String workspaceId, String id, String action, String detail, String userId) {
        milestoneMapper.insertLog(workspaceId, id, action, Texts.cut(detail, 500), userId);
    }

    private static String kindName(String kind) {
        if (KIND_VERSION.equals(kind)) {
            return "版本发布后";
        }
        if (KIND_TASKS.equals(kind)) {
            return "工作项完成后";
        }
        return "人工确认";
    }
}
