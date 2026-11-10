package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.common.Consts;
import com.hourglass.common.Ids;
import com.hourglass.common.Texts;
import com.hourglass.common.Webhooks;
import com.hourglass.dto.MemberCandidate;
import com.hourglass.dto.WorkspaceUpdateRequest;
import com.hourglass.entity.AppUser;
import com.hourglass.entity.BoardColumn;
import com.hourglass.entity.ProjectMember;
import com.hourglass.entity.Workspace;
import com.hourglass.entity.WorkspaceMember;
import com.hourglass.mapper.BoardColumnMapper;
import com.hourglass.mapper.CategoryMapper;
import com.hourglass.mapper.ColumnTransitionMapper;
import com.hourglass.mapper.WorkspacePriorityMapper;
import com.hourglass.mapper.AppNotificationMapper;
import com.hourglass.mapper.InviteMapper;
import com.hourglass.mapper.ProjectMemberMapper;
import com.hourglass.mapper.SavedViewMapper;
import com.hourglass.mapper.TaskWatchMapper;
import com.hourglass.mapper.UserListPreferenceMapper;
import com.hourglass.mapper.UserMapper;
import com.hourglass.mapper.WorkspaceMapper;
import com.hourglass.mapper.WorkspaceMemberMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.annotation.Lazy;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 空间：个人空间（每账号一个）+ 共享空间（空间主按登录名添加成员）
 */
@Service
public class WorkspaceService {

    private static final Logger log = LoggerFactory.getLogger(WorkspaceService.class);
    public static final String PERSONAL_PREFIX = "W";
    public static final String PERSONAL_NAME = "我的看板";

    private final WorkspaceMapper workspaceMapper;
    private final WorkspaceMemberMapper memberMapper;
    private final UserMapper userMapper;
    private final BoardColumnMapper boardColumnMapper;
    private final ColumnTransitionMapper transitionMapper;
    private final CategoryMapper categoryMapper;
    private final WorkspacePriorityMapper workspacePriorityMapper;
    private final SavedViewMapper savedViewMapper;
    private final AppNotificationMapper appNotificationMapper;
    private final UserListPreferenceMapper userListPreferenceMapper;
    private final WorkActivityService workActivityService;
    private final InviteMapper inviteMapper;
    private final ProjectMemberMapper projectMemberMapper;
    private final TaskWatchMapper taskWatchMapper;
    /** 任务/项目/文档/分支/依赖/附件等清空清单统一收口在 TaskCascade */
    private final TaskCascade cascade;
    /** 配置审计日志 */
    private final com.hourglass.service.ActivityService activityService;
    /** 成员关系缓存（单实例进程内，TTL 60 秒，写入口主动失效） */
    private final WorkspaceMemberCache memberCache;
    /** 空间 meta 缓存（列/模块/标签，按空间版本号失效） */
    private final WorkspaceMetaCache metaCache;

    public WorkspaceService(WorkspaceMapper workspaceMapper, WorkspaceMemberMapper memberMapper,
                            UserMapper userMapper, BoardColumnMapper boardColumnMapper,
                            ColumnTransitionMapper transitionMapper,
                            CategoryMapper categoryMapper,
                            WorkspacePriorityMapper workspacePriorityMapper,
                            SavedViewMapper savedViewMapper,
                            AppNotificationMapper appNotificationMapper,
                            UserListPreferenceMapper userListPreferenceMapper,
                            WorkActivityService workActivityService,
                            InviteMapper inviteMapper,
                            ProjectMemberMapper projectMemberMapper,
                            TaskWatchMapper taskWatchMapper,
                            TaskCascade cascade,
                            com.hourglass.service.ActivityService activityService,
                            WorkspaceMemberCache memberCache,
                            WorkspaceMetaCache metaCache) {
        this.workspaceMapper = workspaceMapper;
        this.memberMapper = memberMapper;
        this.userMapper = userMapper;
        this.boardColumnMapper = boardColumnMapper;
        this.transitionMapper = transitionMapper;
        this.categoryMapper = categoryMapper;
        this.workspacePriorityMapper = workspacePriorityMapper;
        this.savedViewMapper = savedViewMapper;
        this.appNotificationMapper = appNotificationMapper;
        this.userListPreferenceMapper = userListPreferenceMapper;
        this.workActivityService = workActivityService;
        this.inviteMapper = inviteMapper;
        this.projectMemberMapper = projectMemberMapper;
        this.taskWatchMapper = taskWatchMapper;
        this.cascade = cascade;
        this.activityService = activityService;
        this.memberCache = memberCache;
        this.metaCache = metaCache;
    }

