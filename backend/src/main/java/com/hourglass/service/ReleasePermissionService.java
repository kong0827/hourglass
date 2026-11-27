package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.entity.Requirement;
import com.hourglass.entity.Task;
import com.hourglass.entity.WorkspaceMember;
import com.hourglass.mapper.RequirementMapper;
import com.hourglass.mapper.WorkspaceMemberMapper;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Service
public class ReleasePermissionService {
    private final WorkspaceMemberMapper memberMapper;
    private final RequirementMapper reqMapper;
    private final ProjectAccessService projectAccess;
    private final ReleaseAccessScopeService releaseAccessScopes;

    public ReleasePermissionService(WorkspaceMemberMapper memberMapper, RequirementMapper reqMapper,
                                    ProjectAccessService projectAccess, ReleaseAccessScopeService releaseAccessScopes) {
        this.memberMapper = memberMapper;
        this.reqMapper = reqMapper;
        this.projectAccess = projectAccess;
        this.releaseAccessScopes = releaseAccessScopes;
    }

    private boolean writable(WorkspaceMember member, String workspaceId, String reqId) {
        return member != null && projectAccess.canWrite(member, workspaceId, reqId);
    }

    public boolean canManageProject(String userId, String workspaceId, String reqId) {
        WorkspaceMember member = memberMapper.selectMember(workspaceId, userId);
        if (!writable(member, workspaceId, reqId)) {
            return false;
        }
        if (ProjectAccessService.isPrivileged(member.getRole())) {
            return true;
        }
        Requirement project = reqId == null ? null : reqMapper.selectById(reqId);
        return project != null && workspaceId.equals(project.getWorkspaceId())
                && userId.equals(project.getOwnerUserId());
    }

    public void assertManageProject(String userId, String workspaceId, String reqId) {
        projectAccess.assertView(workspaceId, userId, reqId);
        if (!canManageProject(userId, workspaceId, reqId)) {
            throw new AppException(403, "仅空间主、管理员或项目负责人可执行该项目级管理操作");
        }
    }

    /**
     * 发布计划与发布记录：按空间配置，默认「空间主、管理员、项目负责人」；
     * 空间可加选「项目可写成员」，查看者永远无权。
     */
    public boolean canManageRelease(String userId, String workspaceId, String reqId) {
        WorkspaceMember member = memberMapper.selectMember(workspaceId, userId);
        return member != null && allowsScope(member, userId, workspaceId, reqId,
                releaseAccessScopes.get(workspaceId));
    }

    /** 人工标记工作项发布：按空间级「人工标记工作项发布」配置判定。 */
    public boolean canJudgePublication(String userId, String workspaceId, String reqId) {
        WorkspaceMember member = memberMapper.selectMember(workspaceId, userId);
        return member != null && allowsScope(member, userId, workspaceId, reqId,
                releaseAccessScopes.getPublication(workspaceId));
    }

    /**
     * 列表批量下发人工标记入口：同一项目只判一次，避免逐任务重复查项目成员与负责人。
     * 只用于展示入口，写操作仍走 assertJudgePublication。
     */
    public void markJudgeable(String userId, String workspaceId, List<Task> tasks) {
        if (tasks == null || tasks.isEmpty()) {
            return;
        }
        WorkspaceMember member = memberMapper.selectMember(workspaceId, userId);
        List<String> scope = member == null ? null : releaseAccessScopes.getPublication(workspaceId);
        Map<String, Boolean> byProject = new HashMap<String, Boolean>();
        for (Task task : tasks) {
            String key = task.getReqId() == null ? "" : task.getReqId();
            Boolean can = byProject.get(key);
            if (can == null) {
                can = member != null && allowsScope(member, userId, workspaceId, task.getReqId(), scope);
                byProject.put(key, can);
            }
            task.setCanJudgePublication(can);
        }
    }

    public void assertManageRelease(String userId, String workspaceId, String reqId) {
        projectAccess.assertView(workspaceId, userId, reqId);
        WorkspaceMember member = memberMapper.selectMember(workspaceId, userId);
        if (member != null && ProjectAccessService.isViewer(member.getRole())) {
            throw new AppException(403, "你在此空间是查看者，只能查看不能修改");
        }
        List<String> scope = releaseAccessScopes.get(workspaceId);
        if (member != null && allowsScope(member, userId, workspaceId, reqId, scope)) {
            return;
        }
        if (member == null || !projectAccess.canWrite(member, workspaceId, reqId)) {
            throw new AppException(403, "你对该项目没有写权限，不能维护发布计划或记录发布");
        }
        throw new AppException(403, "空间把「维护发布计划与发布记录」限定为「"
                + ReleaseAccessScopeService.text(scope)
                + "」；如需放开，请在「设置 → 工作流 → 发布权限」中勾选你的身份");
    }

