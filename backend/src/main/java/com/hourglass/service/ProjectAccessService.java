package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.entity.ProjectMember;
import com.hourglass.entity.Task;
import com.hourglass.entity.WorkspaceMember;
import com.hourglass.mapper.ProjectMemberMapper;
import com.hourglass.mapper.WorkspaceMemberMapper;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 项目级可见范围。
 *
 * <p>口径：owner/admin 天然全量；viewer 全局只读；member 按 project_member 配置。
 * <b>没有配置记录 = 默认参与</b>，这样升级前所有成员仍能看到全部项目，收紧范围时才需要显式配置。</p>
 */
@Service
public class ProjectAccessService {

    public static final String ACCESS_NONE = "none";
    public static final String ACCESS_READ = "read";
    public static final String ACCESS_PM = "pm";
    public static final String ACCESS_DEV = "dev";
    public static final String ACCESS_QA = "qa";

    public static final String ROLE_OWNER = "owner";
    public static final String ROLE_ADMIN = "admin";
    public static final String ROLE_MEMBER = "member";
    public static final String ROLE_VIEWER = "viewer";

    /** 当前可持久化的取值；pm/dev/qa 只作为历史数据兼容读取，不再写入 */
    private static final Set<String> ACCESS_VALUES = new HashSet<String>();

    static {
        ACCESS_VALUES.add(ACCESS_NONE);
        ACCESS_VALUES.add(ACCESS_READ);
    }

    private final ProjectMemberMapper projectMemberMapper;
    private final WorkspaceMemberMapper memberMapper;

    public ProjectAccessService(ProjectMemberMapper projectMemberMapper,
                                WorkspaceMemberMapper memberMapper) {
        this.projectMemberMapper = projectMemberMapper;
        this.memberMapper = memberMapper;
    }

    public static boolean isValidRole(String role) {
        return ROLE_ADMIN.equals(role) || ROLE_MEMBER.equals(role) || ROLE_VIEWER.equals(role);
    }

    public static boolean isPrivileged(String role) {
        return ROLE_OWNER.equals(role) || ROLE_ADMIN.equals(role);
    }

    public static boolean isViewer(String role) {
        return ROLE_VIEWER.equals(role);
    }

    /** 空间角色：owner/admin 才可管理成员可见范围 */
    public String roleOf(String workspaceId, String userId) {
        WorkspaceMember m = memberMapper.selectMember(workspaceId, userId);
        return m == null ? null : m.getRole();
    }

    public boolean canManage(String workspaceId, String userId) {
        return isPrivileged(roleOf(workspaceId, userId));
    }

    public void requireManage(String workspaceId, String userId) {
        if (!canManage(workspaceId, userId)) {
            throw new AppException(403, "仅空间主或管理员可配置项目可见范围");
        }
    }

    /** 显式配置；null 表示没有配置（默认参与） */
    public String configuredAccess(String workspaceId, String projectId, String userId) {
        if (projectId == null) {
            return null;
        }
        ProjectMember pm = projectMemberMapper.selectOne(workspaceId, projectId, userId);
        return pm == null ? null : pm.getAccess();
    }

    public boolean canView(String workspaceId, String userId, String projectId) {
        if (userId == null) {
            return true;
        }
        String role = roleOf(workspaceId, userId);
        if (role == null) {
            /* 非空间成员一律不可见，避免调用方漏掉成员校验时默认放行 */
            return false;
        }
        if (projectId == null) {
            return true;
        }
        if (isPrivileged(role) || isViewer(role)) {
            return true;
        }
        return !ACCESS_NONE.equals(configuredAccess(workspaceId, projectId, userId));
    }

    public boolean canWrite(String workspaceId, String userId, String projectId) {
        if (userId == null) {
            return true;
        }
        String role = roleOf(workspaceId, userId);
        if (role == null) {
            return false;
        }
        if (projectId == null) {
            // 未归类到项目的任务不受项目级范围限制；viewer 仍全局只读
            return !isViewer(role);
        }
        if (isViewer(role)) {
            return false;
        }
        if (isPrivileged(role)) {
            return true;
        }
        String access = configuredAccess(workspaceId, projectId, userId);
        return !ACCESS_NONE.equals(access) && !ACCESS_READ.equals(access);
    }

