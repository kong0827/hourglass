package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.common.Ids;
import com.hourglass.common.Texts;
import com.hourglass.dto.ProjectVersionSaveRequest;
import com.hourglass.entity.Demand;
import com.hourglass.entity.ProjectVersion;
import com.hourglass.entity.Requirement;
import com.hourglass.entity.Task;
import com.hourglass.mapper.ProjectVersionMapper;
import com.hourglass.mapper.RequirementMapper;
import com.hourglass.mapper.TaskMapper;
import com.hourglass.mapper.VersionTaskMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

@Service
public class ProjectVersionService {

    private final ProjectVersionMapper versionMapper;
    private final VersionTaskMapper versionTaskMapper;
    private final TaskMapper taskMapper;
    private final RequirementMapper reqMapper;
    private final ProjectAccessService projectAccess;
    private final DeliveryScopeLock scopeLock;
    private final ReleasePermissionService permissions;
    private final com.hourglass.mapper.ReleaseMapper releases;
    private final VersionReleaseService releaseService;
    @org.springframework.beans.factory.annotation.Autowired
    private TaskPublicationService publications;
    @org.springframework.beans.factory.annotation.Autowired
    private TaskAuditLogger taskAudit;

    public ProjectVersionService(ProjectVersionMapper versionMapper, VersionTaskMapper versionTaskMapper,
                                 TaskMapper taskMapper, RequirementMapper reqMapper,
                                 ProjectAccessService projectAccess,
                                 DeliveryScopeLock scopeLock, ReleasePermissionService permissions,
                                 com.hourglass.mapper.ReleaseMapper releases, VersionReleaseService releaseService) {
        this.versionMapper = versionMapper;
        this.versionTaskMapper = versionTaskMapper;
        this.taskMapper = taskMapper;
        this.reqMapper = reqMapper;
        this.projectAccess = projectAccess;
        this.scopeLock = scopeLock;
        this.permissions = permissions;
        this.releases = releases;
        this.releaseService = releaseService;
    }

    public List<ProjectVersion> list(String workspaceId, String reqId) {
        return list(workspaceId, reqId, null);
    }

    public List<ProjectVersion> list(String workspaceId, String reqId, String userId) {
        requireProject(workspaceId, reqId);
        projectAccess.assertView(workspaceId, userId, reqId);
        List<ProjectVersion> versions = versionMapper.selectByReq(workspaceId, reqId);
        if (versions.isEmpty()) {
            return versions;
        }
        Map<String, List<Task>> tasksByVersion = new HashMap<String, List<Task>>();
        List<Task> options = taskOptions(workspaceId, reqId, userId);
        for (Task task : options) {
            for (String versionId : task.getVersionIds()) {
                tasksByVersion.computeIfAbsent(versionId, key -> new ArrayList<Task>()).add(task);
            }
        }
        for (ProjectVersion version : versions) {
            List<Task> tasks = tasksByVersion.get(version.getId());
            if (tasks == null) {
                tasks = Collections.emptyList();
            }
            version.setTasks(tasks);
            version.setTaskCount(tasks.size());
            int done = 0;
            int progressSum = 0;
            for (Task task : tasks) {
                if ("done".equals(task.getBoardColumn())) {
                    done++;
                    progressSum += 100;
                } else {
                    progressSum += task.getProgress() == null ? 0 : task.getProgress();
                }
            }
            version.setDoneCount(done);
            version.setProgressPct(tasks.isEmpty() ? 0 : (int) Math.round((double) progressSum / tasks.size()));
            if (userId != null) {
                version.setCanManageReleasePlan(permissions.canManageProject(userId, workspaceId, reqId));
                version.setCanPublish(permissions.canManageProject(userId, workspaceId, reqId));
            }
        }
        return versions;
    }

    public List<Task> taskOptions(String workspaceId, String reqId) {
        return taskOptions(workspaceId, reqId, null);
    }

    public List<Task> taskOptions(String workspaceId, String reqId, String userId) {
        requireProject(workspaceId, reqId);
        projectAccess.assertView(workspaceId, userId, reqId);
        List<Task> tasks = versionTaskMapper.selectOptionsByReq(workspaceId, reqId);
        versionTaskMapper.enrichTasks(workspaceId, tasks);
        publications.enrichTasks(workspaceId, tasks);
        return tasks;
    }

