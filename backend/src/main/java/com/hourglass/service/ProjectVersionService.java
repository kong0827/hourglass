package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.common.Ids;
import com.hourglass.common.Texts;
import com.hourglass.dto.ProjectVersionSaveRequest;
import com.hourglass.entity.ProjectVersion;
import com.hourglass.entity.Requirement;
import com.hourglass.entity.Task;
import com.hourglass.mapper.DemandMapper;
import com.hourglass.mapper.ProjectVersionMapper;
import com.hourglass.mapper.RequirementMapper;
import com.hourglass.mapper.VersionTaskMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

@Service
public class ProjectVersionService {

    private final ProjectVersionMapper versionMapper;
    private final VersionTaskMapper versionTaskMapper;
    private final RequirementMapper reqMapper;
    private final DemandMapper demandMapper;
    private final ProjectAccessService projectAccess;
    private final NotificationEventService notificationEvents;

    public ProjectVersionService(ProjectVersionMapper versionMapper, VersionTaskMapper versionTaskMapper,
                                 RequirementMapper reqMapper, DemandMapper demandMapper,
                                 ProjectAccessService projectAccess,
                                 NotificationEventService notificationEvents) {
        this.versionMapper = versionMapper;
        this.versionTaskMapper = versionTaskMapper;
        this.reqMapper = reqMapper;
        this.demandMapper = demandMapper;
        this.projectAccess = projectAccess;
        this.notificationEvents = notificationEvents;
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
        for (Task task : versionTaskMapper.selectOptionsByReq(workspaceId, reqId)) {
            if (task.getVersionId() == null) {
                continue;
            }
            List<Task> tasks = tasksByVersion.get(task.getVersionId());
            if (tasks == null) {
                tasks = new ArrayList<Task>();
                tasksByVersion.put(task.getVersionId(), tasks);
            }
            tasks.add(task);
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
        }
        return versions;
    }

    public List<Task> taskOptions(String workspaceId, String reqId) {
        return taskOptions(workspaceId, reqId, null);
    }

    public List<Task> taskOptions(String workspaceId, String reqId, String userId) {
        requireProject(workspaceId, reqId);
        projectAccess.assertView(workspaceId, userId, reqId);
        return versionTaskMapper.selectOptionsByReq(workspaceId, reqId);
    }