    /** 读校验：不可见按"不存在"处理，避免泄露项目是否存在 */
    public void assertView(String workspaceId, String userId, String projectId) {
        if (!canView(workspaceId, userId, projectId)) {
            throw AppException.notFound("项目不存在或你没有访问权限：" + projectId);
        }
    }

    public void assertWrite(String workspaceId, String userId, String projectId) {
        if (projectId == null) {
            if (isViewer(roleOf(workspaceId, userId))) {
                throw new AppException(403, "你在此空间是查看者，只能查看不能修改");
            }
            return;
        }
        /* 与读校验同口径：完全不可见的项目按"不存在"处理，不能用 403 反推项目存在 */
        if (!canView(workspaceId, userId, projectId)) {
            throw AppException.notFound("项目不存在或你没有访问权限：" + projectId);
        }
        if (!canWrite(workspaceId, userId, projectId)) {
            throw new AppException(403, "你对该项目只有查看权限");
        }
    }

    /**
     * 需要按项目可见范围过滤时的 viewerId：owner/admin/viewer 返回 null（全量可见）。
     * viewer 是全局只读角色，不做项目级隐藏。
     */
    public String viewerScope(String workspaceId, String userId) {
        if (userId == null) {
            return null;
        }
        String role = roleOf(workspaceId, userId);
        return isPrivileged(role) || isViewer(role) ? null : userId;
    }

    /** 任务所在项目是否对该成员可见（无项目归属的任务不受项目级限制） */
    public boolean canViewTask(String workspaceId, String userId, com.hourglass.entity.Task task) {
        return task != null && canView(workspaceId, userId, task.getReqId());
    }

    public void assertViewTask(String workspaceId, String userId, com.hourglass.entity.Task task) {
        if (task != null) {
            assertView(workspaceId, userId, task.getReqId());
        }
    }

    /**
     * 当前用户在该空间的显式项目范围（projectId → read/none）。
     * owner/admin/viewer 与非成员返回空表：前者全量可写、后者全局只读，
     * 都不靠项目级配置解释权限，前端据此只对 member 叠加只读态。
     */
    public Map<String, String> userGrants(String workspaceId, String userId) {
        Map<String, String> grants = new HashMap<String, String>();
        String role = roleOf(workspaceId, userId);
        if (role == null || isPrivileged(role) || isViewer(role)) {
            return grants;
        }
        for (ProjectMember pm : projectMemberMapper.selectByUser(workspaceId, userId)) {
            String value = normalizeAccess(pm.getAccess());
            if (!value.isEmpty()) {
                grants.put(pm.getProjectId(), value);
            }
        }
        return grants;
    }

    /**
     * 批量标记任务的可写性（跨空间「我的任务」用）：按空间缓存角色与项目范围，
     * 避免逐条任务查库。结果写入 Task.access = write/read，与 canWrite 同口径。
     */
    public void markWritable(String userId, List<Task> tasks) {
        Map<String, String> roles = new HashMap<String, String>();
        Map<String, Map<String, String>> grants = new HashMap<String, Map<String, String>>();
        for (Task t : tasks) {
            String wsId = t.getWorkspaceId();
            String role;
            if (roles.containsKey(wsId)) {
                role = roles.get(wsId);
            } else {
                String r = roleOf(wsId, userId);
                role = r == null ? "" : r;
                roles.put(wsId, role);
            }
            boolean writable;
            if (role.isEmpty() || isViewer(role)) {
                writable = false;
            } else if (isPrivileged(role) || t.getReqId() == null) {
                writable = true;
            } else {
                Map<String, String> g = grants.get(wsId);
                if (g == null) {
                    g = userGrants(wsId, userId);
                    grants.put(wsId, g);
                }
                String access = g.get(t.getReqId());
                writable = !ACCESS_READ.equals(access) && !ACCESS_NONE.equals(access);
            }
            t.setAccess(writable ? "write" : "read");
        }
    }

