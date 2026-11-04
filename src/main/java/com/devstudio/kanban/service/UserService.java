package com.devstudio.kanban.service;

import com.devstudio.kanban.common.AppException;
import com.devstudio.kanban.common.CurrentUser;
import com.devstudio.kanban.common.Ids;
import com.devstudio.kanban.common.LoginUser;
import com.devstudio.kanban.common.Texts;
import com.devstudio.kanban.dto.PasswordChangeRequest;
import com.devstudio.kanban.dto.PasswordResetRequest;
import com.devstudio.kanban.dto.ProfileUpdateRequest;
import com.devstudio.kanban.dto.UserCreateRequest;
import com.devstudio.kanban.dto.UserUpdateRequest;
import com.devstudio.kanban.dto.WorkHoursRequest;
import com.devstudio.kanban.entity.AppUser;
import com.devstudio.kanban.mapper.RequirementMapper;
import com.devstudio.kanban.mapper.TaskMapper;
import com.devstudio.kanban.mapper.UserMapper;
import com.devstudio.kanban.mapper.WorkspaceMapper;
import com.devstudio.kanban.mapper.WorkspaceMemberMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.List;

/**
 * 账号体系：管理员创建下发账号（不开放注册）；每个账号自动创建个人空间。
 * 首次启动时用 app.auth.* 环境变量引导创建管理员。
 */
@Service
public class UserService implements UserDetailsService {

    private static final Logger log = LoggerFactory.getLogger(UserService.class);
    private static final String RANDOM_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

    private final UserMapper userMapper;
    private final WorkspaceMapper workspaceMapper;
    private final WorkspaceMemberMapper memberMapper;
    private final com.devstudio.kanban.mapper.ProjectMemberMapper projectMemberMapper;
    private final TaskMapper taskMapper;
    private final RequirementMapper reqMapper;
    private final WorkspaceService workspaceService;
    private final PasswordEncoder encoder;
    private final WorkspaceMemberCache memberCache;

    @Value("${app.auth.username:admin}")
    private String bootstrapUser;

    @Value("${app.auth.password:}")
    private String bootstrapPassword;

    public UserService(UserMapper userMapper, WorkspaceMapper workspaceMapper, WorkspaceMemberMapper memberMapper,
                       com.devstudio.kanban.mapper.ProjectMemberMapper projectMemberMapper,
                       TaskMapper taskMapper, RequirementMapper reqMapper,
                       WorkspaceService workspaceService, PasswordEncoder encoder,
                       WorkspaceMemberCache memberCache) {
        this.userMapper = userMapper;
        this.workspaceMapper = workspaceMapper;
        this.memberMapper = memberMapper;
        this.projectMemberMapper = projectMemberMapper;
        this.taskMapper = taskMapper;
        this.reqMapper = reqMapper;
        this.workspaceService = workspaceService;
        this.encoder = encoder;
        this.memberCache = memberCache;
    }

    /* ==================== 登录 ==================== */

    @Override
    public UserDetails loadUserByUsername(String username) throws UsernameNotFoundException {
        AppUser u = userMapper.selectByUsername(username);
        if (u == null) {
            // 邮箱登录：登录名查不到再按邮箱取（写入口有唯一校验，邮箱不会指向多个账号）
            u = userMapper.selectByEmail(username);
        }
        if (u == null) {
            throw new UsernameNotFoundException("用户不存在");
        }
        return new LoginUser(u.getId(), u.getUsername(), u.getPasswordHash(), u.getDisplayName(), u.getRole());
    }

    @EventListener(ApplicationReadyEvent.class)
    public void bootstrapAdmin() {
        try {
            if (userMapper.countAll() == 0) {
                String username = Texts.trimToNull(bootstrapUser);
                username = username == null ? "admin" : Texts.cut(username, 32);
                String raw = bootstrapPassword == null ? "" : bootstrapPassword.trim();
                String password;
                if (raw.isEmpty()) {
                    password = randomPassword();
                    /* 密码只走标准输出一次性展示，不进日志文件，避免被日志采集系统带走 */
                    log.warn("首次启动：未配置 AUTH_PASSWORD，已创建管理员 {}，临时密码见控制台输出（登录后请在用户管理中重置）", username);
                    System.out.println("[DevStudio] 管理员 " + username + " 的临时密码：" + password + "（仅本次启动显示，登录后请重置）");
                } else {
                    password = raw;
                    log.info("首次启动：已创建管理员账号 {}", username);
                }
                createAccount(username, password, username, "admin", true);
            }
            ensurePersonalSpaces();
        } catch (Exception e) {
            log.error("引导管理员/个人空间修复失败：请检查 AUTH_USER（3-32 位）与 AUTH_PASSWORD 配置、以及数据库结构是否为最新版。原因：{}", e.getMessage(), e);
        }
    }

    /** 自愈：为缺失个人空间的账号补建（覆盖历史异常产生的账号） */
    private void ensurePersonalSpaces() {
        for (AppUser u : userMapper.selectAll()) {
            workspaceService.createPersonal(u.getId());
            if (Texts.trimToNull(u.getLastWorkspaceId()) == null) {
                userMapper.updateLastWorkspace(u.getId(), WorkspaceService.personalId(u.getId()));
            }
        }
    }