    @Transactional
    public ProjectVersion create(String userId, String workspaceId, ProjectVersionSaveRequest req) {
        requireProject(workspaceId, req.getReqId());
        projectAccess.assertWrite(workspaceId, userId, req.getReqId());
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
            applyTasks(version, req.getTaskIds());
        }
        return get(workspaceId, version.getId());
    }

    @Transactional
    public ProjectVersion update(String userId, String workspaceId, String id, ProjectVersionSaveRequest req) {
        ProjectVersion old = get(workspaceId, id);
        projectAccess.assertView(workspaceId, userId, old.getReqId());
        if (!old.getReqId().equals(req.getReqId())) {
            throw AppException.badRequest("版本不能移到其他项目");
        }
        projectAccess.assertWrite(workspaceId, userId, old.getReqId());
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
        versionMapper.update(old);
        if (req.getTaskIds() != null) {
            applyTasks(old, req.getTaskIds());
        }
        return get(workspaceId, id);
    }

    @Transactional
    public ProjectVersion publish(String userId, String workspaceId, String id) {
        ProjectVersion version = get(workspaceId, id);
        projectAccess.assertView(workspaceId, userId, version.getReqId());
        projectAccess.assertWrite(workspaceId, userId, version.getReqId());
        boolean releasing = !"released".equals(version.getStatus());
        if (releasing) {
            versionMapper.release(workspaceId, id);
            notifyReleased(version, userId);
        }
        return get(workspaceId, id);
    }

    /** 开始开发：待规划 → 开发中；缺开始日期时补今天，让版本周期窗口完整展示 */
    @Transactional
    public ProjectVersion start(String userId, String workspaceId, String id) {
        ProjectVersion version = get(workspaceId, id);
        projectAccess.assertView(workspaceId, userId, version.getReqId());
        projectAccess.assertWrite(workspaceId, userId, version.getReqId());
        if ("released".equals(version.getStatus())) {
            throw AppException.badRequest("已发布的版本不能重新开始开发");
        }
        if (!"active".equals(version.getStatus())) {
            if (version.getStartDate() == null) {
                version.setStartDate(java.time.LocalDate.now());
            }
            version.setStatus("active");
            versionMapper.update(version);
        }
        return get(workspaceId, id);
    }

    @Transactional
    public void delete(String userId, String workspaceId, String id) {
        ProjectVersion version = get(workspaceId, id);
        projectAccess.assertView(workspaceId, userId, version.getReqId());
        projectAccess.assertWrite(workspaceId, userId, version.getReqId());
        Map<String, Integer> taskCountByOwner = taskCountByOwner(version, userId);
        versionTaskMapper.deleteByVersion(workspaceId, id);
        /* 需求池的「目标版本」指向该版本：删版本时同步解绑，避免排期悬挂 */
        demandMapper.clearVersionRefsByVersion(workspaceId, id);
        versionMapper.deleteById(workspaceId, id);
        notifyDeleted(version, userId, taskCountByOwner);
    }

    @Transactional
    public void deleteByReq(String workspaceId, String reqId) {
        versionTaskMapper.deleteByReq(workspaceId, reqId);
        versionMapper.deleteByReq(workspaceId, reqId);
    }

    /** 版本发布：按负责人聚合版本内任务，每人一条通知（操作者本人跳过） */
    private void notifyReleased(ProjectVersion version, String actorId) {
        for (Map.Entry<String, Integer> entry : taskCountByOwner(version, actorId).entrySet()) {
            notificationEvents.notify(entry.getKey(), version.getWorkspaceId(),
                    UserNotificationPreferenceService.DEMAND_STATUS,
                    "版本「" + version.getName() + "」已发布",
                    "你负责的 " + entry.getValue() + " 项任务已随该版本发布",
                    null, version.getReqId());
        }
    }

    /** 版本删除：在解绑任务前收集负责人，删除后每人一条通知 */
    private void notifyDeleted(ProjectVersion version, String actorId,
                               Map<String, Integer> taskCountByOwner) {
        for (Map.Entry<String, Integer> entry : taskCountByOwner.entrySet()) {
            notificationEvents.notify(entry.getKey(), version.getWorkspaceId(),
                    UserNotificationPreferenceService.DEMAND_STATUS,
                    "版本「" + version.getName() + "」已删除",
                    "你负责的 " + entry.getValue() + " 项任务已随该版本解绑",
                    null, version.getReqId());
        }
    }

    private Map<String, Integer> taskCountByOwner(ProjectVersion version, String actorId) {
        Map<String, Integer> taskCountByOwner = new LinkedHashMap<String, Integer>();
        for (Task task : versionTaskMapper.selectOptionsByReq(version.getWorkspaceId(), version.getReqId())) {
            if (!version.getId().equals(task.getVersionId())) {
                continue;
            }
            String owner = Texts.trimToNull(task.getOwnerUserId());
            if (owner == null || owner.equals(actorId)) {
                continue;
            }
            Integer count = taskCountByOwner.get(owner);
            taskCountByOwner.put(owner, count == null ? 1 : count + 1);
        }
        return taskCountByOwner;
    }

    private ProjectVersion get(String workspaceId, String id) {
        ProjectVersion version = versionMapper.selectById(id);
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
        if (versionMapper.countByName(workspaceId, reqId, name, excludeId) > 0) {
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

    private void applyTasks(ProjectVersion version, List<String> requestedIds) {
        Set<String> uniqueIds = new LinkedHashSet<String>();
        for (String raw : requestedIds) {
            String id = Texts.trimToNull(raw);
            if (id == null) {
                throw AppException.badRequest("关联任务ID不能为空");
            }
            uniqueIds.add(id);
        }
        Map<String, Task> available = new HashMap<String, Task>();
        for (Task task : versionTaskMapper.selectOptionsByReq(version.getWorkspaceId(), version.getReqId())) {
            available.put(task.getId(), task);
        }
        List<String> taskIds = new ArrayList<String>(uniqueIds);
        for (String taskId : taskIds) {
            if (!available.containsKey(taskId)) {
                throw AppException.badRequest("任务不存在、已删除或不属于该项目：" + taskId);
            }
        }
        versionTaskMapper.deleteByVersion(version.getWorkspaceId(), version.getId());
        if (!taskIds.isEmpty()) {
            versionTaskMapper.deleteByTaskIds(version.getWorkspaceId(), taskIds);
            versionTaskMapper.insertBatch(version.getWorkspaceId(), version.getId(), taskIds);
        }
    }
}