    /* ==================== 解析与校验 ==================== */

    public static String personalId(String userId) {
        if (userId.length() < 32) {
            return PERSONAL_PREFIX + userId;
        }
        // 满 32 位的历史用户 ID 无法再加前缀，使用确定性摘要保持映射稳定且不超过字段宽度
        String digest = UUID.nameUUIDFromBytes(userId.getBytes(StandardCharsets.UTF_8))
                .toString().replace("-", "");
        return PERSONAL_PREFIX + digest.substring(0, 31);
    }

    /** 解析请求里的 workspace 参数：显式指定必须严格校验（失效即 404）；缺省时用上次空间、再退回个人空间 */
    public Workspace resolve(String userId, String workspaceParam) {
        String wsId = Texts.trimToNull(workspaceParam);
        if (wsId != null) {
            // 共享空间被删/被移除后，旧页面的写入必须拿到明确错误，绝不静默落到个人空间
            return requireMember(userId, wsId);
        }
        AppUser u = userMapper.selectById(userId);
        String last = u == null ? null : Texts.trimToNull(u.getLastWorkspaceId());
        if (last != null) {
            Workspace ws = memberCache.view(last, userId);
            if (ws != null) {
                return ws;
            }
        }
        return requireMember(userId, personalId(userId));
    }

    public Workspace requireMember(String userId, String workspaceId) {
        Workspace ws = memberCache.view(workspaceId, userId);
        if (ws == null) {
            throw AppException.notFound("空间不存在：" + workspaceId);
        }
        return ws;
    }

    /** 群机器人地址与 token 对非空间主脱敏，避免成员拿到 webhook 对外发消息 */
    private Workspace maskWebhook(Workspace ws) {
        if (!"owner".equals(ws.getMyRole())) {
            ws.setNotifyWebhook(null);
            ws.setNotifyToken(null);
        }
        return ws;
    }

    public Workspace requireOwner(String userId, String workspaceId) {
        Workspace ws = requireMember(userId, workspaceId);
        if (!"owner".equals(ws.getMyRole())) {
            throw new AppException(403, "仅空间主可执行该操作");
        }
        return ws;
    }

    /** 空间管理操作（邀请/移除成员、调整成员与查看者角色）：空间主或管理员 */
    public Workspace requireManager(String userId, String workspaceId) {
        Workspace ws = requireMember(userId, workspaceId);
        String role = ws.getMyRole();
        if (!"owner".equals(role) && !"admin".equals(role)) {
            throw new AppException(403, "仅空间主或管理员可执行该操作");
        }
        return ws;
    }

    /** 空间内的写入基线：查看者只能读，任何写配置/数据都走这一层 */
    public Workspace requireWriter(String userId, String workspaceId) {
        Workspace ws = requireMember(userId, workspaceId);
        if ("viewer".equals(ws.getMyRole())) {
            throw new AppException(403, "你在此空间是查看者，只能查看不能修改");
        }
        return ws;
    }

    /**
     * 取未脱敏的空间配置（仅空间主可用）。
     * 推送测试、推送状态读取都必须基于真实配置，否则会被 maskWebhook 清空地址/token 而误报"未配置"。
     */
    public Workspace requireOwnerRaw(String userId, String workspaceId) {
        Workspace ws = requireMember(userId, workspaceId);
        if (!"owner".equals(ws.getMyRole())) {
            throw new AppException(403, "仅空间主可执行该操作");
        }
        Workspace raw = workspaceMapper.selectById(workspaceId);
        if (raw == null) {
            throw AppException.notFound("空间不存在：" + workspaceId);
        }
        raw.setMyRole(ws.getMyRole());
        return raw;
    }

    /* ==================== 列表 / 创建 / 删除 ==================== */

    public List<Workspace> list(String userId) {
        List<Workspace> list = workspaceMapper.selectByUser(userId);
        for (Workspace ws : list) {
            maskWebhook(ws);
            ws.setProjectAccess(grantsFor(ws, userId));
        }
        return list;
    }

