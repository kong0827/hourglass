package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.common.Texts;
import com.hourglass.dto.InviteCreateRequest;
import com.hourglass.entity.AppUser;
import com.hourglass.entity.Invite;
import com.hourglass.entity.InviteProjectGrant;
import com.hourglass.entity.ProjectMember;
import com.hourglass.entity.Requirement;
import com.hourglass.entity.Workspace;
import com.hourglass.mapper.InviteMapper;
import com.hourglass.mapper.InviteProjectGrantMapper;
import com.hourglass.mapper.ProjectMemberMapper;
import com.hourglass.mapper.RequirementMapper;
import com.hourglass.mapper.UserMapper;
import com.hourglass.mapper.WorkspaceMapper;
import com.hourglass.mapper.WorkspaceMemberMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.LocalDateTime;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * 空间邀请链接：空间主生成 7 天有效的邀请码；
 * 新用户凭链接注册账号并加入，已有账号登录后凭链接加入。
 */
@Service
public class InviteService {

    private static final int EXPIRE_DAYS = 7;
    /** 去掉易混淆字符（I/L/O/0/1）的邀请码字符集 */
    private static final String CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    private static final SecureRandom RANDOM = new SecureRandom();

    private final InviteMapper inviteMapper;
    private final InviteProjectGrantMapper inviteGrantMapper;
    private final ProjectMemberMapper projectMemberMapper;
    private final RequirementMapper requirementMapper;
    private final WorkspaceMapper workspaceMapper;
    private final WorkspaceMemberMapper memberMapper;
    private final UserMapper userMapper;
    private final WorkspaceService workspaceService;
    /** 空间活动流：邀请生成/撤销属于空间配置变更，成员在活动页可见 */
    private final ActivityService activityService;
    /** 安全审计：邀请码是进入空间的凭证，创建/撤销需可追责 */
    private final AuditService auditService;

    public InviteService(InviteMapper inviteMapper, InviteProjectGrantMapper inviteGrantMapper,
                         ProjectMemberMapper projectMemberMapper, RequirementMapper requirementMapper,
                         WorkspaceMapper workspaceMapper,
                         WorkspaceMemberMapper memberMapper, UserMapper userMapper,
                         WorkspaceService workspaceService, ActivityService activityService,
                         AuditService auditService) {
        this.inviteMapper = inviteMapper;
        this.inviteGrantMapper = inviteGrantMapper;
        this.projectMemberMapper = projectMemberMapper;
        this.requirementMapper = requirementMapper;
        this.workspaceMapper = workspaceMapper;
        this.memberMapper = memberMapper;
        this.userMapper = userMapper;
        this.workspaceService = workspaceService;
        this.activityService = activityService;
        this.auditService = auditService;
    }

    /* ==================== 空间主管理 ==================== */

    public Map<String, Object> create(String userId, String workspaceId) {
        return create(userId, workspaceId, null);
    }

    /**
     * 生成邀请链接。grants 可为空：加入后默认不参与任何项目；
     * 非空时只接受 write（可参与）/ read（只读），未列出的项目一律不可见。
     */
    @Transactional
    public Map<String, Object> create(String userId, String workspaceId, InviteCreateRequest request) {
        requireShared(userId, workspaceId);
        Invite inv = new Invite();
        inv.setId(generateCode());
        inv.setWorkspaceId(workspaceId);
        inv.setCreatedBy(userId);
        inv.setExpiresAt(LocalDateTime.now().plusDays(EXPIRE_DAYS));
        inviteMapper.insert(inv);

        int grantCount = 0;
        if (request != null && request.getGrants() != null) {
            Set<String> seen = new HashSet<String>();
            for (InviteCreateRequest.Grant item : request.getGrants()) {
                if (item == null) {
                    continue;
                }
                String projectId = Texts.trimToNull(item.getProjectId());
                if (projectId == null || !seen.add(projectId)) {
                    continue;
                }
                String access = ProjectAccessService.normalizeAccess(item.getAccess());
                if (access.isEmpty() || ProjectAccessService.ACCESS_NONE.equals(access)) {
                    continue;
                }
                if (!ProjectAccessService.ACCESS_WRITE.equals(access)
                        && !ProjectAccessService.ACCESS_READ.equals(access)) {
                    throw AppException.badRequest("项目权限只能是可参与 / 只读 / 不可见");
                }
                Requirement project = requirementMapper.selectById(projectId);
                if (project == null || !workspaceId.equals(project.getWorkspaceId())) {
                    throw AppException.notFound("项目不存在或不属于当前空间：" + projectId);
                }
                InviteProjectGrant grant = new InviteProjectGrant();
                grant.setInviteId(inv.getId());
                grant.setWorkspaceId(workspaceId);
                grant.setProjectId(projectId);
                grant.setAccess(access);
                inviteGrantMapper.insert(grant);
                grantCount++;
            }
        }

        activityService.logConfig(workspaceId, userId,
                "生成邀请链接（预分配 " + grantCount + " 个项目，" + EXPIRE_DAYS + " 天内有效）");
        /* 邀请码本身是 bearer 凭证，审计只记不可逆指纹，避免管理端二次扩散 */
        auditService.recordCurrent(workspaceId, "invite_create", "invite", inviteFingerprint(inv.getId()), null,
                true, "生成邀请链接，预分配 " + grantCount + " 个项目，" + EXPIRE_DAYS + " 天内有效", null);

        Map<String, Object> res = new LinkedHashMap<String, Object>();
        res.put("id", inv.getId());
        res.put("expiresAt", inv.getExpiresAt());
        res.put("grantCount", grantCount);
        return res;
    }

