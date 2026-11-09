package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.entity.ProjectVersion;
import com.hourglass.entity.Requirement;
import com.hourglass.entity.Task;
import com.hourglass.entity.WorkspaceMember;
import com.hourglass.mapper.RequirementMapper;
import com.hourglass.mapper.WorkspaceMemberMapper;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;

@Service
public class ReleasePermissionService {
    private final WorkspaceMemberMapper memberMapper;
    private final RequirementMapper reqMapper;
    private final ProjectAccessService projectAccess;

    public ReleasePermissionService(WorkspaceMemberMapper memberMapper, RequirementMapper reqMapper,
                                    ProjectAccessService projectAccess) {
        this.memberMapper = memberMapper;
        this.reqMapper = reqMapper;
        this.projectAccess = projectAccess;
    }

    private boolean writable(String userId, String workspaceId, String reqId) {
        WorkspaceMember member = memberMapper.selectMember(workspaceId, userId);
        return member != null && !"viewer".equals(member.getRole())
                && projectAccess.canWrite(workspaceId, userId, reqId);
    }

    public boolean canManageProject(String userId, String workspaceId, String reqId) {
        if (!writable(userId, workspaceId, reqId)) {
            return false;
        }
        WorkspaceMember member = memberMapper.selectMember(workspaceId, userId);
        if ("owner".equals(member.getRole()) || "admin".equals(member.getRole())) {
            return true;
        }
        Requirement project = reqId == null ? null : reqMapper.selectById(reqId);
        return project != null && workspaceId.equals(project.getWorkspaceId())
                && userId.equals(project.getOwnerUserId());
    }

    public void assertManageProject(String userId, String workspaceId, String reqId) {
        projectAccess.assertView(workspaceId, userId, reqId);
        if (!canManageProject(userId, workspaceId, reqId)) {
            throw new AppException(403, "仅空间主、管理员或项目负责人可管理排期与发布计划");
        }
    }

    /** Locking assertions are for delivery writes only, after project/task scope locks. */
    private Map<String, Object> writableSnapshot(String userId, String workspaceId, String reqId) {
        Map<String, Object> snapshot = memberMapper.selectDeliveryAccessForUpdate(workspaceId, userId, reqId);
        if (snapshot == null || snapshot.get("role") == null) {
            throw AppException.notFound("项目不存在或你没有访问权限：" + reqId);
        }
        String role = (String) snapshot.get("role");
        if (ProjectAccessService.isPrivileged(role)) {
            return snapshot;
        }
        if (ProjectAccessService.isViewer(role)) {
            throw new AppException(403, "你在此空间是查看者，只能查看不能修改");
        }
        if (ProjectAccessService.ACCESS_NONE.equals(snapshot.get("access"))) {
            throw AppException.notFound("项目不存在或你没有访问权限：" + reqId);
        }
        if (ProjectAccessService.ACCESS_READ.equals(snapshot.get("access"))) {
            throw new AppException(403, "你对该项目只有查看权限");
        }
        return snapshot;
    }

    private boolean managesSnapshot(String userId, Map<String, Object> snapshot) {
        return ProjectAccessService.isPrivileged((String) snapshot.get("role"))
                || userId.equals(snapshot.get("projectOwnerUserId"));
    }

    public void assertManageProjectForUpdate(String userId, String workspaceId, String reqId) {
        Map<String, Object> snapshot = writableSnapshot(userId, workspaceId, reqId);
        if (!managesSnapshot(userId, snapshot)) {
            throw new AppException(403, "仅空间主、管理员或项目负责人可管理排期与发布计划");
        }
    }

    public void assertPublishTaskForUpdate(String userId, String workspaceId, Task task) {
        throw new AppException(403, "任务发布摘要为只读，请录入正式发布事实");
    }

    public void assertPublishVersionForUpdate(String userId, String workspaceId, ProjectVersion version, List<Task> tasks) {
        assertManageProjectForUpdate(userId, workspaceId, version.getReqId());
    }

    public void assertViewTask(String userId, String workspaceId, Task task) {
        projectAccess.assertViewTask(workspaceId, userId, task);
    }

    public boolean canViewProject(String userId, String workspaceId, String reqId) {
        return projectAccess.canView(workspaceId, userId, reqId);
    }

    public boolean canPublishTask(String userId, String workspaceId, Task task) {
        return false;
    }

    public void assertPublishTask(String userId, String workspaceId, Task task) {
        projectAccess.assertViewTask(workspaceId, userId, task);
        throw new AppException(403, "任务发布摘要为只读，请录入正式发布事实");
    }

    public boolean canPublishVersion(String userId, String workspaceId, ProjectVersion version, List<Task> tasks) {
        return canManageProject(userId, workspaceId, version.getReqId());
    }

    public void assertPublishVersion(String userId, String workspaceId, ProjectVersion version, List<Task> tasks) {
        projectAccess.assertView(workspaceId, userId, version.getReqId());
        if (!canPublishVersion(userId, workspaceId, version, tasks)) {
            throw new AppException(403, "仅空间主、管理员或项目负责人可录入发布事实");
        }
    }
}