    @Transactional
    public ProjectVersion create(String userId, String workspaceId, ProjectVersionSaveRequest req) {
        requireProject(workspaceId, req.getReqId());
        projectAccess.assertWrite(workspaceId, userId, req.getReqId());
        scopeLock.lockProjects(workspaceId, req.getReqId());
        projectAccess.assertWriteForUpdate(workspaceId, userId, req.getReqId());
        validateDates(req);
        String name = normalizeName(req.getName());
        requireUniqueName(workspaceId, req.getReqId(), name, null);
        ProjectVersion version = new ProjectVersion();
        version.setId(Ids.gen("V"));
        version.setWorkspaceId(workspaceId);
        version.setReqId(req.getReqId());
        version.setName(name);
        version.setDescription(Texts.trimToNull(req.getDescription()));
        version.setStatus(normalizeStatus(req.getStatus()));
        version.setStartDate(req.getStartDate());
        version.setTargetDate(req.getTargetDate());
        versionMapper.insert(version);
        if (req.getTaskIds() != null) {
            applyTasks(userId, version, req.getTaskIds(), req.getTaskChangeReason());
        }
        return getForUpdate(workspaceId, version.getId());
    }

    @Transactional
    public ProjectVersion update(String userId, String workspaceId, String id, ProjectVersionSaveRequest req) {
        ProjectVersion old = get(workspaceId, id);
        projectAccess.assertView(workspaceId, userId, old.getReqId());
        scopeLock.lockProjects(workspaceId, old.getReqId());
        old = getForUpdate(workspaceId, id);
        if (!java.util.Objects.equals(req.getRevision(), old.getRevision())) {
            throw new AppException(409, "版本已被其他人修改，请刷新后重试");
        }
        validateDates(req);
        if (!old.getReqId().equals(req.getReqId())) {
            throw AppException.badRequest("版本不能移到其他项目");
        }
        projectAccess.assertWriteForUpdate(workspaceId, userId, old.getReqId());
        String name = normalizeName(req.getName());
        requireUniqueName(workspaceId, old.getReqId(), name, id);
        if ("released".equals(old.getStatus())) {
            throw AppException.badRequest("已发布的版本不能编辑");
        }
        old.setName(name);
        old.setDescription(Texts.trimToNull(req.getDescription()));
        old.setStartDate(req.getStartDate());
        old.setTargetDate(req.getTargetDate());
        old.setStatus(normalizeStatus(req.getStatus()));
        if (versionMapper.update(old) != 1) {
            throw new AppException(409, "版本已被其他人修改，请刷新后重试");
        }
        if (req.getTaskIds() != null) {
            applyTasks(userId, old, req.getTaskIds(), req.getTaskChangeReason());
        }
        releaseService.log(userId, workspaceId, id, "version_update", req.getTaskChangeReason(), null, req);
        return getForUpdate(workspaceId, id);
    }

    /** 开始开发：待规划 → 开发中；缺开始日期时补今天，让版本周期窗口完整展示 */
    @Transactional
    public ProjectVersion start(String userId, String workspaceId, String id) {
        ProjectVersion version = get(workspaceId, id);
        projectAccess.assertView(workspaceId, userId, version.getReqId());
        projectAccess.assertWrite(workspaceId, userId, version.getReqId());
        scopeLock.lockProjects(workspaceId, version.getReqId());
        version = getForUpdate(workspaceId, id);
        projectAccess.assertWriteForUpdate(workspaceId, userId, version.getReqId());
        if ("released".equals(version.getStatus())) {
            throw AppException.badRequest("已发布的版本不能重新开始开发");
        }
        if (!"active".equals(version.getStatus())) {
            if (version.getStartDate() == null) {
                version.setStartDate(java.time.LocalDate.now());
            }
            version.setStatus("active");
            if (versionMapper.update(version) != 1) {
                throw new AppException(409, "版本已被其他人修改");
            }
            releaseService.log(userId, workspaceId, id, "version_start", null, null, version);
        }
        return getForUpdate(workspaceId, id);
    }

