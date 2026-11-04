package com.devstudio.kanban.service;

import com.devstudio.kanban.common.AppException;
import com.devstudio.kanban.common.Texts;
import com.devstudio.kanban.entity.AppUser;
import com.devstudio.kanban.entity.Invite;
import com.devstudio.kanban.entity.Workspace;
import com.devstudio.kanban.mapper.InviteMapper;
import com.devstudio.kanban.mapper.UserMapper;
import com.devstudio.kanban.mapper.WorkspaceMapper;
import com.devstudio.kanban.mapper.WorkspaceMemberMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.SecureRandom;
import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

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
    private final WorkspaceMapper workspaceMapper;
    private final WorkspaceMemberMapper memberMapper;
    private final UserMapper userMapper;
    private final WorkspaceService workspaceService;

    public InviteService(InviteMapper inviteMapper, WorkspaceMapper workspaceMapper,
                         WorkspaceMemberMapper memberMapper, UserMapper userMapper,
                         WorkspaceService workspaceService) {
        this.inviteMapper = inviteMapper;
        this.workspaceMapper = workspaceMapper;
        this.memberMapper = memberMapper;
        this.userMapper = userMapper;
        this.workspaceService = workspaceService;
    }

    /* ==================== 空间主管理 ==================== */

    public Map<String, Object> create(String userId, String workspaceId) {
        requireShared(userId, workspaceId);
        Invite inv = new Invite();
        inv.setId(generateCode());
        inv.setWorkspaceId(workspaceId);
        inv.setCreatedBy(userId);
        inv.setExpiresAt(LocalDateTime.now().plusDays(EXPIRE_DAYS));
        inviteMapper.insert(inv);
        Map<String, Object> res = new LinkedHashMap<String, Object>();
        res.put("id", inv.getId());
        res.put("expiresAt", inv.getExpiresAt());
        return res;
    }

    public List<Invite> list(String userId, String workspaceId) {
        requireShared(userId, workspaceId);
        return inviteMapper.selectByWorkspace(workspaceId);
    }

    public void revoke(String userId, String workspaceId, String inviteId) {
        requireShared(userId, workspaceId);
        Invite inv = inviteMapper.selectById(inviteId);
        if (inv == null || !workspaceId.equals(inv.getWorkspaceId())) {
            throw AppException.notFound("邀请不存在或已被撤销");
        }
        inviteMapper.delete(inviteId);
    }

    /* ==================== 凭链接加入（公开 / 登录用户） ==================== */

    /** 邀请信息（公开）：空间名、邀请人、有效期 */
    public Map<String, Object> info(String code) {
        Invite inv = requireValid(code);
        Workspace ws = requireSharedWorkspace(inv);
        Map<String, Object> res = new LinkedHashMap<String, Object>();
        res.put("workspaceName", ws.getName());
        AppUser inviter = userMapper.selectById(inv.getCreatedBy());
        res.put("inviterName", inviter == null ? "" : inviter.getDisplayName());
        res.put("expiresAt", inv.getExpiresAt());
        return res;
    }

    /** 已有账号加入（需登录） */
    @Transactional
    public Map<String, Object> join(String code, String userId) {
        Invite inv = requireValid(code);
        Workspace ws = requireSharedWorkspace(inv);
        Map<String, Object> res = new LinkedHashMap<String, Object>();
        res.put("workspaceId", inv.getWorkspaceId());
        res.put("workspaceName", ws.getName());
        if (memberMapper.selectMember(inv.getWorkspaceId(), userId) != null) {
            res.put("already", true);
            return res;
        }
        workspaceService.joinByInvite(inv.getWorkspaceId(), userId);
        inviteMapper.incrUsedCount(inv.getId());
        res.put("already", false);
        return res;
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
        String c = Texts.trimToNull(code);
        if (c != null) {
            c = c.toUpperCase(Locale.ROOT);
        }
        Invite inv = c == null ? null : inviteMapper.selectById(c);
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
