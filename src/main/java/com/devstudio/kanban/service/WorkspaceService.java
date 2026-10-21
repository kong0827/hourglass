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
import com.devstudio.kanban.mapper.AppNotificationMapper;
import com.devstudio.kanban.mapper.BoardColumnMapper;
import com.devstudio.kanban.mapper.CategoryMapper;
import com.devstudio.kanban.mapper.InviteMapper;
import com.devstudio.kanban.mapper.RequirementMapper;
import com.devstudio.kanban.mapper.SavedViewMapper;
import com.devstudio.kanban.mapper.SubtaskMapper;
import com.devstudio.kanban.mapper.TagMapper;
import com.devstudio.kanban.mapper.TaskCommentMapper;
import com.devstudio.kanban.mapper.TaskLogMapper;
import com.devstudio.kanban.mapper.TaskMapper;
import com.devstudio.kanban.mapper.TimeLogMapper;
import com.devstudio.kanban.mapper.UserMapper;
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
    private final TaskMapper taskMapper;
    private final RequirementMapper reqMapper;
    private final SubtaskMapper subtaskMapper;
    private final TaskLogMapper logMapper;
    private final TagMapper tagMapper;
    private final SavedViewMapper savedViewMapper;
    private final TimeLogMapper timeLogMapper;
    private final AttachmentService attachmentService;
    private final InviteMapper inviteMapper;
    private final TaskCommentMapper commentMapper;
    private final AppNotificationMapper appNotificationMapper;

    public WorkspaceService(WorkspaceMapper workspaceMapper, WorkspaceMemberMapper memberMapper,
                            UserMapper userMapper, BoardColumnMapper boardColumnMapper,
                            CategoryMapper categoryMapper, TaskMapper taskMapper,
                            RequirementMapper reqMapper, SubtaskMapper subtaskMapper,
                            TaskLogMapper logMapper, TagMapper tagMapper,
                            SavedViewMapper savedViewMapper, TimeLogMapper timeLogMapper,
                            AttachmentService attachmentService, InviteMapper inviteMapper,
                            TaskCommentMapper commentMapper,
                            AppNotificationMapper appNotificationMapper) {
        this.workspaceMapper = workspaceMapper;
        this.memberMapper = memberMapper;
        this.userMapper = userMapper;
        this.boardColumnMapper = boardColumnMapper;
        this.categoryMapper = categoryMapper;
        this.taskMapper = taskMapper;
        this.reqMapper = reqMapper;
        this.subtaskMapper = subtaskMapper;
        this.logMapper = logMapper;
        this.tagMapper = tagMapper;
        this.savedViewMapper = savedViewMapper;
        this.timeLogMapper = timeLogMapper;
        this.attachmentService = attachmentService;
        this.inviteMapper = inviteMapper;
        this.commentMapper = commentMapper;
        this.appNotificationMapper = appNotificationMapper;
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
            Workspace ws = workspaceMapper.selectById(last);
            WorkspaceMember m = ws == null ? null : memberMapper.selectMember(last, userId);
            if (ws != null && m != null) {
                ws.setMyRole(m.getRole());
                return maskWebhook(ws);
            }
        }
        return requireMember(userId, personalId(userId));
    }

    public Workspace requireMember(String userId, String workspaceId) {
        Workspace ws = workspaceMapper.selectById(workspaceId);
        if (ws == null) {
            throw AppException.notFound("空间不存在：" + workspaceId);
        }
        WorkspaceMember m = memberMapper.selectMember(workspaceId, userId);
        if (m == null) {
            throw AppException.notFound("空间不存在：" + workspaceId);
        }
        ws.setMyRole(m.getRole());
        return maskWebhook(ws);
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
        Workspace ws = requireOwner(userId, workspaceId);
        if (!"personal".equals(ws.getType())) {
            ws.setName(Texts.cut(req.getName().trim(), 20));
        }
        String hook = Texts.trimToNull(req.getNotifyWebhook());
        String channel = Texts.trimToNull(req.getNotifyChannel());
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
        ws.setNotifyEnabled(req.getNotifyEnabled());
        ws.setNotifyToken(Texts.trimToNull(req.getNotifyToken()));
        workspaceMapper.update(ws);
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
        for (AppUser u : userMapper.selectAll()) {
            if (workspaceId.equals(u.getLastWorkspaceId())) {
                userMapper.updateLastWorkspace(u.getId(), personalId(u.getId()));
            }
        }
    }

    /** 清空一个空间的全部数据（任务/需求/子任务/日志/标签/附件/工时/视图/分类/列/评论/通知） */
    @Transactional
    public void wipeData(String workspaceId) {
        logMapper.deleteAllByWorkspace(workspaceId);
        taskMapper.deleteAllByWorkspace(workspaceId);
        reqMapper.deleteAllByWorkspace(workspaceId);
        subtaskMapper.deleteAllByWorkspace(workspaceId);
        tagMapper.deleteAllTaskTagsByWorkspace(workspaceId);
        tagMapper.deleteTagsByWorkspace(workspaceId);
        timeLogMapper.deleteAllByWorkspace(workspaceId);
        attachmentService.deleteAllWithFiles(workspaceId);
        savedViewMapper.deleteAllByWorkspace(workspaceId);
        categoryMapper.deleteAllByWorkspace(workspaceId);
        boardColumnMapper.deleteAllByWorkspace(workspaceId);
        /* 第九轮审查 #1/#2：评论与应用内通知也是空间数据，清空时必须一起走，
           否则任务 ID 被复用时旧评论/旧通知会挂到新任务上。 */
        commentMapper.deleteAllByWorkspace(workspaceId);
        appNotificationMapper.deleteAllByWorkspace(workspaceId);
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
            return;
        }
        // 移除他人：仅空间主（个人空间允许清理历史遗留的非法成员）
        if (!"owner".equals(ws.getMyRole())) {
            throw new AppException(403, "仅空间主可移除成员");
        }
        if (targetUserId.equals(ws.getOwnerId())) {
            throw AppException.badRequest("不能移除空间主");
        }
        memberMapper.delete(workspaceId, targetUserId);
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
