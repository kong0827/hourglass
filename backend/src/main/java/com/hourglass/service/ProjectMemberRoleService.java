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
import com.hourglass.mapper.RequirementMapper;
import com.hourglass.mapper.WorkspaceMemberLabelOptionMapper;
import com.hourglass.mapper.WorkspaceMemberMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 项目花名册与项目角色标注。
 *
 * <p>company_name / job_title / role_title / secondary_role_titles 只做展示与筛选，不参与任何鉴权；
 * 读可见性复用 {@link ProjectAccessService}，写权限只决定“谁能改标签”。</p>
 */
@Service
public class ProjectMemberRoleService {

    private static final int MAX_ROLE_LENGTH = 32;

    private final WorkspaceMemberMapper memberMapper;
    private final ProjectMemberMapper projectMemberMapper;
    private final ProjectMemberRoleMapper roleMapper;
    private final ProjectAccessService projectAccess;
    private final RequirementMapper projects;
    private final WorkspaceMemberLabelOptionMapper options;
    private final MemberLabelLogService labelLogs;

    public ProjectMemberRoleService(WorkspaceMemberMapper memberMapper,
                                    ProjectMemberMapper projectMemberMapper,
                                    ProjectMemberRoleMapper roleMapper,
                                    ProjectAccessService projectAccess,
                                    RequirementMapper projects,
                                    WorkspaceMemberLabelOptionMapper options,
                                    MemberLabelLogService labelLogs) {
        this.memberMapper = memberMapper;
        this.projectMemberMapper = projectMemberMapper;
        this.roleMapper = roleMapper;
        this.projectAccess = projectAccess;
        this.projects = projects;
        this.options = options;
        this.labelLogs = labelLogs;
    }