    /** 该成员被显式设为"不可见"的项目集合（owner/admin/viewer 恒为空） */
    public Set<String> hiddenProjectIds(String workspaceId, String userId) {
        Set<String> hidden = new HashSet<String>();
        String role = roleOf(workspaceId, userId);
        if (isPrivileged(role) || isViewer(role) || role == null) {
            return hidden;
        }
        for (ProjectMember pm : projectMemberMapper.selectByUser(workspaceId, userId)) {
            if (ACCESS_NONE.equals(pm.getAccess())) {
                hidden.add(pm.getProjectId());
            }
        }
        return hidden;
    }

    /**
     * 批量过滤对某项目可见的空间成员（@提及候选用）：一次读出项目范围配置，
     * 不再逐人回查角色与可见范围，判定口径与 canView 一致。
     */
    public List<WorkspaceMember> filterVisibleMembers(String workspaceId, List<WorkspaceMember> members,
                                                      String projectId) {
        List<WorkspaceMember> visible = new ArrayList<WorkspaceMember>();
        if (members == null || members.isEmpty()) {
            return visible;
        }
        Map<String, Set<String>> hidden = new HashMap<String, Set<String>>();
        if (projectId != null) {
            for (ProjectMember pm : projectMemberMapper.selectByWorkspace(workspaceId)) {
                if (!ACCESS_NONE.equals(pm.getAccess())) {
                    continue;
                }
                Set<String> projects = hidden.get(pm.getUserId());
                if (projects == null) {
                    projects = new HashSet<String>();
                    hidden.put(pm.getUserId(), projects);
                }
                projects.add(pm.getProjectId());
            }
        }
        for (WorkspaceMember m : members) {
            String userId = m.getUserId();
            if (userId == null || m.getRole() == null) {
                continue;
            }
            if (projectId == null || isPrivileged(m.getRole()) || isViewer(m.getRole())) {
                visible.add(m);
                continue;
            }
            Set<String> projects = hidden.get(userId);
            if (projects == null || !projects.contains(projectId)) {
                visible.add(m);
            }
        }
        return visible;
    }

    public List<ProjectMember> grants(String workspaceId) {
        return projectMemberMapper.selectByWorkspace(workspaceId);
    }

    /** 空间群机器人摘要用：只要某项目对任一成员显式 none，就不进入群消息，避免成员级隐藏内容外泄 */
    public Set<String> projectsHiddenFromAnyMember(String workspaceId) {
        Set<String> hidden = new HashSet<String>();
        for (ProjectMember pm : projectMemberMapper.selectByWorkspace(workspaceId)) {
            if (ACCESS_NONE.equals(pm.getAccess())) {
                hidden.add(pm.getProjectId());
            }
        }
        return hidden;
    }

    /**
     * 提交值归一化：历史 pm/dev/qa 与空/default 都是"默认参与"，统一返回空串。
     * 小团队不区分项目内角色，这样审计日志与落库口径保持一致。
     */
    public static String normalizeAccess(String access) {
        String value = access == null ? "" : access.trim().toLowerCase();
        if (value.isEmpty() || "default".equals(value)
                || ACCESS_PM.equals(value) || ACCESS_DEV.equals(value) || ACCESS_QA.equals(value)) {
            return "";
        }
        return value;
    }

    /**
     * 保存单个单元格。归一化后为空表示删除记录，回到默认参与。
     * 历史弹窗可能仍提交 pm/dev/qa，一律收敛为默认参与。
     */
    public void saveGrant(String workspaceId, String userId, String projectId, String access) {
        if (projectId == null) {
            throw AppException.badRequest("请选择项目");
        }
        String value = normalizeAccess(access);
        if (value.isEmpty()) {
            projectMemberMapper.deleteOne(workspaceId, projectId, userId);
            return;
        }
        if (!ACCESS_VALUES.contains(value)) {
            throw AppException.badRequest("可见范围取值不合法：" + access);
        }
        ProjectMember pm = new ProjectMember();
        pm.setWorkspaceId(workspaceId);
        pm.setProjectId(projectId);
        pm.setUserId(userId);
        pm.setAccess(value);
        projectMemberMapper.upsert(pm);
    }

    /** 项目删除时清理它的可见范围配置 */
    public void clearProject(String workspaceId, String projectId) {
        projectMemberMapper.deleteByProject(workspaceId, projectId);
    }
}
