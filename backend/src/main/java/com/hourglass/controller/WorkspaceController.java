package com.hourglass.controller;

import com.hourglass.common.ApiResult;
import com.hourglass.common.AppException;
import com.hourglass.common.CurrentUser;
import com.hourglass.dto.MemberAddRequest;
import com.hourglass.dto.MemberCandidate;
import com.hourglass.dto.MemberCompanyRequest;
import com.hourglass.dto.MemberJobTitleRequest;
import com.hourglass.dto.MemberLabelOptions;
import com.hourglass.dto.ProjectMemberRoleBatchRequest;
import com.hourglass.dto.ProjectMemberRoleCopyRequest;
import com.hourglass.dto.ProjectMemberRoleOverview;
import com.hourglass.dto.ProjectMemberRoleRequest;
import com.hourglass.dto.WorkspaceCreateRequest;
import com.hourglass.dto.WorkspaceUpdateRequest;
import com.hourglass.entity.AppUser;
import com.hourglass.entity.ProjectMember;
import com.hourglass.entity.Requirement;
import com.hourglass.entity.Workspace;
import com.hourglass.entity.WorkspaceMember;
import com.hourglass.mapper.RequirementMapper;
import com.hourglass.mapper.UserMapper;
import com.hourglass.service.ActivityService;
import com.hourglass.service.AuditService;
import com.hourglass.service.NotificationEventService;
import com.hourglass.service.ProjectAccessService;
import com.hourglass.service.ProjectMemberRoleService;
import com.hourglass.service.WorkspaceService;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import javax.servlet.http.HttpServletRequest;
import javax.validation.Valid;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 空间：个人空间 + 共享空间。成员通过邀请链接加入（对方确认）；按登录名直接加人仅平台管理员可用。
 */
@RestController
public class WorkspaceController {

    private final WorkspaceService workspaceService;
    private final UserMapper userMapper;
    private final ProjectAccessService projectAccessService;
    private final ProjectMemberRoleService projectMemberRoleService;
    private final RequirementMapper requirementMapper;
    private final ActivityService activityService;
    private final NotificationEventService notificationEvents;
    private final AuditService audit;

    public WorkspaceController(WorkspaceService workspaceService, UserMapper userMapper,
                               ProjectAccessService projectAccessService,
                               ProjectMemberRoleService projectMemberRoleService,
                               RequirementMapper requirementMapper,
                               ActivityService activityService,
                               NotificationEventService notificationEvents,
                               AuditService audit) {
        this.workspaceService = workspaceService;
        this.userMapper = userMapper;
        this.projectAccessService = projectAccessService;
        this.projectMemberRoleService = projectMemberRoleService;
        this.requirementMapper = requirementMapper;
        this.activityService = activityService;
        this.notificationEvents = notificationEvents;
        this.audit = audit;
    }

    /** 我参与的空间（个人空间排前） */
    @GetMapping("/api/workspaces")
    public ApiResult<List<Workspace>> list() {
        return ApiResult.ok(workspaceService.list(CurrentUser.id()));
    }

    /** 新建共享空间 */
    @PostMapping("/api/workspaces")
    public ApiResult<Workspace> create(@Valid @RequestBody WorkspaceCreateRequest req) {
        return ApiResult.ok(workspaceService.createShared(CurrentUser.id(), req.getName()));
    }

    /** 切换当前空间（记住选择） */
    @PostMapping("/api/workspaces/{id}/select")
    public ApiResult<Void> select(@PathVariable String id) {
        workspaceService.select(CurrentUser.id(), id);
        return ApiResult.ok();
    }

    /** 改名 / 配置推送地址（仅空间主） */
    @PutMapping("/api/workspaces/{id}")
    public ApiResult<Workspace> update(@PathVariable String id, @Valid @RequestBody WorkspaceUpdateRequest req) {
        return ApiResult.ok(workspaceService.update(CurrentUser.id(), id, req));
    }