    /**
     * 当前用户的项目级范围（projectId → read/none）。
     * 只有 member 需要它：owner/admin 全量可写、viewer 全局只读，
     * 下发空表让前端按角色判定，避免两份口径互相打架。
     */
    private Map<String, String> grantsFor(Workspace ws, String userId) {
        Map<String, String> grants = new LinkedHashMap<String, String>();
        if (!ProjectAccessService.ROLE_MEMBER.equals(ws.getMyRole())) {
            return grants;
        }
        for (ProjectMember pm : projectMemberMapper.selectByUser(ws.getId(), userId)) {
            String value = ProjectAccessService.normalizeAccess(pm.getAccess());
            if (!value.isEmpty()) {
                grants.put(pm.getProjectId(), value);
            }
        }
        return grants;
    }

    @Transactional
    public Workspace createShared(String userId, String name) {
        String n = Texts.trimToNull(name);
        if (n == null) {
            throw AppException.badRequest("请填写空间名称");
        }
        Workspace ws = new Workspace();
        ws.setId(Ids.gen("S"));
        ws.setName(Texts.cut(n, 20));
        ws.setType("shared");
        ws.setOwnerId(userId);
        workspaceMapper.insert(ws);
        addMemberInternal(ws.getId(), userId, "owner");
        seedColumns(ws.getId());
        return workspaceMapper.selectById(ws.getId());
    }

    /** 建号时调用：创建个人空间（幂等） */
    @Transactional
    public void createPersonal(String userId) {
        String wsId = personalId(userId);
        if (workspaceMapper.selectById(wsId) != null) {
            return;
        }
        Workspace ws = new Workspace();
        ws.setId(wsId);
        ws.setName(PERSONAL_NAME);
        ws.setType("personal");
        ws.setOwnerId(userId);
        workspaceMapper.insert(ws);
        addMemberInternal(wsId, userId, "owner");
        /* 历史异常删除可能只删了 workspace 行、留下列/模块（主键含 workspace_id），先清理再灌默认，避免启动补齐时主键冲突 */
        boardColumnMapper.deleteAllByWorkspace(wsId);
        transitionMapper.deleteAllByWorkspace(wsId);
        categoryMapper.deleteAllByWorkspace(wsId);
        seedColumns(wsId);
    }

    @Transactional
    public void select(String userId, String workspaceId) {
        requireMember(userId, workspaceId);
        userMapper.updateLastWorkspace(userId, workspaceId);
    }

    @Transactional
    public Workspace update(String userId, String workspaceId, WorkspaceUpdateRequest req) {
        /* 鉴权走缓存，但要把完整字段写回库，必须以库里的最新配置为底稿：
           缓存里的空间快照可能落后于最近一次推送结果/改名，直接写回会覆盖别人的修改 */
        Workspace ws = requireOwnerRaw(userId, workspaceId);
        String name = Texts.trimToNull(req.getName());
        if (!"personal".equals(ws.getType()) && name != null) {
            ws.setName(Texts.cut(name, 20));
        }
        /* 两个保存入口（空间信息 / 推送配置）提交的字段不同：
           没提交的渠道、开关、Token、地址必须保持原值，不能当“清空”处理。
           否则改一次空间名就会把已配好的推送悄悄关掉。 */
        String rawHook = req.getNotifyWebhook();
        String hook = Texts.trimToNull(rawHook);
        if (rawHook == null) {
            /* 字段没提交（空间信息面板）→ 保持原地址 */
            hook = ws.getNotifyWebhook();
        }
        String channel = Texts.trimToNull(req.getNotifyChannel());
        if (channel == null) {
            channel = ws.getNotifyChannel();
        }
        /* O-1：渠道下沉到空间级。地址校验只在"按地址发送"的渠道上做：
           pushplus 统一发官方端点，空间地址仅作启用开关，不参与解析（与 NotificationService 一致）。 */
        if (hook != null && !"pushplus".equals(channel)) {
            String err = Webhooks.check(hook);
            if (err != null) {
                throw AppException.badRequest(err);
            }
        }
        ws.setNotifyWebhook(hook);
        ws.setNotifyChannel(channel);
        if (req.getNotifyEnabled() != null) {
            ws.setNotifyEnabled(req.getNotifyEnabled());
        }
        if (req.getNotifyInAppEnabled() != null) {
            ws.setNotifyInAppEnabled(req.getNotifyInAppEnabled());
        }
        if (Boolean.TRUE.equals(req.getClearToken())) {
            ws.setNotifyToken(null);
        } else {
            String token = Texts.trimToNull(req.getNotifyToken());
            if (token != null) {
                ws.setNotifyToken(token);
            }
        }
        workspaceMapper.update(ws);
        /* 名称/推送配置对成员可见，缓存里每个成员都存了一份空间快照 */
        CacheSync.evictAfterCommitOrNow(() -> memberCache.evictWorkspace(workspaceId));
        return workspaceMapper.selectById(workspaceId);
    }