    /* ==================== 管理（仅管理员） ==================== */

    public List<AppUser> list() {
        return userMapper.selectAll();
    }

    @Transactional
    public AppUser create(UserCreateRequest req) {
        String username = req.getUsername().trim();
        if (userMapper.selectByUsername(username) != null) {
            throw new AppException(409, "登录名已存在：" + username);
        }
        String displayName = Texts.trimToNull(req.getDisplayName());
        AppUser u = createAccount(username, req.getPassword(),
                displayName == null ? username : Texts.cut(displayName, 32),
                req.getRole() == null ? "user" : req.getRole(), false);
        return u;
    }

    /** 修改自己的显示名（与管理员改名同规则；不触碰角色；同步更新任务负责人名） */
    @Transactional
    public AppUser updateProfile(String id, ProfileUpdateRequest req) {
        AppUser u = requireUser(id);
        String oldName = u.getDisplayName();
        String newName = cleanName(req.getDisplayName(), oldName);
        u.setRole(null); // 只改显示名和邮箱：SQL 条件跳过 role 写入
        u.setDisplayName(newName);
        u.setEmail(uniqueEmail(Texts.trimToNull(req.getEmail()), id));
        userMapper.update(u);
        syncTaskOwnerName(id, oldName, newName);
        return userMapper.selectById(id);
    }

    /**
     * 修改自己的计时设置：工作时段（默认 09:00–18:00）+ 每天上限（默认 8 小时）。
     * 只影响**之后**的计时折算，已记录的工时不做重算（避免历史数据被改来改去）。
     */
    @Transactional
    public AppUser updateWorkHours(String id, WorkHoursRequest req) {
        requireUser(id);
        int sh = req.getStartHour();
        int eh = req.getEndHour();
        int mh = req.getMaxHours() == null ? 8 : req.getMaxHours();
        if (eh <= sh) {
            throw AppException.badRequest("下班时间必须晚于上班时间（例如 9 点到 18 点）");
        }
        userMapper.updateWorkHours(id, sh, eh, mh);
        return userMapper.selectById(id);
    }

    /**
     * 改名后同步"负责人文本"（限该用户参与的空间，含回收站任务；时间线保留历史记录）。
     *
     * 复评 R-2：身份绑定上线后 owner_user_id 才是权威，文本列只是历史兜底，
     * 因此这里的条件已收紧（见 TaskMapper.xml 的 renameOwner）：
     * · owner_user_id = 该用户 → 无条件同步；
     * · owner_user_id 为空且 owner = 旧名 → 仅当该空间内没有另一个同名的在册成员时才同步，
     *   避免"同名的另一个人的任务被连带改错"。
     * 想彻底不再依赖文本层，可先跑 sql/04_backfill_owner_user.sql 回填 owner_user_id。
     */
    private void syncTaskOwnerName(String userId, String oldName, String newName) {
        if (oldName == null || newName == null || oldName.equals(newName)) {
            return;
        }
        taskMapper.renameOwner(userId, oldName, newName);
    }

    @Transactional
    public AppUser update(String id, UserUpdateRequest req) {
        AppUser u = requireUser(id);
        if (req.getRole() != null) {
            // 所有角色变更都在锁内按"锁定后的当前管理员列表"判断：
            // 不依赖此前读取的旧角色，避免"快照里是普通用户、随后被提升"的交错绕过约束
            List<String> admins = userMapper.lockAdmins();
            if ("user".equals(req.getRole()) && admins.contains(id) && admins.size() <= 1) {
                throw AppException.badRequest("至少保留一个管理员账号");
            }
            u.setRole(req.getRole());
        } else {
            // 仅改显示名：不写角色（SQL 条件跳过），否则会把旧快照角色回写，并发时可清掉管理员
            u.setRole(null);
        }
        String oldName = u.getDisplayName();
        String newName = cleanName(req.getDisplayName(), oldName);
        u.setDisplayName(newName);
        // 邮箱是登录凭据之一，编辑与其他账号重复时直接拒绝，而不是静默落库造成登录歧义
        u.setEmail(uniqueEmail(Texts.trimToNull(req.getEmail()), id));
        userMapper.update(u);
        syncTaskOwnerName(id, oldName, newName);
        return userMapper.selectById(id);
    }

    public void resetPassword(String id, PasswordResetRequest req) {
        requireUser(id);
        checkPasswordBytes(req.getPassword(), "密码");
        userMapper.updatePassword(id, encoder.encode(req.getPassword()));
        // 说明：已登录的会话（30 天）不会因此失效，重置后建议提醒对方重新登录
    }

    /** 修改自己的密码（校验旧密码）；已登录会话保持有效直到过期 */
    @Transactional
    public void changePassword(String userId, PasswordChangeRequest req) {
        AppUser u = requireUser(userId);
        if (!encoder.matches(req.getOldPassword(), u.getPasswordHash())) {
            throw AppException.badRequest("原密码不正确");
        }
        checkPasswordBytes(req.getNewPassword(), "新密码");
        userMapper.updatePassword(userId, encoder.encode(req.getNewPassword()));
    }