    /** 项目花名册：当前可见、且不是空间查看者的成员。 */
    public ProjectMemberRoleOverview roster(String workspaceId, Requirement project, String viewerId) {
        requireSameWorkspace(workspaceId, project);
        projectAccess.assertView(workspaceId, viewerId, project.getId());
        boolean canEdit = canEditRole(workspaceId, project, viewerId);
        Map<String, ProjectMemberRole> roles = rolesByUser(workspaceId, project.getId());
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
            ProjectMemberRole row = roles.get(m.getUserId());
            String override = row == null ? null : row.getRoleTitle();
            String primary = Texts.trimToNull(override);
            String job = Texts.trimToNull(m.getJobTitle());
            view.setRoleTitle(override);
            view.setJobTitle(m.getJobTitle());
            view.setEffectiveRoleTitle(primary != null ? primary : job);
            view.setRoleSource(primary != null ? "project" : job != null ? "workspace" : "unset");
            view.setSecondaryRoleTitles(secondaryOf(row));
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

    /** 未提供兼岗字段时保持既有值；空主职能且无兼岗才删除覆盖行。 */
    @Transactional
    public String saveRole(String workspaceId, Requirement project, String targetUserId,
                           String roleTitle, String operatorId) {
        return saveRole(workspaceId, project, targetUserId, roleTitle, null, operatorId);
    }

    @Transactional
    public String saveRole(String workspaceId, Requirement project, String targetUserId,
                           String roleTitle, List<String> secondaryRoleTitles, String operatorId) {
        options.lockWorkspace(workspaceId);
        requireEdit(workspaceId, project, operatorId);
        requireTarget(workspaceId, project.getId(), targetUserId);
        ProjectMemberRole row = prepare(workspaceId, project.getId(), targetUserId, roleTitle,
                secondaryRoleTitles, roleMapper.selectOne(workspaceId, project.getId(), targetUserId));
        write(row);
        labelLogs.record(workspaceId, operatorId, "project_role", "project", project.getId(), project.getName(),
                "标注成员「" + targetUserId + "」在项目「" + project.getName() + "」的职能：" + describe(row));
        return row.getRoleTitle();
    }

    /** 全体验证后再写入；业务、活动及审计共用一个事务。 */
    @Transactional
    public Map<String, Integer> saveRoles(String workspaceId, Requirement project, List<String> userIds,
                                         String roleTitle, List<String> secondaryRoleTitles, String operatorId) {
        options.lockWorkspace(workspaceId);
        requireEdit(workspaceId, project, operatorId);
        if (userIds == null || userIds.isEmpty()) throw AppException.badRequest("请选择成员");
        Set<String> ids = new LinkedHashSet<String>();
        for (String raw : userIds) {
            String id = Texts.trimToNull(raw);
            if (id == null) throw AppException.badRequest("成员 ID 不能为空");
            ids.add(id);
            if (ids.size() > 200) throw AppException.badRequest("每批最多 200 名成员");
        }
        Map<String, ProjectMemberRole> existing = rolesByUser(workspaceId, project.getId());
        List<ProjectMemberRole> rows = new ArrayList<ProjectMemberRole>();
        for (String id : ids) {
            requireTarget(workspaceId, project.getId(), id);
            rows.add(prepare(workspaceId, project.getId(), id, roleTitle, secondaryRoleTitles, existing.get(id)));
        }
        for (ProjectMemberRole row : rows) write(row);
        labelLogs.record(workspaceId, operatorId, "project_role", "project", project.getId(), project.getName(),
                "批量标注项目「" + project.getName() + "」职能，共 " + rows.size() + " 名成员；主职能："
                        + normalizeTitle(roleTitle, 32) + "；兼岗："
                        + (secondaryRoleTitles == null ? "保持原值" : normalizeSecondary(secondaryRoleTitles, normalizeTitle(roleTitle, 32))));
        return Collections.singletonMap("updated", rows.size());
    }

    /** 源有效职能形成目标快照；仅两项目均可见的非查看者参与复制。 */
    @Transactional
    public Map<String, Integer> copyRoles(String workspaceId, Requirement target, String sourceProjectId,
                                         boolean overwrite, String operatorId) {
        options.lockWorkspace(workspaceId);
        requireEdit(workspaceId, target, operatorId);
        String sourceId = Texts.trimToNull(sourceProjectId);
        if (sourceId == null) throw AppException.badRequest("请选择来源项目");
        Requirement source = projects.selectById(sourceId);
        requireSameWorkspace(workspaceId, source);
        projectAccess.assertView(workspaceId, operatorId, sourceId);
        Map<String, ProjectMemberRole> sourceRows = rolesByUser(workspaceId, sourceId);
        Map<String, ProjectMemberRole> targetRows = rolesByUser(workspaceId, target.getId());
        List<ProjectMemberRole> planned = new ArrayList<ProjectMemberRole>();
        int skipped = 0;
        for (WorkspaceMember member : memberMapper.selectByWorkspace(workspaceId)) {
            if (ProjectAccessService.isViewer(member.getRole())
                    || !projectAccess.canView(workspaceId, member.getUserId(), sourceId)
                    || !projectAccess.canView(workspaceId, member.getUserId(), target.getId())) continue;
            ProjectMemberRole sourceRow = sourceRows.get(member.getUserId());
            String primary = sourceRow == null ? null : Texts.trimToNull(sourceRow.getRoleTitle());
            if (primary == null) primary = Texts.trimToNull(member.getJobTitle());
            List<String> secondary = secondaryOf(sourceRow);
            if (primary == null && secondary.isEmpty()) continue;
            ProjectMemberRole current = targetRows.get(member.getUserId());
            if (!overwrite && current != null && (Texts.trimToNull(current.getRoleTitle()) != null
                    || !secondaryOf(current).isEmpty())) {
                skipped++;
                continue;
            }
            planned.add(prepare(workspaceId, target.getId(), member.getUserId(), primary, secondary, null));
        }
        for (ProjectMemberRole row : planned) write(row);
        labelLogs.record(workspaceId, operatorId, "project_role", "project", target.getId(), target.getName(),
                "复制项目「" + source.getName() + "」职能至「" + target.getName() + "」：复制 " + planned.size()
                        + "，跳过 " + skipped + "，覆盖=" + overwrite);
        Map<String, Integer> result = new LinkedHashMap<String, Integer>();
        result.put("copied", planned.size());
        result.put("skipped", skipped);
        return result;
    }

    private void requireEdit(String workspaceId, Requirement project, String userId) {
        requireSameWorkspace(workspaceId, project);
        projectAccess.assertView(workspaceId, userId, project.getId());
        if (!canEditRole(workspaceId, project, userId)) {
            throw new AppException(403, "仅空间主、空间管理员或项目负责人可标注项目角色");
        }
    }

    private void requireTarget(String workspaceId, String projectId, String userId) {
        WorkspaceMember target = memberMapper.selectMember(workspaceId, userId);
        if (target == null) throw AppException.notFound("成员不存在：" + userId);
        if (ProjectAccessService.isViewer(target.getRole())) throw AppException.badRequest("空间查看者不参与项目");
        if (!projectAccess.canView(workspaceId, userId, projectId)) {
            throw AppException.badRequest("该成员当前看不到此项目，不能标注项目角色");
        }
    }

    private static void requireSameWorkspace(String workspaceId, Requirement project) {
        if (project == null || !workspaceId.equals(project.getWorkspaceId())) {
            throw AppException.notFound("项目不存在或不属于当前空间");
        }
    }

    private Map<String, ProjectMemberRole> rolesByUser(String workspaceId, String projectId) {
        Map<String, ProjectMemberRole> result = new HashMap<String, ProjectMemberRole>();
        for (ProjectMemberRole row : roleMapper.selectByProject(workspaceId, projectId)) result.put(row.getUserId(), row);
        return result;
    }

    private static List<String> secondaryOf(ProjectMemberRole row) {
        return row == null || row.getSecondaryRoleTitles() == null
                ? Collections.<String>emptyList() : row.getSecondaryRoleTitles();
    }

    static String normalizeTitle(String raw, int maxLength) {
        String title = Texts.trimToNull(raw);
        if (title == null) return "";
        if (title.codePointCount(0, title.length()) > maxLength) {
            throw AppException.badRequest("标题不能超过 " + maxLength + " 个字符");
        }
        return title;
    }

    private static List<String> normalizeSecondary(List<String> raw, String primary) {
        Set<String> titles = new LinkedHashSet<String>();
        for (String value : raw) {
            String title = normalizeTitle(value, MAX_ROLE_LENGTH);
            if (!title.isEmpty() && !title.equals(primary)) titles.add(title);
        }
        if (titles.size() > 5) throw AppException.badRequest("兼岗最多 5 项");
        return new ArrayList<String>(titles);
    }

    private static ProjectMemberRole prepare(String workspaceId, String projectId, String userId,
                                            String rawPrimary, List<String> rawSecondary, ProjectMemberRole old) {
        ProjectMemberRole row = new ProjectMemberRole();
        row.setWorkspaceId(workspaceId);
        row.setProjectId(projectId);
        row.setUserId(userId);
        row.setRoleTitle(normalizeTitle(rawPrimary, MAX_ROLE_LENGTH));
        row.setSecondaryRoleTitles(normalizeSecondary(rawSecondary == null ? secondaryOf(old) : rawSecondary,
                row.getRoleTitle()));
        return row;
    }

    private void write(ProjectMemberRole row) {
        if (row.getRoleTitle().isEmpty() && row.getSecondaryRoleTitles().isEmpty()) {
            roleMapper.deleteOne(row.getWorkspaceId(), row.getProjectId(), row.getUserId());
        } else {
            roleMapper.upsert(row);
        }
    }

    private static String describe(ProjectMemberRole row) {
        return "主职能=" + (row.getRoleTitle().isEmpty() ? "继承空间默认" : row.getRoleTitle())
                + "；兼岗=" + row.getSecondaryRoleTitles();
    }

    /** 标签写权限：空间主/管理员，或该项目的负责人；查看者不能写。 */
    public boolean canEditRole(String workspaceId, Requirement project, String userId) {
        String role = projectAccess.roleOf(workspaceId, userId);
        if (role == null || ProjectAccessService.isViewer(role)) {
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