    @Transactional
    public void delete(String userId, String workspaceId, String id) {
        ProjectVersion version = get(workspaceId, id);
        projectAccess.assertView(workspaceId, userId, version.getReqId());
        projectAccess.assertWrite(workspaceId, userId, version.getReqId());
        scopeLock.lockProjects(workspaceId, version.getReqId());
        version = getForUpdate(workspaceId, id);
        projectAccess.assertWriteForUpdate(workspaceId, userId, version.getReqId());
        if ("released".equals(version.getStatus()) || !releases.selectRecordsForUpdate(workspaceId, id).isEmpty()) {
            throw new AppException(422, "已发布或已有发布尝试记录的版本不能删除");
        }
        if (!taskMapper.selectVersionReferenceTaskIdsForScope(workspaceId, id).isEmpty()
                || !taskMapper.selectVersionDemandIdsForScope(workspaceId, id).isEmpty()) {
            throw new AppException(422, "版本仍有任务、缺陷或需求引用（含回收站及取消需求）");
        }
        List<Task> projectTasks = releases.selectAllTasksByProjectForUpdate(workspaceId, version.getReqId());
        for (Task task : projectTasks) {
            if (id.equals(task.getFoundVersionId())) {
                throw new AppException(422, "版本仍有缺陷发现版本引用（含回收站）");
            }
            if (taskMapper.selectTaskVersionsForScope(workspaceId, task.getId()).contains(id)) {
                throw new AppException(422, "版本仍有关联任务（含回收站），请先填写原因调整任务版本");
            }
        }
        for (Demand demand : releases.selectDemandsByProjectForUpdate(workspaceId, version.getReqId())) {
            if (id.equals(demand.getVersionId())) {
                throw new AppException(422, "版本仍有需求目标引用，请先填写原因取消排期或调整目标版本");
            }
        }
        assertNoPlanOrLog(workspaceId, id);
        if (versionMapper.deleteById(workspaceId, id) != 1) {
            throw new AppException(409, "版本已变化，请刷新后重试");
        }
    }

    @Transactional
    public void deleteByReq(String workspaceId, String reqId) {
        assertProjectDeletable(workspaceId, reqId);
        for (ProjectVersion version : versionMapper.selectByReqForUpdate(workspaceId, reqId)) {
            assertNoPlanOrLog(workspaceId, version.getId());
        }
        versionTaskMapper.deleteByReq(workspaceId, reqId);
        versionMapper.deleteByReq(workspaceId, reqId);
    }

    @Transactional
    public void assertProjectDeletable(String workspaceId, String reqId) {
        scopeLock.lockProjects(workspaceId, reqId);
        if (!releases.selectRecordsByProjectForUpdate(workspaceId, reqId).isEmpty()) {
            throw new AppException(422, "项目已有发布记录，请归档而不是删除");
        }
        for (ProjectVersion version : versionMapper.selectByReqForUpdate(workspaceId, reqId)) {
            assertNoPlanOrLog(workspaceId, version.getId());
        }
    }

    private void assertNoPlanOrLog(String workspaceId, String versionId) {
        if (!taskMapper.selectVersionPlanIdsForScope(workspaceId, versionId).isEmpty()
                || !taskMapper.selectVersionAuditIdsForScope(workspaceId, versionId).isEmpty()) {
            throw new AppException(422, "版本已有发布计划或审计历史，请归档而不是删除");
        }
    }

    private ProjectVersion get(String workspaceId, String id) {
        ProjectVersion version = versionMapper.selectById(id);
        if (version == null || !workspaceId.equals(version.getWorkspaceId())) {
            throw AppException.notFound("版本不存在：" + id);
        }
        return version;
    }

    private ProjectVersion getForUpdate(String workspaceId, String id) {
        ProjectVersion version = versionMapper.selectByIdForUpdate(workspaceId, id);
        if (version == null || !workspaceId.equals(version.getWorkspaceId())) {
            throw AppException.notFound("版本不存在：" + id);
        }
        return version;
    }

