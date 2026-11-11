package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.common.Texts;
import com.hourglass.dto.ProjectMemberRoleOverview;
import com.hourglass.dto.ProjectMemberRoleView;
import com.hourglass.entity.ProjectMember;
import com.hourglass.entity.ProjectMemberRole;
import com.hourglass.entity.Requirement;
import com.hourglass.entity.WorkspaceMember;
import com.hourglass.mapper.ProjectMemberMapper;
import com.hourglass.mapper.ProjectMemberRoleMapper;
import com.hourglass.mapper.WorkspaceMemberMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 项目花名册与项目角色标注。
 *
 * <p>company_name / role_title 只做展示与筛选，不参与任何鉴权；
 * 读可见性复用 {@link ProjectAccessService}，写权限只决定“谁能改标签”。</p>
 */
@Service
public class ProjectMemberRoleService {

    private static final int MAX_ROLE_LENGTH = 32;

    private final WorkspaceMemberMapper memberMapper;
    private final ProjectMemberMapper projectMemberMapper;
    private final ProjectMemberRoleMapper roleMapper;
    private final ProjectAccessService projectAccess;

    public ProjectMemberRoleService(WorkspaceMemberMapper memberMapper,
                                    ProjectMemberMapper projectMemberMapper,
                                    ProjectMemberRoleMapper roleMapper,
                                    ProjectAccessService projectAccess) {
        this.memberMapper = memberMapper;
        this.projectMemberMapper = projectMemberMapper;
        this.roleMapper = roleMapper;
        this.projectAccess = projectAccess;
    }

    /** 项目花名册：当前可见、且不是空间查看者的成员。 */
    public ProjectMemberRoleOverview roster(String workspaceId, Requirement project, String viewerId) {
        boolean canEdit = canEditRole(workspaceId, project, viewerId);
        Map<String, String> roles = new HashMap<String, String>();
        for (ProjectMemberRole r : roleMapper.selectByProject(workspaceId, project.getId())) {
            roles.put(r.getUserId(), r.getRoleTitle());
        }
        Map<String, String> grants = new HashMap<String, String>();
        for (ProjectMember pm : projectMemberMapper.selectByWorkspace(workspaceId)) {
            if (project.getId().equals(pm.getProjectId())) {
                grants.put(pm.getUserId(), pm.getAccess());
            }
        }

        List<ProjectMemberRoleView> views = new ArrayList<ProjectMemberRoleView>();
        for (WorkspaceMember m : memberMapper.selectByWorkspace(workspaceId)) {
            String role = m.getRole();
            if (ProjectAccessService.isViewer(role)) {
                continue;
            }
            String access;
            if (ProjectAccessService.isPrivileged(role)) {
                access = ProjectAccessService.ACCESS_WRITE;
            } else {
                access = ProjectAccessService.effectiveOfConfigured(m, grants.get(m.getUserId()));
                if (ProjectAccessService.ACCESS_NONE.equals(access)) {
                    continue;
                }
            }
            ProjectMemberRoleView view = new ProjectMemberRoleView();
            view.setUserId(m.getUserId());
            view.setDisplayName(m.getDisplayName());
            view.setUsername(m.getUsername());
            view.setCompanyName(m.getCompanyName());
            view.setRoleTitle(roles.get(m.getUserId()));
            view.setAccess(access);
            view.setSource(sourceOf(project, m));
            view.setCanEditRole(canEdit);
            views.add(view);
        }

        ProjectMemberRoleOverview overview = new ProjectMemberRoleOverview();
        overview.setMembers(views);
        overview.setCanEditRole(canEdit);
        return overview;
    }

    /**
     * 保存项目角色：空间主/管理员或项目负责人可写；目标必须当前能看到该项目且不是查看者。
     * 空角色删除该行，不保留空字符串。
     */
    @Transactional
    public String saveRole(String workspaceId, Requirement project, String targetUserId,
                           String roleTitle, String operatorId) {
        String operatorRole = projectAccess.roleOf(workspaceId, operatorId);
        if (ProjectAccessService.isViewer(operatorRole)) {
            throw new AppException(403, "你在此空间是查看者，只能查看不能修改");
        }
        boolean allowed = ProjectAccessService.isPrivileged(operatorRole)
                || (project.getOwnerUserId() != null && project.getOwnerUserId().equals(operatorId));
        if (!allowed) {
            throw new AppException(403, "仅空间主、空间管理员或项目负责人可标注项目角色");
        }

        WorkspaceMember target = memberMapper.selectMember(workspaceId, targetUserId);
        if (target == null) {
            throw AppException.notFound("成员不存在：" + targetUserId);
        }
        if (ProjectAccessService.isViewer(target.getRole())) {
            throw AppException.badRequest("空间查看者不参与项目，不能标注项目角色");
        }
        if (!projectAccess.canView(workspaceId, targetUserId, project.getId())) {
            throw AppException.badRequest("该成员当前看不到此项目，不能标注项目角色");
        }

        String title = Texts.trimToNull(roleTitle);
        if (title == null) {
            roleMapper.deleteOne(workspaceId, project.getId(), targetUserId);
            return "";
        }
        if (title.length() > MAX_ROLE_LENGTH) {
            throw AppException.badRequest("项目角色不能超过 " + MAX_ROLE_LENGTH + " 个字符");
        }
        ProjectMemberRole row = new ProjectMemberRole();
        row.setWorkspaceId(workspaceId);
        row.setProjectId(project.getId());
        row.setUserId(targetUserId);
        row.setRoleTitle(title);
        roleMapper.upsert(row);
        return title;
    }

    /** 标签写权限：空间主/管理员，或该项目的负责人；查看者不能写。 */
    public boolean canEditRole(String workspaceId, Requirement project, String userId) {
        String role = projectAccess.roleOf(workspaceId, userId);
        if (ProjectAccessService.isViewer(role)) {
            return false;
        }
        return ProjectAccessService.isPrivileged(role)
                || (project.getOwnerUserId() != null && project.getOwnerUserId().equals(userId));
    }

    /** 来源解释的是“为什么能看到”，不是权限值本身。 */
    private static String sourceOf(Requirement project, WorkspaceMember m) {
        if (project.getOwnerUserId() != null && project.getOwnerUserId().equals(m.getUserId())) {
            return "项目负责人";
        }
        if (ProjectAccessService.ROLE_OWNER.equals(m.getRole())) {
            return "空间主";
        }
        if (ProjectAccessService.ROLE_ADMIN.equals(m.getRole())) {
            return "空间管理员";
        }
        if (!ProjectAccessService.isAssigned(m)) {
            return "空间默认参与";
        }
        return "项目授权";
    }
}