    /** 删除共享空间（仅空间主，连带数据） */
    @DeleteMapping("/api/workspaces/{id}")
    public ApiResult<Void> delete(@PathVariable String id, HttpServletRequest request) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.requireMember(userId, id);
        workspaceService.deleteShared(userId, id);
        audit.recordCurrent(id, "workspace_delete", "workspace", id, ws.getName(),
                true, "删除空间「" + ws.getName() + "」及其数据", request);
        return ApiResult.ok();
    }

    /** 成员列表 */
    @GetMapping("/api/workspaces/{id}/members")
    public ApiResult<List<WorkspaceMember>> members(@PathVariable String id) {
        return ApiResult.ok(workspaceService.members(CurrentUser.id(), id));
    }

    /**
     * 按登录名直接加人只留给平台管理员做运维。
     * 普通空间主不能这么干 —— 那等于不经对方同意就把人拉进空间（对方的「我的任务」/通知里
     * 会突然出现这个空间的内容）。普通空间主请改用「邀请链接」：对方打开链接、确认后才加入。
     */
    /** 添加成员时的候选搜索：与直接加人同一权限（平台管理员 + 空间主），只返回选人字段 */
    @GetMapping("/api/workspaces/{id}/member-candidates")
    public ApiResult<List<MemberCandidate>> memberCandidates(@PathVariable String id,
                                                             @RequestParam(required = false) String q) {
        AppUser me = userMapper.selectById(CurrentUser.id());
        if (me == null || !"admin".equals(me.getRole())) {
            throw new AppException(403, "共享空间成员需通过邀请链接加入：请生成邀请链接发给对方，对方确认后才会成为成员");
        }
        return ApiResult.ok(workspaceService.searchMemberCandidates(CurrentUser.id(), id, q));
    }

    @PostMapping("/api/workspaces/{id}/members")
    public ApiResult<Void> addMember(@PathVariable String id, @Valid @RequestBody MemberAddRequest req,
                                     HttpServletRequest request) {
        AppUser me = userMapper.selectById(CurrentUser.id());
        if (me == null || !"admin".equals(me.getRole())) {
            throw new AppException(403, "共享空间成员需通过邀请链接加入：请生成邀请链接发给对方，对方确认后才会成为成员");
        }
        workspaceService.addMember(CurrentUser.id(), id, req.getUsername());
        audit.recordCurrent(id, "member_add", "member", req.getUsername(), req.getUsername(),
                true, "添加成员：" + req.getUsername(), request);
        return ApiResult.ok();
    }

    /** 移除成员（空间主）/ 退出空间（成员自己） */
    @DeleteMapping("/api/workspaces/{id}/members/{userId}")
    public ApiResult<Void> removeMember(@PathVariable String id, @PathVariable String userId,
                                        HttpServletRequest request) {
        String me = CurrentUser.id();
        Workspace before = workspaceService.requireMember(me, id);
        boolean self = me.equals(userId);
        /* 移除后就查不到成员了：先取展示名，审计里写人名而不是内部 ID */
        String name = self ? userId : memberName(me, id, userId);
        workspaceService.removeMember(me, id, userId);
        audit.recordCurrent(id, "member_remove", "member", userId, name, true,
                self ? "退出空间「" + before.getName() + "」"
                        : ("移除成员 " + name + "（空间「" + before.getName() + "」）"), request);
        /* 被移除的人已不是成员，普通通知的成员校验会拦掉，必须走系统通道；
           不带深链：该空间已无权进入，点击只展示正文 */
        if (!self) {
            notificationEvents.notifySystem(userId, id, NotificationEventService.MEMBER_REMOVED,
                    "你已被移出空间「" + before.getName() + "」",
                    "你在该空间的成员身份与项目可见范围已被移除；如有疑问请联系空间主",
                    null);
        }
        return ApiResult.ok();
    }

    /** 调整成员空间角色：owner / admin / member / viewer（仅空间主可操作） */
    @PutMapping("/api/workspaces/{id}/members/{userId}/role")
    public ApiResult<Void> updateMemberRole(@PathVariable String id, @PathVariable String userId,
                                            @RequestBody MemberRoleRequest req,
                                            HttpServletRequest request) {
        String me = CurrentUser.id();
        String role = req == null ? null : req.getRole();
        Workspace ws = workspaceService.requireMember(me, id);
        workspaceService.updateMemberRole(me, id, userId, role);
        String name = memberName(me, id, userId);
        audit.recordCurrent(id, "role_change", "member", userId, name, true,
                "成员 " + name + " 的空间角色调整为「" + roleLabel(role) + "」（空间「" + ws.getName() + "」）",
                request);
        if (!me.equals(userId)) {
            notificationEvents.notifySystem(userId, id, NotificationEventService.MEMBER_ROLE,
                    "空间角色已调整：「" + ws.getName() + "」",
                    "你在空间「" + ws.getName() + "」中的角色已调整为「" + roleLabel(role) + "」",
                    null, "workspace", id);
        }
        return ApiResult.ok();
    }

    /** 标注成员公司（空间主/管理员）：只写展示字段，不改变任何权限 */
    @PutMapping("/api/workspaces/{id}/members/{userId}/company")
    public ApiResult<Void> updateMemberCompany(@PathVariable String id, @PathVariable String userId,
                                               @RequestBody(required = false) MemberCompanyRequest req,
                                               HttpServletRequest request) {
        String me = CurrentUser.id();
        Workspace ws = workspaceService.requireMember(me, id);
        String saved = workspaceService.updateMemberCompany(me, id, userId,
                req == null ? null : req.getCompanyName());
        String name = memberName(me, id, userId);
        audit.recordCurrent(id, "member_company", "member", userId, name, true,
                "成员 " + name + " 的公司标注为「" + (saved.isEmpty() ? "未标注" : saved)
                        + "」（空间「" + ws.getName() + "」）", request);
        return ApiResult.ok();
    }

    @PutMapping("/api/workspaces/{id}/members/{userId}/job-title")
    public ApiResult<Void> updateMemberJobTitle(@PathVariable String id, @PathVariable String userId,
                                               @RequestBody(required = false) MemberJobTitleRequest req) {
        workspaceService.updateMemberJobTitle(CurrentUser.id(), id, userId, req == null ? null : req.getJobTitle());
        return ApiResult.ok();
    }

    @GetMapping("/api/workspaces/{id}/member-label-options")
    public ApiResult<MemberLabelOptions> memberLabelOptions(@PathVariable String id) {
        return ApiResult.ok(workspaceService.memberLabelOptions(CurrentUser.id(), id));
    }

    @PutMapping("/api/workspaces/{id}/member-label-options")
    public ApiResult<Void> updateMemberLabelOptions(@PathVariable String id,
                                                   @RequestBody MemberLabelOptions req) {
        workspaceService.updateMemberLabelOptions(CurrentUser.id(), id, req);
        return ApiResult.ok();
    }

    @PutMapping("/api/workspaces/{id}/projects/{projectId}/member-roles")
    public ApiResult<Map<String, Integer>> saveProjectRoles(@PathVariable String id, @PathVariable String projectId,
            @RequestBody ProjectMemberRoleBatchRequest req) {
        String me = CurrentUser.id();
        workspaceService.requireMember(me, id);
        Requirement project = requireProject(id, projectId);
        if (req == null) throw AppException.badRequest("请提交成员职能");
        return ApiResult.ok(projectMemberRoleService.saveRoles(id, project, req.getUserIds(), req.getRoleTitle(),
                req.getSecondaryRoleTitles(), me));
    }

    @PostMapping("/api/workspaces/{id}/projects/{projectId}/member-roles/copy")
    public ApiResult<Map<String, Integer>> copyProjectRoles(@PathVariable String id, @PathVariable String projectId,
            @RequestBody ProjectMemberRoleCopyRequest req) {
        String me = CurrentUser.id();
        workspaceService.requireMember(me, id);
        Requirement project = requireProject(id, projectId);
        if (req == null) throw AppException.badRequest("请选择来源项目");
        return ApiResult.ok(projectMemberRoleService.copyRoles(id, project, req.getSourceProjectId(), req.isOverwrite(), me));
    }

    /** 项目花名册：可见且非查看者的成员 + 公司 + 本项目角色 + 有效权限 */
    @GetMapping("/api/workspaces/{id}/projects/{projectId}/members")
    public ApiResult<ProjectMemberRoleOverview> projectMembers(@PathVariable String id,
                                                               @PathVariable String projectId) {
        String me = CurrentUser.id();
        workspaceService.requireMember(me, id);
        Requirement project = requireProject(id, projectId);
        projectAccessService.assertView(id, me, projectId);
        return ApiResult.ok(projectMemberRoleService.roster(id, project, me));
    }

    /** 保存项目职能覆盖：空间主/管理员或项目负责人可写；兼岗未提供保持，[] 清除。 */
    @PutMapping("/api/workspaces/{id}/projects/{projectId}/member-roles/{userId}")
    public ApiResult<Void> saveProjectRole(@PathVariable String id, @PathVariable String projectId,
                                           @PathVariable String userId,
                                           @RequestBody(required = false) ProjectMemberRoleRequest req,
                                           HttpServletRequest request) {
        String me = CurrentUser.id();
        workspaceService.requireMember(me, id);
        Requirement project = requireProject(id, projectId);
        projectMemberRoleService.saveRole(id, project, userId,
                req == null ? null : req.getRoleTitle(), req == null ? null : req.getSecondaryRoleTitles(), me);
        return ApiResult.ok();
    }

    /** 项目可见范围矩阵：成员 × 项目 + 现有显式配置（仅空间主/管理员可见） */
    @GetMapping("/api/workspaces/{id}/project-access")
    public ApiResult<Map<String, Object>> projectAccess(@PathVariable String id) {
        String me = CurrentUser.id();
        Workspace ws = workspaceService.requireMember(me, id);
        projectAccessService.requireManage(id, me);
        requireSharedWorkspace(ws, "项目可见范围");

        List<WorkspaceMember> members = workspaceService.members(me, id);
        List<Requirement> projects = requirementMapper.selectAll(id);
        List<ProjectMember> grants = projectAccessService.grants(id);

        Map<String, Object> result = new LinkedHashMap<String, Object>();
        result.put("myRole", ws.getMyRole());
        result.put("members", members);
        result.put("projects", projects);
        result.put("grants", grants);
        return ApiResult.ok(result);
    }

    /** 保存单个「成员 × 项目」可见范围；access 为空/default 表示恢复默认参与 */
    @PutMapping("/api/workspaces/{id}/project-access")
    public ApiResult<Void> saveProjectAccess(@PathVariable String id,
                                             @RequestBody ProjectAccessRequest req,
                                             HttpServletRequest request) {
        String me = CurrentUser.id();
        Workspace ws = workspaceService.requireMember(me, id);
        projectAccessService.requireManage(id, me);
        requireSharedWorkspace(ws, "项目可见范围");
        if (req == null || req.getUserId() == null || req.getProjectId() == null) {
            throw AppException.badRequest("请选择成员和项目");
        }
        WorkspaceMember target = null;
        for (WorkspaceMember m : workspaceService.members(me, id)) {
            if (req.getUserId().equals(m.getUserId())) {
                target = m;
                break;
            }
        }
        if (target == null) {
            throw AppException.notFound("成员不存在：" + req.getUserId());
        }
        if (!ProjectAccessService.ROLE_MEMBER.equals(target.getRole())) {
            throw AppException.badRequest(ProjectAccessService.isPrivileged(target.getRole())
                    ? "空间主/管理员天然拥有全部项目，无需单独配置"
                    : "查看者对整个空间只读，无需配置项目可见范围");
        }
        Requirement project = requirementMapper.selectById(req.getProjectId());
        if (project == null || !id.equals(project.getWorkspaceId())) {
            throw AppException.notFound("项目不存在或不属于当前空间：" + req.getProjectId());
        }
        String previous = projectAccessService.effectiveAccess(id, req.getProjectId(), target);
        String access = projectAccessService.saveGrant(id, req.getUserId(), req.getProjectId(), req.getAccess());
        String effective = ProjectAccessService.effectiveOf(access, target);
        /* 记有效权限而不是落库值：存量成员选「可参与」会删掉冗余行（落库为空），
           若照抄落库值会在日志里显示成 default，与界面看到的「可参与」不一致 */
        String name = target.getDisplayName() == null ? req.getUserId() : target.getDisplayName();
        activityService.logConfig(id, me,
                "调整成员「" + name + "」对项目「" + project.getName() + "」的可见范围 → " + accessLabel(effective));
        audit.recordCurrent(id, "role_change", "project", project.getId(), project.getName(), true,
                "成员 " + name + " 对项目「" + project.getName() + "」的可见范围改为「"
                        + accessLabel(effective) + "」", request);
        if (!me.equals(req.getUserId()) && !previous.equals(effective)) {
            notificationEvents.notifySystem(req.getUserId(), id, NotificationEventService.PROJECT_ACCESS,
                    "项目可见范围已调整：「" + project.getName() + "」",
                    "你在空间「" + ws.getName() + "」中对该项目的可见范围已调整为「" + accessLabel(effective) + "」",
                    null, "project", project.getId());
        }
        return ApiResult.ok();
    }

    /**
     * 批量保存某成员的项目权限（成员行的「分配项目」）：一次提交全部项目，
     * 落库按提交值幂等写入，只把变化的单元格计入审计与通知，避免逐项保存产生 N 条记录。
     */
    @PutMapping("/api/workspaces/{id}/members/{userId}/project-access")
    public ApiResult<Void> saveMemberProjectAccess(@PathVariable String id, @PathVariable String userId,
                                                   @RequestBody MemberGrantsRequest req,
                                                   HttpServletRequest request) {
        String me = CurrentUser.id();
        Workspace ws = workspaceService.requireMember(me, id);
        projectAccessService.requireManage(id, me);
        requireSharedWorkspace(ws, "项目可见范围");
        WorkspaceMember target = null;
        for (WorkspaceMember m : workspaceService.members(me, id)) {
            if (userId.equals(m.getUserId())) {
                target = m;
                break;
            }
        }
        if (target == null) {
            throw AppException.notFound("成员不存在：" + userId);
        }
        if (!ProjectAccessService.ROLE_MEMBER.equals(target.getRole())) {
            throw AppException.badRequest(ProjectAccessService.isPrivileged(target.getRole())
                    ? "空间主/管理员天然拥有全部项目，无需单独配置"
                    : "查看者对整个空间只读，无需配置项目可见范围");
        }
        if (req == null || req.getGrants() == null) {
            throw AppException.badRequest("请提交项目权限");
        }
        Map<String, String> wanted = new LinkedHashMap<String, String>();
        Map<String, Requirement> projects = new LinkedHashMap<String, Requirement>();
        for (MemberGrant item : req.getGrants()) {
            if (item == null) {
                continue;
            }
            String projectId = item.getProjectId() == null ? null : item.getProjectId().trim();
            if (projectId == null || projectId.isEmpty()) {
                continue;
            }
            String value = ProjectAccessService.normalizeAccess(item.getAccess());
            if (!value.isEmpty()
                    && !ProjectAccessService.ACCESS_NONE.equals(value)
                    && !ProjectAccessService.ACCESS_READ.equals(value)
                    && !ProjectAccessService.ACCESS_WRITE.equals(value)) {
                throw AppException.badRequest("项目权限只能是可参与 / 只读 / 不可见");
            }
            Requirement project = requirementMapper.selectById(projectId);
            if (project == null || !id.equals(project.getWorkspaceId())) {
                throw AppException.notFound("项目不存在或不属于当前空间：" + projectId);
            }
            wanted.put(projectId, value);
            projects.put(projectId, project);
        }

        List<String> changes = new ArrayList<String>();
        for (Map.Entry<String, String> entry
                : projectAccessService.saveMemberGrants(id, target, wanted).entrySet()) {
            changes.add(projects.get(entry.getKey()).getName() + "→" + accessLabel(entry.getValue()));
        }
        if (changes.isEmpty()) {
            return ApiResult.ok();
        }
        String name = target.getDisplayName() == null ? userId : target.getDisplayName();
        String summary = String.join("、", changes);
        activityService.logConfig(id, me, "调整成员「" + name + "」的项目权限：" + summary);
        audit.recordCurrent(id, "role_change", "member", userId, name, true,
                "成员 " + name + " 的项目权限调整为：" + summary, request);
        if (!me.equals(userId)) {
            notificationEvents.notifySystem(userId, id, NotificationEventService.PROJECT_ACCESS,
                    "项目可见范围已调整（" + changes.size() + " 个项目）",
                    "你在空间「" + ws.getName() + "」中的项目权限已调整：" + summary,
                    null, "member", userId);
        }
        return ApiResult.ok();
    }

    /** 审计展示名：取不到（已移出 / 查询失败）时回落到 userId，审计本身不能因此失败 */
    private String memberName(String me, String workspaceId, String userId) {
        try {
            for (WorkspaceMember m : workspaceService.members(me, workspaceId)) {
                if (userId.equals(m.getUserId())) {
                    return m.getDisplayName() == null || m.getDisplayName().isEmpty() ? userId : m.getDisplayName();
                }
            }
        } catch (RuntimeException ignored) {
            // fall through
        }
        return userId;
    }

    /** 角色展示名：通知里不出现 owner/admin 这类码值 */
    private static String roleLabel(String role) {
        if (ProjectAccessService.ROLE_OWNER.equals(role)) {
            return "空间主";
        }
        if (ProjectAccessService.ROLE_ADMIN.equals(role)) {
            return "管理员";
        }
        if (ProjectAccessService.ROLE_VIEWER.equals(role)) {
            return "查看者";
        }
        return "成员";
    }

    /** 项目可见范围展示名：空串表示没有显式配置（默认参与） */
    private static String accessLabel(String access) {
        if (ProjectAccessService.ACCESS_NONE.equals(access)) {
            return "不可见";
        }
        if (ProjectAccessService.ACCESS_READ.equals(access)) {
            return "只读";
        }
        if (ProjectAccessService.ACCESS_WRITE.equals(access)) {
            return "可参与";
        }
        return "默认参与（可查看、可编辑）";
    }

    /** 个人空间只有空间主自己，成员可见范围与邀请链接都不适用 */
    private void requireSharedWorkspace(Workspace ws, String action) {
        if ("personal".equals(ws.getType())) {
            throw AppException.badRequest("个人空间不支持" + action);
        }
    }

    private Requirement requireProject(String workspaceId, String projectId) {
        Requirement project = requirementMapper.selectById(projectId);
        if (project == null || !workspaceId.equals(project.getWorkspaceId())) {
            throw AppException.notFound("项目不存在或不属于当前空间：" + projectId);
        }
        return project;
    }

    public static class MemberRoleRequest {
        private String role;

        public String getRole() {
            return role;
        }

        public void setRole(String role) {
            this.role = role;
        }
    }

    public static class ProjectAccessRequest {
        private String userId;
        private String projectId;
        private String access;

        public String getUserId() {
            return userId;
        }

        public void setUserId(String userId) {
            this.userId = userId;
        }

        public String getProjectId() {
            return projectId;
        }

        public void setProjectId(String projectId) {
            this.projectId = projectId;
        }

        public String getAccess() {
            return access;
        }

        public void setAccess(String access) {
            this.access = access;
        }
    }

    /** 成员行「分配项目」：一次提交该成员在本空间全部项目的目标权限 */
    public static class MemberGrantsRequest {
        private List<MemberGrant> grants;

        public List<MemberGrant> getGrants() {
            return grants;
        }

        public void setGrants(List<MemberGrant> grants) {
            this.grants = grants;
        }
    }

    public static class MemberGrant {
        private String projectId;
        private String access;

        public String getProjectId() {
            return projectId;
        }

        public void setProjectId(String projectId) {
            this.projectId = projectId;
        }

        public String getAccess() {
            return access;
        }

        public void setAccess(String access) {
            this.access = access;
        }
    }
}