    /** 人工标记工作项发布：按空间配置判定，查看者与只读成员始终无权。 */
    public void assertJudgePublication(String userId, String workspaceId, String reqId) {
        projectAccess.assertView(workspaceId, userId, reqId);
        WorkspaceMember member = memberMapper.selectMember(workspaceId, userId);
        if (member != null && ProjectAccessService.isViewer(member.getRole())) {
            throw new AppException(403, "你在此空间是查看者，只能查看不能修改");
        }
        List<String> scope = releaseAccessScopes.getPublication(workspaceId);
        if (member != null && allowsScope(member, userId, workspaceId, reqId, scope)) {
            return;
        }
        if (member == null || !projectAccess.canWrite(member, workspaceId, reqId)) {
            throw new AppException(403, "你对该项目没有写权限，不能标记工作项发布状态");
        }
        throw new AppException(403, "空间把「人工标记工作项发布」限定为「"
                + ReleaseAccessScopeService.text(scope)
                + "」；如需放开，请在「设置 → 工作流 → 发布权限」中勾选你的身份");
    }

    /** 身份与空间配置的匹配；写权限只在「项目负责人 / 项目可写成员」两档下才需要。 */
    private boolean allowsScope(WorkspaceMember member, String userId, String workspaceId, String reqId,
                                List<String> scope) {
        String role = member.getRole();
        if (ProjectAccessService.isViewer(role)) {
            return false;
        }
        if (scope.contains(ReleaseAccessScopeService.SCOPE_OWNER) && "owner".equals(role)) {
            return true;
        }
        if (scope.contains(ReleaseAccessScopeService.SCOPE_ADMIN) && "admin".equals(role)) {
            return true;
        }
        if (!projectAccess.canWrite(member, workspaceId, reqId)) {
            return false;
        }
        if (scope.contains(ReleaseAccessScopeService.SCOPE_PROJECT_WRITE)) {
            return true;
        }
        if (scope.contains(ReleaseAccessScopeService.SCOPE_PROJECT_OWNER)) {
            Requirement project = reqId == null ? null : reqMapper.selectById(reqId);
            return project != null && workspaceId.equals(project.getWorkspaceId())
                    && userId.equals(project.getOwnerUserId());
        }
        return false;
    }

    /** Locking assertions are for delivery writes only, after project/task scope locks. */
    private Map<String, Object> writableSnapshot(String userId, String workspaceId, String reqId) {
        return writableSnapshot(userId, workspaceId, reqId, "你对该项目只有测试权限，不能修改工作项");
    }

    private Map<String, Object> writableSnapshot(String userId, String workspaceId, String reqId,
                                                 String testOnlyMessage) {
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
        if (ProjectAccessService.ACCESS_TEST.equals(snapshot.get("access"))) {
            throw new AppException(403, testOnlyMessage);
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
            throw new AppException(403, "仅空间主、管理员或项目负责人可执行该项目级管理操作");
        }
    }

    /** 发布写入的锁后复核：写权限与空间配置一起复核，避免锁前通过、锁后被撤权 */
    public void assertManageReleaseForUpdate(String userId, String workspaceId, String reqId) {
        Map<String, Object> snapshot = writableSnapshot(userId, workspaceId, reqId,
                "你对该项目只有测试权限，不能维护发布计划或记录发布");
        List<String> scope = releaseAccessScopes.get(workspaceId);
        String role = (String) snapshot.get("role");
        if (scope.contains(ReleaseAccessScopeService.SCOPE_OWNER) && "owner".equals(role)) {
            return;
        }
        if (scope.contains(ReleaseAccessScopeService.SCOPE_ADMIN) && "admin".equals(role)) {
            return;
        }
        /* writableSnapshot 已确认可写（查看 / 不可见 / 仅测试均已抛出） */
        if (scope.contains(ReleaseAccessScopeService.SCOPE_PROJECT_WRITE)) {
            return;
        }
        if (scope.contains(ReleaseAccessScopeService.SCOPE_PROJECT_OWNER)
                && userId.equals(snapshot.get("projectOwnerUserId"))) {
            return;
        }
        throw new AppException(403, "空间把「维护发布计划与发布记录」限定为「"
                + ReleaseAccessScopeService.text(scope)
                + "」；如需放开，请在「设置 → 工作流 → 发布权限」中勾选你的身份");
    }

    public void assertViewTask(String userId, String workspaceId, Task task) {
        projectAccess.assertViewTask(workspaceId, userId, task);
    }

    public boolean canViewProject(String userId, String workspaceId, String reqId) {
        return projectAccess.canView(workspaceId, userId, reqId);
    }
}