    @Transactional
    public void deleteShared(String userId, String workspaceId) {
        Workspace ws = requireOwner(userId, workspaceId);
        if ("personal".equals(ws.getType())) {
            throw AppException.badRequest("个人空间不可删除");
        }
        wipeData(workspaceId);
        memberMapper.deleteAllByWorkspace(workspaceId);
        projectMemberMapper.deleteAllByWorkspace(workspaceId);
        inviteMapper.deleteAllByWorkspace(workspaceId);
        workspaceMapper.deleteById(workspaceId);
        userMapper.resetLastWorkspaceForAll(workspaceId);
        CacheSync.evictAfterCommitOrNow(() -> {
            memberCache.evictWorkspace(workspaceId);
            metaCache.evict(workspaceId);
        });
    }

    /** 清空一个空间的全部数据（任务/项目/需求文档/子任务/日志/标签/附件/工时/视图/模块/列/评论/通知/分支） */
    @Transactional
    public void wipeData(String workspaceId) {
        cascade.wipeWorkspaceData(workspaceId);
        /* 看板列/模块/保存视图属于空间配置，不属于任务级联，清空空间时单独处理 */
        savedViewMapper.deleteAllByWorkspace(workspaceId);
        userListPreferenceMapper.deleteAllByWorkspace(workspaceId);
        workActivityService.deleteAllByWorkspace(workspaceId);
        categoryMapper.deleteAllByWorkspace(workspaceId);
        workspacePriorityMapper.deleteAllByWorkspace(workspaceId);
        boardColumnMapper.deleteAllByWorkspace(workspaceId);
        transitionMapper.deleteAllByWorkspace(workspaceId);
        projectMemberMapper.deleteAllByWorkspace(workspaceId);
        CacheSync.evictAfterCommitOrNow(() -> metaCache.evict(workspaceId));
    }

    /** 删除账号时清理跨空间仍残留的用户级数据 */
    @Transactional
    public void deleteUserArtifacts(String userId) {
        savedViewMapper.deleteAllByUser(userId);
        appNotificationMapper.deleteAllByUser(userId);
        userListPreferenceMapper.deleteAllByUser(userId);
    }

    /* ==================== 成员 ==================== */

    public List<WorkspaceMember> members(String userId, String workspaceId) {
        requireMember(userId, workspaceId);
        return memberMapper.selectByWorkspace(workspaceId);
    }

    @Transactional
    public void addMember(String operatorId, String workspaceId, String username) {
        Workspace ws = requireOwner(operatorId, workspaceId);
        if ("personal".equals(ws.getType())) {
            throw AppException.badRequest("个人空间仅自己可见，不能添加成员");
        }
        String un = Texts.trimToNull(username);
        if (un == null) {
            throw AppException.badRequest("请填写用户登录名");
        }
        AppUser u = userMapper.selectByUsername(un);
        if (u == null) {
            throw AppException.notFound("用户不存在（账号需先由管理员创建）：" + un);
        }
        if (memberMapper.selectMember(workspaceId, u.getId()) != null) {
            throw AppException.badRequest("该用户已在空间中");
        }
        addMemberInternal(workspaceId, u.getId(), "member");
        CacheSync.evictAfterCommitOrNow(() -> memberCache.evict(workspaceId, u.getId()));
    }

    /** 添加成员时的候选搜索：排除已在空间内的账号，关键词为空则取前 20 个 */
    public List<MemberCandidate> searchMemberCandidates(String operatorId, String workspaceId, String keyword) {
        Workspace ws = requireOwner(operatorId, workspaceId);
        if ("personal".equals(ws.getType())) {
            return Collections.emptyList();
        }
        return userMapper.searchCandidates(workspaceId, Texts.trimToNull(keyword), 20);
    }