    public com.hourglass.dto.PageResult<Invite> list(
            String userId, String workspaceId, int offset, int limit) {
        requireShared(userId, workspaceId);
        int safeOffset = Math.max(0, offset);
        int safeLimit = Math.max(1, Math.min(100, limit));
        int total = inviteMapper.countByWorkspace(workspaceId);
        List<Invite> items = total <= safeOffset ? new java.util.ArrayList<Invite>()
                : inviteMapper.selectByWorkspace(workspaceId, safeOffset, safeLimit);
        return com.hourglass.dto.PageResult.of(items, total, safeOffset, safeLimit);
    }

    /** 撤销与加入共用邀请行锁：撤销提交后，并发中的加入会读到「邀请不存在」而不是按旧授权落库 */
    @Transactional
    public void revoke(String userId, String workspaceId, String inviteId) {
        requireShared(userId, workspaceId);
        Invite inv = inviteId == null ? null : inviteMapper.selectByIdForUpdate(inviteId);
        if (inv == null || !workspaceId.equals(inv.getWorkspaceId())) {
            throw AppException.notFound("邀请不存在或已被撤销");
        }
        inviteGrantMapper.deleteByInvite(inviteId);
        inviteMapper.delete(inviteId);
        /* 不把邀请码写进摘要或 targetId：审计按空间可查，码本身不需要二次扩散 */
        activityService.logConfig(workspaceId, userId, "撤销邀请链接");
        auditService.recordCurrent(workspaceId, "invite_revoke", "invite", inviteFingerprint(inviteId), null,
                true, "撤销邀请链接", null);
    }

    /* ==================== 凭链接加入（公开 / 登录用户） ==================== */

    /**
     * 邀请信息（公开）：空间名、邀请人、有效期、预分配项目数。
     * viewerId 非空且已是该空间成员时，额外返回 workspaceId 供加入页直接「进入空间」，
     * 匿名访问不暴露空间 ID。
     */
    public Map<String, Object> info(String code, String viewerId) {
        Invite inv = requireValid(code);
        Workspace ws = requireSharedWorkspace(inv);
        Map<String, Object> res = new LinkedHashMap<String, Object>();
        res.put("workspaceName", ws.getName());
        AppUser inviter = userMapper.selectById(inv.getCreatedBy());
        res.put("inviterName", inviter == null ? "" : inviter.getDisplayName());
        res.put("expiresAt", inv.getExpiresAt());
        int write = 0;
        int read = 0;
        List<InviteProjectGrant> grants = inviteGrantMapper.selectByInvite(inv.getId());
        if (grants != null) {
            for (InviteProjectGrant g : grants) {
                String access = ProjectAccessService.normalizeAccess(g.getAccess());
                if (ProjectAccessService.ACCESS_WRITE.equals(access)) {
                    write++;
                } else if (ProjectAccessService.ACCESS_READ.equals(access)) {
                    read++;
                }
            }
        }
        res.put("writeGrantCount", write);
        res.put("readGrantCount", read);
        boolean member = viewerId != null && memberMapper.selectMember(inv.getWorkspaceId(), viewerId) != null;
        res.put("alreadyMember", member);
        if (member) {
            res.put("workspaceId", inv.getWorkspaceId());
        }
        return res;
    }

    public Map<String, Object> info(String code) {
        return info(code, null);
    }

