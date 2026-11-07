package com.hourglass.controller;

import com.hourglass.common.ApiResult;
import com.hourglass.common.AppException;
import com.hourglass.common.CurrentUser;
import com.hourglass.dto.MemberAddRequest;
import com.hourglass.dto.MemberCandidate;
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
import com.hourglass.service.NotificationEventService;
import com.hourglass.service.ProjectAccessService;
import com.hourglass.service.WorkspaceService;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import javax.validation.Valid;
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
    private final RequirementMapper requirementMapper;
    private final ActivityService activityService;
    private final NotificationEventService notificationEvents;

    public WorkspaceController(WorkspaceService workspaceService, UserMapper userMapper,
                               ProjectAccessService projectAccessService,
                               RequirementMapper requirementMapper,
                               ActivityService activityService,
                               NotificationEventService notificationEvents) {
        this.workspaceService = workspaceService;
        this.userMapper = userMapper;
        this.projectAccessService = projectAccessService;
        this.requirementMapper = requirementMapper;
        this.activityService = activityService;
        this.notificationEvents = notificationEvents;
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
    public ApiResult<Void> delete(@PathVariable String id) {
        workspaceService.deleteShared(CurrentUser.id(), id);
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
    public ApiResult<Void> addMember(@PathVariable String id, @Valid @RequestBody MemberAddRequest req) {
        AppUser me = userMapper.selectById(CurrentUser.id());
        if (me == null || !"admin".equals(me.getRole())) {
            throw new AppException(403, "共享空间成员需通过邀请链接加入：请生成邀请链接发给对方，对方确认后才会成为成员");
        }
        workspaceService.addMember(CurrentUser.id(), id, req.getUsername());
        return ApiResult.ok();
    }

    /** 移除成员（空间主）/ 退出空间（成员自己） */
    @DeleteMapping("/api/workspaces/{id}/members/{userId}")
    public ApiResult<Void> removeMember(@PathVariable String id, @PathVariable String userId) {
        String me = CurrentUser.id();
        workspaceService.removeMember(me, id, userId);
        /* 被移除的人已不是成员，普通通知的成员校验会拦掉，必须走系统通道 */
        if (!me.equals(userId)) {
            Workspace ws = workspaceService.requireMember(me, id);
            notificationEvents.notifySystem(userId, id, NotificationEventService.MEMBER_REMOVED,
                    "你已被移出空间「" + ws.getName() + "」",
                    "你在该空间的成员身份与项目可见范围已被移除；如有疑问请联系空间主", null);
        }
        return ApiResult.ok();
    }

    /** 调整成员空间角色：owner / admin / member / viewer（仅空间主可操作） */
    @PutMapping("/api/workspaces/{id}/members/{userId}/role")
    public ApiResult<Void> updateMemberRole(@PathVariable String id, @PathVariable String userId,
                                            @RequestBody MemberRoleRequest req) {
        String me = CurrentUser.id();
        String role = req == null ? null : req.getRole();
        workspaceService.updateMemberRole(me, id, userId, role);
        if (!me.equals(userId)) {
            Workspace ws = workspaceService.requireMember(me, id);
            notificationEvents.notifySystem(userId, id, NotificationEventService.MEMBER_ROLE,
                    "空间角色已调整：「" + ws.getName() + "」",
                    "你在空间「" + ws.getName() + "」中的角色已调整为「" + roleLabel(role) + "」", null);
        }
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
                                             @RequestBody ProjectAccessRequest req) {
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
        String previous = ProjectAccessService.normalizeAccess(
                projectAccessService.configuredAccess(id, req.getProjectId(), req.getUserId()));
        projectAccessService.saveGrant(id, req.getUserId(), req.getProjectId(), req.getAccess());
        String access = ProjectAccessService.normalizeAccess(req.getAccess());
        activityService.logConfig(id, me,
                "调整项目可见范围「" + project.getName() + "」→ " + (access.isEmpty() ? "default" : access));
        if (!me.equals(req.getUserId()) && !previous.equals(access)) {
            notificationEvents.notifySystem(req.getUserId(), id, NotificationEventService.PROJECT_ACCESS,
                    "项目可见范围已调整：「" + project.getName() + "」",
                    "你在空间「" + ws.getName() + "」中对该项目的可见范围已调整为「" + accessLabel(access) + "」", null);
        }
        return ApiResult.ok();
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
        return "默认参与（可查看、可编辑）";
    }

    /** 个人空间只有空间主自己，成员可见范围与邀请链接都不适用 */
    private void requireSharedWorkspace(Workspace ws, String action) {
        if ("personal".equals(ws.getType())) {
            throw AppException.badRequest("个人空间不支持" + action);
        }
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
}