    private void requireProject(String workspaceId, String reqId) {
        Requirement req = reqMapper.selectById(reqId);
        if (req == null || !workspaceId.equals(req.getWorkspaceId())) {
            throw AppException.notFound("项目不存在：" + reqId);
        }
    }

    private void requireUniqueName(String workspaceId, String reqId, String name, String excludeId) {
        if (!versionMapper.selectByNameForUpdate(workspaceId, reqId, name, excludeId).isEmpty()) {
            throw AppException.badRequest("版本「" + name + "」已存在");
        }
    }

    private String normalizeName(String raw) {
        String name = Texts.trimToNull(raw);
        if (name == null) {
            throw AppException.badRequest("请填写版本名称");
        }
        return name;
    }

    private String normalizeStatus(String raw) {
        return "active".equals(raw) ? "active" : "planned";
    }

    private void applyTasks(String userId, ProjectVersion version, List<String> requestedIds, String reasonRaw) {
        Set<String> selected = new LinkedHashSet<String>();
        for (String raw : requestedIds) {
            String id = Texts.trimToNull(raw);
            if (id == null) {
                throw AppException.badRequest("关联任务ID不能为空");
            }
            selected.add(id);
        }
        Map<String, Task> available = new java.util.TreeMap<String, Task>();
        for (Task task : releases.selectActiveTasksByProjectForUpdate(version.getWorkspaceId(), version.getReqId())) {
            available.put(task.getId(), task);
        }
        for (String taskId : selected) {
            if (!available.containsKey(taskId)) {
                throw AppException.badRequest("任务不存在、已删除或不属于该项目：" + taskId);
            }
        }
        List<Task> changed = new ArrayList<Task>();
        Map<String, List<String>> before = new HashMap<String, List<String>>();
        for (Task task : available.values()) {
            List<String> ids = taskMapper.selectTaskVersionsForScope(version.getWorkspaceId(), task.getId());
            before.put(task.getId(), ids);
            if (ids.contains(version.getId()) != selected.contains(task.getId())) changed.add(task);
        }
        if (changed.isEmpty()) return;
        if (!taskMapper.selectVersionSuccessIdsForScope(version.getWorkspaceId(), version.getId()).isEmpty()) {
            throw AppException.badRequest("版本已有成功正式发布记录，内容成员关系已冻结");
        }
        String reason = Texts.trimToNull(reasonRaw);
        if (reason == null) throw AppException.badRequest("请填写任务版本调整原因");
        permissions.assertManageProjectForUpdate(userId, version.getWorkspaceId(), version.getReqId());
        for (Task previous : changed) {
            Task task = scopeLock.lockTask(version.getWorkspaceId(), previous.getId());
            if (task.getDeletedAt() != null || !version.getReqId().equals(task.getReqId())) {
                throw new AppException(409, "任务所属项目或状态已变化，请刷新后重试");
            }
            List<String> oldIds = before.get(task.getId());
            List<String> newIds = new ArrayList<String>(oldIds);
            int count;
            if (selected.contains(task.getId())) {
                newIds.add(version.getId());
                count = versionTaskMapper.insertBatch(version.getWorkspaceId(), version.getId(), Collections.singletonList(task.getId()));
            } else {
                newIds.remove(version.getId());
                count = versionTaskMapper.deleteBinding(version.getWorkspaceId(), task.getId(), version.getId());
            }
            Collections.sort(newIds);
            if (count != 1 || taskMapper.touchDeliveryRevision(version.getWorkspaceId(), task.getId()) != 1) {
                throw new AppException(409, "任务版本关系已变化，请刷新后重试");
            }
            taskAudit.logChange(userId, version.getWorkspaceId(), task.getId(), "version_change", "调整规划版本",
                    Collections.singletonMap("versionIds", oldIds), Collections.singletonMap("versionIds", newIds), reason);
        }
        releaseService.log(userId, version.getWorkspaceId(), version.getId(), "version_scope", reason, null, selected);
    }

    private void validateDates(ProjectVersionSaveRequest request) {
        if (request.getStartDate() != null && request.getTargetDate() != null
                && request.getStartDate().isAfter(request.getTargetDate())) {
            throw AppException.badRequest("版本计划开始日期不能晚于目标发布日期");
        }
    }
}