    @Transactional
    public void delete(String id) {
        requireUser(id);
        LoginUser me = CurrentUser.get();
        if (id.equals(me.getId())) {
            throw AppException.badRequest("不能删除当前登录账号");
        }
        // 删除前锁管理员行（与降权/升权串行化），并用锁定后的当前列表判断：
        // u 的角色可能是并发提升/降权前的旧快照，不能据此决定豁免
        List<String> admins = userMapper.lockAdmins();
        if (admins.contains(id) && admins.size() <= 1) {
            throw AppException.badRequest("至少保留一个管理员账号");
        }
        if (workspaceMapper.countSharedByOwner(id) > 0) {
            throw AppException.badRequest("该账号是共享空间的空间主，请先删除或转交这些空间");
        }
        String personalId = WorkspaceService.personalId(id);
        int tasks = taskMapper.countByWorkspace(personalId);
        int reqs = reqMapper.countByWorkspace(personalId);
        if (tasks > 0 || reqs > 0) {
            throw AppException.badRequest("该账号的个人看板还有 " + tasks + " 项任务 / " + reqs + " 个项目，请先清空后再删除");
        }
        // 退出所有共享空间 + 清空个人空间配置数据
        memberMapper.deleteAllByUser(id);
        projectMemberMapper.deleteAllByUser(id);
        workspaceService.wipeData(personalId);
        workspaceMapper.deleteById(personalId);
        userMapper.deleteById(id);
        CacheSync.evictAfterCommitOrNow(() -> memberCache.evictUser(id));
    }

    /* ==================== 内部 ==================== */

    /** bcrypt 仅使用前 72 字节输入：超长部分会被静默忽略，必须在入口按 UTF-8 字节数拦截 */
    private static final int MAX_PASSWORD_BYTES = 72;

    /** 创建账号 + 个人空间（先建空间再插用户：任一步失败都不留"无空间的账号"，重启由自愈逻辑兜底） */
    private AppUser createAccount(String username, String rawPassword, String displayName, String role,
                                  boolean allowEncodedHash) {
        String id = Ids.gen("U");
        workspaceService.createPersonal(id);
        AppUser u = new AppUser();
        u.setId(id);
        u.setUsername(username);
        // 仅首启引导（AUTH_PASSWORD）允许直接配置 bcrypt 哈希，且必须是完整 60 位格式；
        // 管理端建号一律按明文加密，避免"密码恰好以 $2a$ 开头"被当成哈希导致无法登录
        String hash;
        if (allowEncodedHash && isBcryptHash(rawPassword)) {
            hash = rawPassword;
        } else {
            checkPasswordBytes(rawPassword, "密码");
            hash = encoder.encode(rawPassword == null ? "" : rawPassword);
        }
        u.setPasswordHash(hash);
        u.setDisplayName(cleanName(displayName, username));
        u.setRole(role);
        u.setLastWorkspaceId(WorkspaceService.personalId(id));
        userMapper.insert(u);
        return userMapper.selectById(id);
    }

    /** bcrypt 哈希完整格式：$2a/$2b/$2y + 2 位 cost + 53 位 base64，共 60 位 */
    private boolean isBcryptHash(String value) {
        return value != null && value.length() == 60
                && value.matches("^\\$2[aby]\\$[0-9]{2}\\$[./A-Za-z0-9]{53}$");
    }

    /** 密码按 UTF-8 字节数校验（中文约每字 3 字节）：超过 bcrypt 的 72 字节上限会被静默截断 */
    private void checkPasswordBytes(String password, String label) {
        if (password != null && password.getBytes(StandardCharsets.UTF_8).length > MAX_PASSWORD_BYTES) {
            throw AppException.badRequest(label + "过长：按 UTF-8 计算不能超过 72 字节（中文约每字 3 字节），请缩短后重试");
        }
    }

    /** 显示名会拼接进筛选参数（逗号分隔），不允许含逗号 */
    private String cleanName(String raw, String fallback) {
        String name = raw == null ? "" : raw.replace(',', ' ').replace('，', ' ').trim();
        return name.isEmpty() ? fallback : Texts.cut(name, 32);
    }

    /** 邮箱可空（清除）；非空时校验未被其他账号占用（数据库按 CI 排序规则比较） */
    private String uniqueEmail(String email, String selfId) {
        if (email == null || email.isEmpty()) {
            return null;
        }
        if (userMapper.countByEmail(email, selfId) > 0) {
            throw AppException.badRequest("该邮箱已被其他账号使用：" + email);
        }
        return Texts.cut(email, 254);
    }

    private AppUser requireUser(String id) {
        AppUser u = userMapper.selectById(id);
        if (u == null) {
            throw AppException.notFound("用户不存在：" + id);
        }
        return u;
    }

    private String randomPassword() {
        SecureRandom random = new SecureRandom();
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < 12; i++) {
            sb.append(RANDOM_CHARS.charAt(random.nextInt(RANDOM_CHARS.length())));
        }
        return sb.toString();
    }
}