    /** 通过邀请链接加入共享空间（不校验操作者，由 InviteService 校验邀请有效性后调用） */
    @Transactional
    public void joinByInvite(String workspaceId, String userId) {
        Workspace ws = workspaceMapper.selectById(workspaceId);
        if (ws == null || !"shared".equals(ws.getType())) {
            throw AppException.badRequest("邀请对应的空间不存在或已删除");
        }
        if (memberMapper.selectMember(workspaceId, userId) != null) {
            return;
        }
        addMemberInternal(workspaceId, userId, "member");
        /* 退出后再次通过邀请加入：清掉可能残留的旧视图，加入后立即可用 */
        CacheSync.evictAfterCommitOrNow(() -> memberCache.evict(workspaceId, userId));
    }

    /** 调整成员的空间角色（空间主可调整全部；管理员只能调整成员/查看者，不能授予管理员） */
    @Transactional
    public void updateMemberRole(String operatorId, String workspaceId, String targetUserId, String role) {
        Workspace ws = requireManager(operatorId, workspaceId);
        if ("personal".equals(ws.getType())) {
            throw AppException.badRequest("个人空间没有角色可调整");
        }
        if (!ProjectAccessService.isValidRole(role)) {
            throw AppException.badRequest("角色只能是 admin / member / viewer");
        }
        WorkspaceMember target = memberMapper.selectMember(workspaceId, targetUserId);
        if (target == null) {
            throw AppException.notFound("成员不存在：" + targetUserId);
        }
        if ("owner".equals(target.getRole())) {
            throw AppException.badRequest("不能修改空间主的角色");
        }
        if (!"owner".equals(ws.getMyRole())) {
            if ("admin".equals(target.getRole())) {
                throw new AppException(403, "仅空间主可调整管理员角色");
            }
            if ("admin".equals(role)) {
                throw new AppException(403, "仅空间主可授予管理员角色");
            }
        }
        memberMapper.updateRole(workspaceId, targetUserId, role);
        /* 角色一变，旧的按项目配置就失去语义：管理员/查看者不看它，退回成员时也不该继承
           （否则界面上看不到、行为上却仍在生效）。统一回到「默认全部可见可写」。 */
        boolean grantsReset = !role.equals(target.getRole());
        if (grantsReset) {
            projectMemberMapper.deleteByUser(workspaceId, targetUserId);
        }
        AppUser u = userMapper.selectById(targetUserId);
        activityService.logConfig(workspaceId, operatorId, "调整成员角色「"
                + (u == null || u.getDisplayName() == null ? targetUserId : u.getDisplayName()) + "」→ " + role
                + (grantsReset ? "（项目可见范围已重置）" : ""));
        CacheSync.evictAfterCommitOrNow(() -> memberCache.evict(workspaceId, targetUserId));
    }

    @Transactional
    public void removeMember(String userId, String workspaceId, String targetUserId) {
        Workspace ws = requireMember(userId, workspaceId);
        boolean isPersonal = "personal".equals(ws.getType());
        if (userId.equals(targetUserId)) {
            if (isPersonal) {
                throw AppException.badRequest("个人空间不可退出");
            }
            if (userId.equals(ws.getOwnerId())) {
                throw AppException.badRequest("空间主不能退出自己的空间，可直接删除空间");
            }
            memberMapper.delete(workspaceId, targetUserId);
            projectMemberMapper.deleteByUser(workspaceId, targetUserId);
            /* 关注关系只在本空间有效，退出后清理，重新加入需重新关注 */
            taskWatchMapper.deleteByWorkspaceUser(workspaceId, targetUserId);
            activityService.logConfig(workspaceId, userId, "退出空间");
            CacheSync.evictAfterCommitOrNow(() -> memberCache.evict(workspaceId, targetUserId));
            return;
        }
        // 移除他人：空间主可移除全部；管理员只能移除成员/查看者
        if (!ProjectAccessService.isPrivileged(ws.getMyRole())) {
            throw new AppException(403, "仅空间主或管理员可移除成员");
        }
        if (targetUserId.equals(ws.getOwnerId())) {
            throw AppException.badRequest("不能移除空间主");
        }
        WorkspaceMember targetMember = memberMapper.selectMember(workspaceId, targetUserId);
        if (targetMember == null) {
            throw AppException.notFound("成员不存在：" + targetUserId);
        }
        if (!"owner".equals(ws.getMyRole()) && "admin".equals(targetMember.getRole())) {
            throw new AppException(403, "仅空间主可移除管理员");
        }
        memberMapper.delete(workspaceId, targetUserId);
        projectMemberMapper.deleteByUser(workspaceId, targetUserId);
        /* 关注关系只在本空间有效，移除后清理，重新加入需重新关注 */
        taskWatchMapper.deleteByWorkspaceUser(workspaceId, targetUserId);
        AppUser target = userMapper.selectById(targetUserId);
        activityService.logConfig(workspaceId, userId, "移除成员「"
                + (target == null || target.getDisplayName() == null ? targetUserId : target.getDisplayName()) + "」");
        CacheSync.evictAfterCommitOrNow(() -> memberCache.evict(workspaceId, targetUserId));
    }

