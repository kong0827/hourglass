package com.devstudio.kanban.service;

import com.devstudio.kanban.common.AppException;
import com.devstudio.kanban.common.Consts;
import com.devstudio.kanban.common.Ids;
import com.devstudio.kanban.common.Texts;
import com.devstudio.kanban.common.Webhooks;
import com.devstudio.kanban.dto.WorkspaceUpdateRequest;
import com.devstudio.kanban.entity.AppUser;
import com.devstudio.kanban.entity.BoardColumn;
import com.devstudio.kanban.entity.Category;
import com.devstudio.kanban.entity.Workspace;
import com.devstudio.kanban.entity.WorkspaceMember;
import com.devstudio.kanban.mapper.BoardColumnMapper;
import com.devstudio.kanban.mapper.CategoryMapper;
import com.devstudio.kanban.mapper.InviteMapper;
import com.devstudio.kanban.mapper.SavedViewMapper;
import com.devstudio.kanban.mapper.UserMapper;
import com.devstudio.kanban.mapper.RequirementMapper;
import com.devstudio.kanban.mapper.WorkspaceMapper;
import com.devstudio.kanban.mapper.WorkspaceMemberMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.annotation.Lazy;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

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
    private final CategoryMapper categoryMapper;
    private final SavedViewMapper savedViewMapper;
    private final InviteMapper inviteMapper;
    /** 任务/项目/文档/分支/依赖/附件等清空清单统一收口在 TaskCascade */
    private final TaskCascade cascade;
    /** 配置审计日志 */
    private final com.devstudio.kanban.service.ActivityService activityService;
    /** 成员关系缓存（单实例进程内，TTL 60 秒，写入口主动失效） */
    private final WorkspaceMemberCache memberCache;
    /** 空间 meta 缓存（列/分类/标签，按空间版本号失效） */
    private final WorkspaceMetaCache metaCache;

    /** 成员移除前检查项目负责人（字段注入避免破坏既有构造器测试） */
    @Autowired(required = false)
    private RequirementMapper requirementMapper;

    public WorkspaceService(WorkspaceMapper workspaceMapper, WorkspaceMemberMapper memberMapper,
                            UserMapper userMapper, BoardColumnMapper boardColumnMapper,
                            CategoryMapper categoryMapper,
                            SavedViewMapper savedViewMapper,
                            InviteMapper inviteMapper,
                            TaskCascade cascade,
                            com.devstudio.kanban.service.ActivityService activityService,
                            WorkspaceMemberCache memberCache,
                            WorkspaceMetaCache metaCache) {
        this.workspaceMapper = workspaceMapper;
        this.memberMapper = memberMapper;
        this.userMapper = userMapper;
        this.boardColumnMapper = boardColumnMapper;
        this.categoryMapper = categoryMapper;
        this.savedViewMapper = savedViewMapper;
        this.inviteMapper = inviteMapper;
        this.cascade = cascade;
        this.activityService = activityService;
        this.memberCache = memberCache;
        this.metaCache = metaCache;
    }

    /* ==================== 解析与校验 ==================== */

    public static String personalId(String userId) {
        return PERSONAL_PREFIX + userId;
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
        }
        return list;
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
        seedDefaultCategories(ws.getId());
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
        seedColumns(wsId);
        seedDefaultCategories(wsId);
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
        inviteMapper.deleteAllByWorkspace(workspaceId);
        workspaceMapper.deleteById(workspaceId);
        userMapper.resetLastWorkspaceForAll(workspaceId, PERSONAL_PREFIX);
        CacheSync.evictAfterCommitOrNow(() -> {
            memberCache.evictWorkspace(workspaceId);
            metaCache.evict(workspaceId);
        });
    }

    /** 清空一个空间的全部数据（任务/项目/需求文档/子任务/日志/标签/附件/工时/视图/分类/列/评论/通知/分支） */
    @Transactional
    public void wipeData(String workspaceId) {
        cascade.wipeWorkspaceData(workspaceId);
        /* 看板列/分类/保存视图属于空间配置，不属于任务级联，清空空间时单独处理 */
        savedViewMapper.deleteAllByWorkspace(workspaceId);
        categoryMapper.deleteAllByWorkspace(workspaceId);
        boardColumnMapper.deleteAllByWorkspace(workspaceId);
        CacheSync.evictAfterCommitOrNow(() -> metaCache.evict(workspaceId));
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
            assertNotProjectManager(workspaceId, targetUserId, ws);
            memberMapper.delete(workspaceId, targetUserId);
            activityService.logConfig(workspaceId, userId, "退出空间");
            CacheSync.evictAfterCommitOrNow(() -> memberCache.evict(workspaceId, targetUserId));
            return;
        }
        // 移除他人：仅空间主（个人空间允许清理历史遗留的非法成员）
        if (!"owner".equals(ws.getMyRole())) {
            throw new AppException(403, "仅空间主可移除成员");
        }
        if (targetUserId.equals(ws.getOwnerId())) {
            throw AppException.badRequest("不能移除空间主");
        }
        assertNotProjectManager(workspaceId, targetUserId, ws);
        memberMapper.delete(workspaceId, targetUserId);
        AppUser target = userMapper.selectById(targetUserId);
        String targetName = target == null ? null : Texts.trimToNull(target.getDisplayName());
        if (targetName == null && target != null) {
            targetName = Texts.trimToNull(target.getUsername());
        }
        activityService.logConfig(workspaceId, userId, "移除成员「"
                + (targetName == null ? "该成员" : targetName) + "」");
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

    /** 启动时兜底 + 导入后调用：为缺列/缺分类的空间补齐（含历史异常状态下创建的空间） */
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

    /** 确保空间至少有内置看板列与一个分类（幂等） */
    @Transactional
    public void ensureDefaultsFor(String workspaceId) {
        if (boardColumnMapper.selectAll(workspaceId).isEmpty()) {
            seedColumns(workspaceId);
        }
        if (categoryMapper.countByWorkspace(workspaceId) == 0) {
            seedDefaultCategories(workspaceId);
        }
        CacheSync.evictAfterCommitOrNow(() -> metaCache.evict(workspaceId));
    }

    private void assertNotProjectManager(String workspaceId, String userId, Workspace ws) {
        if (requirementMapper == null || userId.equals(ws.getOwnerId())) {
            return;
        }
        if (requirementMapper.countByManager(workspaceId, userId) > 0) {
            throw new AppException(409, "该成员仍是项目负责人，请先转交项目后再移出");
        }
    }

    private void addMemberInternal(String workspaceId, String userId, String role) {
        WorkspaceMember m = new WorkspaceMember();
        m.setWorkspaceId(workspaceId);
        m.setUserId(userId);
        m.setRole(role);
        memberMapper.insert(m);
    }

    private void seedColumns(String workspaceId) {
        BoardColumn backlog = new BoardColumn();
        backlog.setId(Consts.COL_BACKLOG);
        backlog.setWorkspaceId(workspaceId);
        backlog.setName("待处理");
        backlog.setColor("#c08a3e");
        backlog.setSortOrder(0);
        boardColumnMapper.insert(backlog);

        BoardColumn doing = new BoardColumn();
        doing.setId(Consts.COL_DOING);
        doing.setWorkspaceId(workspaceId);
        doing.setName("进行中");
        doing.setColor("#5b83ad");
        doing.setSortOrder(1);
        boardColumnMapper.insert(doing);
    }

    /** 通用默认分类（非开发场景也适用） */
    private void seedDefaultCategories(String workspaceId) {
        String[][] defaults = {
                {"工作", "#5b83ad"},
                {"学习", "#5f7a4a"},
                {"生活", "#7a5c86"},
                {"其他", "#8a8578"}
        };
        for (int i = 0; i < defaults.length; i++) {
            Category c = new Category();
            c.setId(Ids.gen("G"));
            c.setWorkspaceId(workspaceId);
            c.setName(defaults[i][0]);
            c.setColor(defaults[i][1]);
            c.setSortOrder(i);
            categoryMapper.insert(c);
        }
    }
}