    /**
     * 已有账号加入（需登录）。
     * 先锁邀请行再锁用户行：同一邀请的加入/撤销串行，同一用户的并发加入（双击、多标签页）
     * 在用户行上排队，第二个请求读到已是成员直接返回，不会撞主键也不会重复计数。
     */
    @Transactional
    public Map<String, Object> join(String code, String userId) {
        Invite inv = requireValid(code, true);
        Workspace ws = requireSharedWorkspace(inv);
        userMapper.lockById(userId);
        Map<String, Object> res = new LinkedHashMap<String, Object>();
        res.put("workspaceId", inv.getWorkspaceId());
        res.put("workspaceName", ws.getName());
        if (memberMapper.selectMember(inv.getWorkspaceId(), userId) != null) {
            res.put("already", true);
            return res;
        }
        workspaceService.joinByInvite(inv.getWorkspaceId(), userId);
        int granted = applyGrants(inv, userId);
        if (inviteMapper.incrUsedCount(inv.getId()) != 1) {
            /* 行锁下仍未更新到，说明邀请已被撤销：整笔回滚，不留下半加入状态 */
            throw AppException.notFound("邀请链接无效或已被撤销");
        }
        res.put("already", false);
        res.put("grantCount", granted);
        return res;
    }

    /** 把邀请上预分配的项目权限落到新成员；项目已删除的授权跳过 */
    private int applyGrants(Invite inv, String userId) {
        List<InviteProjectGrant> grants = inviteGrantMapper.selectByInvite(inv.getId());
        if (grants == null || grants.isEmpty()) {
            return 0;
        }
        int applied = 0;
        for (InviteProjectGrant grant : grants) {
            String access = ProjectAccessService.normalizeAccess(grant.getAccess());
            if (ProjectAccessService.ACCESS_NONE.equals(access) || access.isEmpty()) {
                continue;
            }
            Requirement project = requirementMapper.selectById(grant.getProjectId());
            if (project == null || !inv.getWorkspaceId().equals(project.getWorkspaceId())) {
                continue;
            }
            ProjectMember pm = new ProjectMember();
            pm.setWorkspaceId(inv.getWorkspaceId());
            pm.setProjectId(grant.getProjectId());
            pm.setUserId(userId);
            pm.setAccess(access);
            projectMemberMapper.upsert(pm);
            applied++;
        }
        return applied;
    }

    /* ==================== 内部 ==================== */

    /** 邀请只属于共享空间；个人空间不可邀请也不能查询/撤销邀请 */
    private Workspace requireShared(String userId, String workspaceId) {
        Workspace ws = workspaceService.requireManager(userId, workspaceId);
        if ("personal".equals(ws.getType())) {
            throw AppException.badRequest("个人空间不可邀请成员，请先新建共享空间");
        }
        return ws;
    }

    private Invite requireValid(String code) {
        return requireValid(code, false);
    }

    private Invite requireValid(String code, boolean forUpdate) {
        String c = Texts.trimToNull(code);
        if (c != null) {
            c = c.toUpperCase(Locale.ROOT);
        }
        Invite inv = c == null ? null : (forUpdate ? inviteMapper.selectByIdForUpdate(c) : inviteMapper.selectById(c));
        if (inv == null) {
            throw AppException.notFound("邀请链接无效或已被撤销");
        }
        if (inv.getExpiresAt() != null && inv.getExpiresAt().isBefore(LocalDateTime.now())) {
            throw AppException.badRequest("邀请链接已过期，请联系空间主重新生成");
        }
        return inv;
    }

    private Workspace requireSharedWorkspace(Invite inv) {
        Workspace ws = workspaceMapper.selectById(inv.getWorkspaceId());
        if (ws == null || !"shared".equals(ws.getType())) {
            throw AppException.badRequest("邀请对应的空间不存在或已删除");
        }
        return ws;
    }

    /**
     * 审计用的邀请码指纹：同一邀请码在创建/撤销两条记录中可关联，但无法从审计表还原出可用的码。
     * 算法不可用时退化为不带标识，也绝不回退成明文邀请码。
     */
    private static String inviteFingerprint(String code) {
        if (code == null) {
            return null;
        }
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(("hourglass-invite:" + code).getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder("invite:");
            for (int i = 0; i < 16; i++) {
                sb.append(Character.forDigit((digest[i] >> 4) & 0xF, 16))
                        .append(Character.forDigit(digest[i] & 0xF, 16));
            }
            return sb.toString();
        } catch (Exception e) {
            return "invite";
        }
    }

    private String generateCode() {
        for (int attempt = 0; attempt < 5; attempt++) {
            StringBuilder sb = new StringBuilder(10);
            for (int i = 0; i < 10; i++) {
                sb.append(CODE_CHARS.charAt(RANDOM.nextInt(CODE_CHARS.length())));
            }
            String code = sb.toString();
            if (inviteMapper.selectById(code) == null) {
                return code;
            }
        }
        throw new AppException(500, "邀请码生成失败，请重试");
    }
}
