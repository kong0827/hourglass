package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.entity.ProjectMember;
import com.hourglass.entity.Task;
import com.hourglass.entity.WorkspaceMember;
import com.hourglass.mapper.ProjectMemberMapper;
import com.hourglass.mapper.ProjectMemberRoleMapper;
import com.hourglass.mapper.WorkspaceMemberMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
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
    public static final String ACCESS_WRITE = "write";
    public static final String ACCESS_PM = "pm";
    public static final String ACCESS_DEV = "dev";
    public static final String ACCESS_QA = "qa";

    /** all=默认参与（没有记录即可见，存量口径）；assigned=按项目分配（未显式授权即不可见） */
    public static final String MODE_ALL = "all";
    public static final String MODE_ASSIGNED = "assigned";

    public static final String ROLE_OWNER = "owner";
    public static final String ROLE_ADMIN = "admin";
    public static final String ROLE_MEMBER = "member";
    public static final String ROLE_VIEWER = "viewer";

    /** 当前可持久化的取值；pm/dev/qa 只作为历史数据兼容读取，不再写入 */
    private static final Set<String> ACCESS_VALUES = new HashSet<String>();

    static {
        ACCESS_VALUES.add(ACCESS_NONE);
        ACCESS_VALUES.add(ACCESS_READ);
        ACCESS_VALUES.add(ACCESS_WRITE);
    }

    private final ProjectMemberMapper projectMemberMapper;
    private final WorkspaceMemberMapper memberMapper;

    /** 展示标签清理用；单测里不注入时为 null，避免把新表耦合进权限测试。 */
    @Autowired(required = false)
    private ProjectMemberRoleMapper projectMemberRoleMapper;

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

    public static boolean isAssigned(WorkspaceMember member) {
        return member != null && MODE_ASSIGNED.equals(member.getProjectAccessMode());
    }

    /**
     * 成员对某项目的有效权限：
     * 显式 write/read/none 优先；没有记录时，assigned 成员默认 none，其余（存量 all）默认 write。
     */
    public String effectiveAccess(String workspaceId, String projectId, WorkspaceMember member) {
        if (member == null || projectId == null) {
            return ACCESS_WRITE;
        }
        return effectiveOfConfigured(member, configuredAccess(workspaceId, projectId, member.getUserId()));
    }

    /** 已取到显式配置时的有效权限计算，供批量场景复用，避免逐人回查。 */
    public static String effectiveOfConfigured(WorkspaceMember member, String configured) {
        String access = normalizeAccess(configured);
        if (!access.isEmpty()) {
            return access;
        }
        return isAssigned(member) ? ACCESS_NONE : ACCESS_WRITE;
    }

    public boolean canView(String workspaceId, String userId, String projectId) {
        if (userId == null) {
            return true;
        }
        WorkspaceMember member = memberMapper.selectMember(workspaceId, userId);
        if (member == null) {
            /* 非空间成员一律不可见，避免调用方漏掉成员校验时默认放行 */
            return false;
        }
        if (projectId == null) {
            return true;
        }
        String role = member.getRole();
        if (isPrivileged(role) || isViewer(role)) {
            return true;
        }
        return !ACCESS_NONE.equals(effectiveAccess(workspaceId, projectId, member));
    }

    public boolean canWrite(String workspaceId, String userId, String projectId) {
        if (userId == null) {
            return true;
        }
        WorkspaceMember member = memberMapper.selectMember(workspaceId, userId);
        if (member == null) {
            return false;
        }
        String role = member.getRole();
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
        return ACCESS_WRITE.equals(effectiveAccess(workspaceId, projectId, member));
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

    /** Delivery writes only: caller must hold project/task scope locks before this current read. */
    private Map<String, Object> writableSnapshotForUpdate(String workspaceId, String userId, String projectId) {
        Map<String, Object> snapshot = memberMapper.selectDeliveryAccessForUpdate(workspaceId, userId, projectId);
        if (snapshot == null || snapshot.get("role") == null) {
            throw AppException.notFound("项目不存在或你没有访问权限：" + projectId);
        }
        String role = (String) snapshot.get("role");
        if (isPrivileged(role)) {
            return snapshot;
        }
        if (isViewer(role)) {
            throw new AppException(403, "你在此空间是查看者，只能查看不能修改");
        }
        if (projectId != null) {
            if (ACCESS_NONE.equals(snapshot.get("access"))) {
                throw AppException.notFound("项目不存在或你没有访问权限：" + projectId);
            }
            /* assigned 成员没有显式授权时同样按不可见处理，不能靠「没记录」默认放行 */
            if (MODE_ASSIGNED.equals(snapshot.get("project_access_mode"))
                    && snapshot.get("access") == null) {
                throw AppException.notFound("项目不存在或你没有访问权限：" + projectId);
            }
            if (ACCESS_READ.equals(snapshot.get("access"))) {
                throw new AppException(403, "你对该项目只有查看权限");
            }
        }
        return snapshot;
    }

    public void assertWriteForUpdate(String workspaceId, String userId, String projectId) {
        writableSnapshotForUpdate(workspaceId, userId, projectId);
    }

    /** Delivery force privilege only, after scope locks; never trust an ordinary role read or member cache. */
    public boolean canManageForUpdate(String workspaceId, String userId) {
        Map<String, Object> snapshot = memberMapper.selectDeliveryAccessForUpdate(workspaceId, userId, null);
        return snapshot != null && isPrivileged((String) snapshot.get("role"));
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
        Map<String, WorkspaceMember> roles = new HashMap<String, WorkspaceMember>();
        Map<String, Map<String, String>> grants = new HashMap<String, Map<String, String>>();
        for (Task t : tasks) {
            String wsId = t.getWorkspaceId();
            WorkspaceMember member;
            if (roles.containsKey(wsId)) {
                member = roles.get(wsId);
            } else {
                member = roleOfMember(wsId, userId);
                roles.put(wsId, member);
            }
            String role = member == null || member.getRole() == null ? "" : member.getRole();
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
                if (access == null) {
                    /* assigned 成员缺记录即不可见；存量 all 成员缺记录默认可参与 */
                    writable = !isAssigned(member);
                } else {
                    writable = !ACCESS_READ.equals(access) && !ACCESS_NONE.equals(access);
                }
            }
            t.setAccess(writable ? "write" : "read");
        }
    }

    private WorkspaceMember roleOfMember(String workspaceId, String userId) {
        return memberMapper.selectMember(workspaceId, userId);
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
        Map<String, Set<String>> explicitlyVisible = new HashMap<String, Set<String>>();
        if (projectId != null) {
            for (ProjectMember pm : projectMemberMapper.selectByWorkspace(workspaceId)) {
                Map<String, Set<String>> target = ACCESS_NONE.equals(pm.getAccess()) ? hidden : explicitlyVisible;
                Set<String> projects = target.get(pm.getUserId());
                if (projects == null) {
                    projects = new HashSet<String>();
                    target.put(pm.getUserId(), projects);
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
            if (projects != null && projects.contains(projectId)) {
                continue;
            }
            /* assigned 成员只有在项目上有显式 write/read 才算可见；缺记录不能默认参与 */
            if (isAssigned(m)) {
                Set<String> granted = explicitlyVisible.get(userId);
                if (granted == null || !granted.contains(projectId)) {
                    continue;
                }
            }
            visible.add(m);
        }
        return visible;
    }

    public List<ProjectMember> grants(String workspaceId) {
        return projectMemberMapper.selectByWorkspace(workspaceId);
    }

    /**
     * 空间群机器人摘要用：只要某项目对任一 member 显式 none，就不进入群消息，避免成员级隐藏内容外泄。
     * 角色调整会保留项目授权，所以 admin/viewer 名下可能残留 none 行；它们当前全量可见，不应参与隐藏。
     */
    public Set<String> projectsHiddenFromAnyMember(String workspaceId) {
        Set<String> hidden = new HashSet<String>();
        Set<String> members = new HashSet<String>();
        for (WorkspaceMember m : memberMapper.selectByWorkspace(workspaceId)) {
            if (ROLE_MEMBER.equals(m.getRole())) {
                members.add(m.getUserId());
            }
        }
        if (members.isEmpty()) {
            return hidden;
        }
        for (ProjectMember pm : projectMemberMapper.selectByWorkspace(workspaceId)) {
            if (ACCESS_NONE.equals(pm.getAccess()) && members.contains(pm.getUserId())) {
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
     * 保存单个单元格。归一化后为空表示「未指定」：
     * assigned 成员落 none（默认不可见），其余成员删除记录回到默认参与。
     * 历史弹窗可能仍提交 pm/dev/qa，一律收敛为默认参与。
     *
     * @return 实际生效的权限值；空串表示已删除记录（默认参与）
     */
    public String saveGrant(String workspaceId, String userId, String projectId, String access) {
        if (projectId == null) {
            throw AppException.badRequest("请选择项目");
        }
        String value = normalizeAccess(access);
        if (!value.isEmpty() && !ACCESS_VALUES.contains(value)) {
            throw AppException.badRequest("可见范围取值不合法：" + access);
        }
        WorkspaceMember target = memberMapper.selectMember(workspaceId, userId);
        boolean assigned = isAssigned(target);
        if (value.isEmpty()) {
            value = assigned ? ACCESS_NONE : "";
        } else if (ACCESS_WRITE.equals(value) && !assigned) {
            /* 存量成员缺记录即可参与，显式 write 是冗余行：删掉保持「只存例外」 */
            value = "";
        }
        if (value.isEmpty()) {
            projectMemberMapper.deleteOne(workspaceId, projectId, userId);
            return "";
        }
        upsertGrant(workspaceId, userId, projectId, value);
        return value;
    }

    /** saveGrant 的返回值换算成有效权限：空串按成员模式回落 */
    public static String effectiveOf(String saved, WorkspaceMember member) {
        String value = normalizeAccess(saved);
        if (!value.isEmpty()) {
            return value;
        }
        return isAssigned(member) ? ACCESS_NONE : ACCESS_WRITE;
    }

    /**
     * 批量保存某成员在多个项目上的权限，整批在一个事务内：任一项失败全部回滚，
     * 不会出现「前几个项目已改、后几个没改」的半保存状态。
     *
     * @param wanted projectId → 已归一化的提交值（write/read/none/空串）
     * @return 实际发生变化的 projectId → 变化后的有效权限（write/read/none），保持提交顺序
     */
    @Transactional
    public Map<String, String> saveMemberGrants(String workspaceId, WorkspaceMember target,
                                                Map<String, String> wanted) {
        Map<String, String> changed = new LinkedHashMap<String, String>();
        for (Map.Entry<String, String> entry : wanted.entrySet()) {
            String projectId = entry.getKey();
            String before = effectiveAccess(workspaceId, projectId, target);
            String after = effectiveOf(saveGrant(workspaceId, target.getUserId(), projectId, entry.getValue()), target);
            if (!before.equals(after)) {
                changed.put(projectId, after);
            }
        }
        return changed;
    }

    private void upsertGrant(String workspaceId, String userId, String projectId, String access) {
        ProjectMember pm = new ProjectMember();
        pm.setWorkspaceId(workspaceId);
        pm.setProjectId(projectId);
        pm.setUserId(userId);
        pm.setAccess(access);
        projectMemberMapper.upsert(pm);
    }

    /** 为 assigned 成员补齐缺失项目的 none 种子行；幂等，加入 / 建项目 / 启动自检都会调用 */
    public void seedAssignedNone(String workspaceId) {
        projectMemberMapper.seedAssignedNone(workspaceId);
    }

    /** 项目删除时清理它的可见范围配置与角色标签 */
    public void clearProject(String workspaceId, String projectId) {
        projectMemberMapper.deleteByProject(workspaceId, projectId);
        if (projectMemberRoleMapper != null) {
            projectMemberRoleMapper.deleteByProject(workspaceId, projectId);
        }
    }
}