    /* ==================== 初始化与种子 ==================== */

    /**
     * 自身代理（第九轮审查 #7）。
     * ensureDefaults() 需要"每个空间各自一个事务"：某个空间补齐失败不应牵连其它空间，
     * 但同类内部直接调用 ensureDefaultsFor() 不会经过 Spring 代理，其 @Transactional 不生效
     * （每个 mapper 调用各自自动提交）。这里注入自身代理（@Lazy 打破构造期循环依赖），
     * 由代理调用以保证事务语义。
     */
    @Autowired
    @Lazy
    private WorkspaceService self;

    /** 启动时兜底 + 导入后调用：为缺列/缺模块的空间补齐（含历史异常状态下创建的空间） */
    @EventListener(ApplicationReadyEvent.class)
    public void ensureDefaults() {
        try {
            for (Workspace ws : workspaceMapper.selectAll()) {
                self.ensureDefaultsFor(ws.getId());
            }
        } catch (Exception e) {
            log.warn("空间默认配置补齐失败", e);
        }
    }

    /** 确保空间至少有内置看板列（幂等）；模块挂在项目下，由项目创建时预置，空间级不再补齐 */
    @Transactional
    public void ensureDefaultsFor(String workspaceId) {
        if (boardColumnMapper.selectAll(workspaceId).isEmpty()) {
            seedColumns(workspaceId);
        }
        CacheSync.evictAfterCommitOrNow(() -> metaCache.evict(workspaceId));
    }

    private void addMemberInternal(String workspaceId, String userId, String role) {
        WorkspaceMember m = new WorkspaceMember();
        m.setWorkspaceId(workspaceId);
        m.setUserId(userId);
        m.setRole(role);
        memberMapper.insert(m);
    }

    private void seedColumns(String workspaceId) {
        /* 列从零重建时旧规则已失去意义（可能引用自定义列 id） */
        transitionMapper.deleteAllByWorkspace(workspaceId);
        BoardColumn backlog = new BoardColumn();
        backlog.setId(Consts.COL_BACKLOG);
        backlog.setWorkspaceId(workspaceId);
        backlog.setName("待处理");
        backlog.setColor("#c08a3e");
        backlog.setProcessingRule("normal");
        backlog.setSortOrder(0);
        boardColumnMapper.insert(backlog);

        BoardColumn doing = new BoardColumn();
        doing.setId(Consts.COL_DOING);
        doing.setWorkspaceId(workspaceId);
        doing.setName("进行中");
        doing.setColor("#5b83ad");
        doing.setProcessingRule("normal");
        doing.setSortOrder(1);
        boardColumnMapper.insert(doing);

        /* 测试流程：待测试是排队等待（不计时），测试中才实际执行（计时） */
        BoardColumn test = new BoardColumn();
        test.setId(Consts.COL_TEST);
        test.setWorkspaceId(workspaceId);
        test.setName("待测试");
        test.setColor("#8b6fb5");
        test.setProcessingRule("waiting");
        test.setSortOrder(2);
        boardColumnMapper.insert(test);

        BoardColumn testing = new BoardColumn();
        testing.setId(Consts.COL_TESTING);
        testing.setWorkspaceId(workspaceId);
        testing.setName("测试中");
        testing.setColor("#b06f9a");
        testing.setProcessingRule("normal");
        testing.setSortOrder(3);
        boardColumnMapper.insert(testing);
    }

}
