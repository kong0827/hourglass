package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.common.Ids;
import com.hourglass.common.Texts;
import com.hourglass.dto.ReqDocReorderRequest;
import com.hourglass.dto.ReqDocSaveRequest;
import com.hourglass.dto.ReqDocShareResponse;
import com.hourglass.dto.ReqDocActivityView;
import com.hourglass.dto.ReqDocView;
import com.hourglass.entity.AppUser;
import com.hourglass.entity.Demand;
import com.hourglass.entity.DocumentType;
import com.hourglass.entity.ReqDocShare;
import com.hourglass.entity.Requirement;
import com.hourglass.entity.RequirementDoc;
import com.hourglass.entity.RequirementDocHistory;
import com.hourglass.entity.Task;
import com.hourglass.entity.WorkActivity;
import com.hourglass.entity.Workspace;
import com.hourglass.mapper.DemandMapper;
import com.hourglass.mapper.ReqDocShareMapper;
import com.hourglass.mapper.RequirementDocCommentMapper;
import com.hourglass.mapper.RequirementDocHistoryMapper;
import com.hourglass.mapper.RequirementDocMapper;
import com.hourglass.mapper.RequirementMapper;
import com.hourglass.mapper.TaskMapper;
import com.hourglass.mapper.UserMapper;
import com.hourglass.mapper.WorkspaceMapper;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.safety.Safelist;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * 需求（项目下的需求文档）。
 *
 * <p><b>正文安全</b>：前端是所见即所得编辑器，提交的是 HTML。任何客户端都可能是恶意的，
 * 所以**入库前在服务端做白名单清洗**（jsoup）—— 只留排版标签，去掉脚本、事件属性与危险样式。
 * 表格（SunEditor 原生表格）、图片（粘贴截图的内联 data URL）会保留，但属性逐个白名单。
 * 渲染时前端仍会再清洗一次（双保险，见 app.js 的 sanitizeHTML）。
 */
@Service
public class RequirementDocService {

    /** 正文上限：粘贴截图会以 base64 内联，200KB 会把图片截断，放宽到 12MB（列是 MEDIUMTEXT，上限 16MB） */
    private static final int CONTENT_MAX = 12_000_000;

    /** 每篇文档保留的历史快照版数上限 */
    private static final int HISTORY_KEEP = 20;

    /** 文档可见范围（照用例分组三档），仅对已发布文档生效 */
    public static final String VIS_TEAM = "team";
    public static final String VIS_MEMBERS = "members";
    public static final String VIS_PERSONAL = "personal";
    /** 指定成员上限：超出说明该用团队共享 */
    private static final int MAX_VIS_MEMBERS = 50;

    /** 摘要长度 */
    private static final int EXCERPT_MAX = 80;

    /**
     * 允许的标签与属性：
     * 段落/标题/列表/引用/代码/链接/分割线 + 表格 + 少量行内格式。
     * 刻意**不允许** script / iframe / 事件属性 / 危险样式 —— 这些带来 XSS 风险。
     * 表格结构放行（SunEditor 原生表格），单元格合并用 colspan / rowspan。
     */
    private static final Safelist SAFELIST = Safelist.relaxed()
            .addTags("h1", "h2", "h3", "h4", "hr", "s", "del", "ins")
            /* 表格：放行结构 + 单元格合并；style 已由 :all 放行，具体属性由 filterStyles 逐个过滤 */
            .addAttributes("td", "colspan", "rowspan")
            .addAttributes("th", "colspan", "rowspan", "scope")
            /* 图片：允许 http(s) 外链与 data URL（粘贴的截图就是 data URL），具体白名单见 filterImages */
            .addAttributes("img", "src", "alt")
            .addProtocols("img", "src", "http", "https", "data")
            /* class 表达对齐/缩进，style 表达颜色，两者都无害、由下面逐个属性过滤 */
            .addAttributes(":all", "class", "style")
            /* Quill 时代的列表用 <li data-list="bullet|ordered">，SunEditor 用标准 ul/ol；
               保留此放行以兼容旧数据 */
            .addAttributes("li", "data-list")
            .addAttributes("a", "href", "title", "target", "rel")
            .addProtocols("a", "href", "http", "https", "mailto");

    /** style 只允许这三个属性（Quill 的颜色 / 背景 / 对齐） */
    private static final java.util.Set<String> STYLE_ALLOW = new java.util.HashSet<String>(
            java.util.Arrays.asList("color", "background-color", "text-align"));

    /** 属性值只允许颜色与对齐这类字面量，挡掉 url(...) / expression(...) */
    private static final java.util.regex.Pattern STYLE_VALUE =
            java.util.regex.Pattern.compile("^[#a-zA-Z0-9(),.%\\s-]{1,60}$");

    private final RequirementDocMapper docMapper;
    private final RequirementDocHistoryMapper historyMapper;
    private final RequirementDocCommentMapper commentMapper;
    private final RequirementMapper reqMapper;
    private final UserMapper userMapper;
    private final TaskMapper taskMapper;
    private final WorkActivityService workActivityService;
    private final DemandMapper demandMapper;
    private final ProjectAccessService projectAccess;
    private final NotificationEventService notificationEvents;
    private final ReqDocShareMapper shareMapper;
    private final WorkspaceMapper workspaceMapper;
    private final DocPreviewService docPreviewService;
    /** 删除不可逆：文档活动、评论与历史会一起清掉，必须在删除前写独立墓碑 */
    private final DeletionTraceService deletionTrace;
    @org.springframework.beans.factory.annotation.Autowired
    private TaskQueryService taskQueries;
    @org.springframework.beans.factory.annotation.Autowired
    private AttachmentService attachmentService;
    /** 分类校验：仅在文档显式带 categoryId 时 consulted，单测手动构造时为 null 不影响无分类路径 */
    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private DocCategoryService docCategories;

    public RequirementDocService(RequirementDocMapper docMapper, RequirementDocHistoryMapper historyMapper,
                                 RequirementDocCommentMapper commentMapper,
                                 RequirementMapper reqMapper, UserMapper userMapper,
                                 TaskMapper taskMapper, WorkActivityService workActivityService,
                                 DemandMapper demandMapper, ProjectAccessService projectAccess,
                                 NotificationEventService notificationEvents,
                                 ReqDocShareMapper shareMapper, WorkspaceMapper workspaceMapper,
                                 DocPreviewService docPreviewService, DeletionTraceService deletionTrace) {
        this.docMapper = docMapper;
        this.historyMapper = historyMapper;
        this.commentMapper = commentMapper;
        this.reqMapper = reqMapper;
        this.userMapper = userMapper;
        this.taskMapper = taskMapper;
        this.workActivityService = workActivityService;
        this.demandMapper = demandMapper;
        this.projectAccess = projectAccess;
        this.notificationEvents = notificationEvents;
        this.shareMapper = shareMapper;
        this.workspaceMapper = workspaceMapper;
        this.docPreviewService = docPreviewService;
        this.deletionTrace = deletionTrace;
    }

    public List<ReqDocView> list(String workspaceId, String userId) {
        return list(workspaceId, userId, null);
    }

    public List<ReqDocView> list(String workspaceId, String userId, String keyword) {
        List<ReqDocView> out = new java.util.ArrayList<ReqDocView>();
        int offset = 0;
        while (true) {
            com.hourglass.dto.PageResult<ReqDocView> page = page(workspaceId, userId, keyword, offset, 100);
            out.addAll(page.getItems());
            if (!page.isHasMore() || page.getItems().isEmpty()) {
                return out;
            }
            offset += page.getItems().size();
        }
    }

    public com.hourglass.dto.PageResult<ReqDocView> page(String workspaceId, String userId, String keyword,
                                                          int offset, int limit) {
        return page(workspaceId, userId, null, null, false, keyword, offset, limit);
    }

    public com.hourglass.dto.PageResult<ReqDocView> page(String workspaceId, String userId, String reqId,
                                                          String keyword, int offset, int limit) {
        return page(workspaceId, userId, reqId, null, false, keyword, offset, limit);
    }

    /** categoryId 非空按分类过滤；spaceOnly=true 只取空间级文档（req_id IS NULL）。两者与 reqId 互斥使用。 */
    public com.hourglass.dto.PageResult<ReqDocView> page(String workspaceId, String userId, String reqId,
                                                          String categoryId, boolean spaceOnly,
                                                          String keyword, int offset, int limit) {
        int safeOffset = Math.max(0, offset);
        int safeLimit = Math.max(1, Math.min(100, limit));
        String pattern = likePattern(Texts.trimToNull(keyword));
        String viewerId = projectAccess.viewerScope(workspaceId, userId);
        String role = projectAccess.roleOf(workspaceId, userId);
        boolean seeAllDrafts = ProjectAccessService.isPrivileged(role);
        int total = docMapper.countVisible(workspaceId, reqId, categoryId, spaceOnly, pattern, viewerId, userId, seeAllDrafts);
        List<ReqDocView> rows = total <= safeOffset ? new java.util.ArrayList<ReqDocView>()
                : docMapper.selectViewByWorkspace(workspaceId, reqId, categoryId, spaceOnly, pattern, viewerId, userId,
                        seeAllDrafts, safeOffset, safeLimit);
        for (ReqDocView v : rows) {
            v.setExcerpt(excerptOf(v.getContentBrief()));
            v.setContentBrief(null);
        }
        return com.hourglass.dto.PageResult.of(rows, total, safeOffset, safeLimit);
    }

    /**
     * 草稿可见性：已发布（publishedAt 非空）按项目可见范围走；草稿仅作者与空间 owner/admin 可见。
     * 静态工具供评论服务复用，保持同一口径。
     */
    public static boolean canSeeDraft(String ownerUserId, java.time.LocalDateTime publishedAt,
                                      String userId, String role) {
        if (publishedAt != null) {
            return true;
        }
        if (userId != null && userId.equals(ownerUserId)) {
            return true;
        }
        return ProjectAccessService.isPrivileged(role);
    }

    /**
     * 已发布文档的可见范围：负责人始终可见；团队共享对项目内成员开放；
     * 指定成员/仅自己按名单与负责人判定。空间管理员不在名单时同样不可见（与用例分组口径一致）。
     */
    public static boolean canSeePublished(String visibility, String ownerUserId, String userId, boolean member) {
        if (userId != null && userId.equals(ownerUserId)) {
            return true;
        }
        if (visibility == null || VIS_TEAM.equals(visibility)) {
            return true;
        }
        /* 名单只对 members 档生效；personal 即使残留成员行也不放宽 */
        return VIS_MEMBERS.equals(visibility) && member;
    }

    /**
     * 文档统一可见判定：草稿仍按作者 + 空间 owner/admin；已发布再叠加文档级可见范围。
     * member 由调用方按需查询（仅 members 档需要）。
     */
    public static boolean canSeeDoc(String visibility, String ownerUserId, java.time.LocalDateTime publishedAt,
                                    String userId, String role, boolean member) {
        if (publishedAt == null) {
            return canSeeDraft(ownerUserId, null, userId, role);
        }
        return canSeePublished(visibility, ownerUserId, userId, member);
    }

    public RequirementDoc get(String workspaceId, String id) {
        RequirementDoc d = docMapper.selectById(id);
        if (d == null || !workspaceId.equals(d.getWorkspaceId())) {
            throw AppException.notFound("文档不存在：" + id);
        }
        return d;
    }

    /** 读取前校验项目可见范围与文档可见范围（不可见一律按不存在处理） */
    public RequirementDoc getVisible(String workspaceId, String userId, String id) {
        RequirementDoc d = get(workspaceId, id);
        projectAccess.assertView(workspaceId, userId, d.getReqId());
        if (!canSeeDoc(d.getVisibility(), d.getOwnerUserId(), d.getPublishedAt(), userId,
                projectAccess.roleOf(workspaceId, userId), isVisibilityMember(d, userId))) {
            throw AppException.notFound("文档不存在：" + id);
        }
        return withMembers(d);
    }

    /** 指定成员名单只在 members 档查询；其他档位不做多余查询 */
    private boolean isVisibilityMember(RequirementDoc d, String userId) {
        return userId != null && VIS_MEMBERS.equals(d.getVisibility())
                && docMapper.countVisibilityMember(d.getId(), userId) > 0;
    }

    /** 详情返回前带上名单，供前端权限面板回显；列表只给 memberCount，不带逐人名单 */
    private RequirementDoc withMembers(RequirementDoc d) {
        if (d != null && VIS_MEMBERS.equals(d.getVisibility())) {
            d.setMemberIds(docMapper.selectVisibilityMemberIds(d.getId()));
        }
        return d;
    }

    /**
     * 创建人保护（A 轻量档）：把草稿已有的「负责人 + 管理员」口径扩展到已发布文档的改删 / 发布撤回 / 恢复历史。
     * 先走项目/空间可写门控；再要求负责人本人或空间 owner/admin。
     * 空负责人（历史自由文本）回退项目可写，不锁死；userId=null 为系统级联（项目删除等），跳过。
     * 排序/新建子文档/分享链接不走此门控（组织/新增/分发，不改父文档内容或可见状态）。
     */
    private void assertDocMutate(String workspaceId, String userId, RequirementDoc d) {
        projectAccess.assertWrite(workspaceId, userId, d.getReqId());
        if (userId == null) {
            return;
        }
        String owner = Texts.trimToNull(d.getOwnerUserId());
        if (owner == null || owner.equals(userId) || projectAccess.canManage(workspaceId, userId)) {
            return;
        }
        throw new AppException(403, "仅文档负责人或空间管理员可编辑 / 删除");
    }

    public List<Task> tasks(String workspaceId, String id) {
        get(workspaceId, id);
        List<Task> tasks = taskMapper.selectByReqDoc(workspaceId, id);
        taskQueries.mergeTaskExtras(workspaceId, tasks);
        return tasks;
    }

    public com.hourglass.dto.PageResult<Task> taskPage(String workspaceId, String id, int offset, int limit) {
        get(workspaceId, id);
        int safeOffset = Math.max(0, offset);
        int safeLimit = Math.max(1, Math.min(100, limit));
        int total = taskMapper.countActiveByReqDoc(workspaceId, id);
        List<Task> items = total <= safeOffset ? new java.util.ArrayList<Task>()
                : taskMapper.selectByReqDocPage(workspaceId, id, safeOffset, safeLimit);
        taskQueries.mergeTaskExtras(workspaceId, items);
        return com.hourglass.dto.PageResult.of(items, total, safeOffset, safeLimit);
    }

    @Transactional
    public RequirementDoc create(String userId, String workspaceId, ReqDocSaveRequest req) {
        String reqId = ensureProject(workspaceId, req.getReqId());
        projectAccess.assertWrite(workspaceId, userId, reqId);
        RequirementDoc d = new RequirementDoc();
        d.setId(Ids.gen("D"));
        d.setWorkspaceId(workspaceId);
        List<String> memberIds = apply(d, reqId, req, userId);
        docMapper.insert(d);
        saveVisibilityMembers(workspaceId, d.getId(), memberIds);
        workActivityService.record(workspaceId, WorkActivityService.REQUIREMENT_DOC, d.getId(), userId,
                "create", "创建了文档「" + d.getTitle() + "」");
        return withMembers(docMapper.selectById(d.getId()));
    }

    @Transactional
    public RequirementDoc update(String userId, String workspaceId, String id, ReqDocSaveRequest req) {
        RequirementDoc d = getVisible(workspaceId, userId, id);
        assertDocMutate(workspaceId, userId, d);
        String oldVisibility = Texts.trimToNull(d.getVisibility());
        List<String> oldMemberIds = VIS_MEMBERS.equals(oldVisibility)
                ? docMapper.selectVisibilityMemberIds(id) : java.util.Collections.<String>emptyList();
        String requestedVisibility = Texts.trimToNull(req.getVisibility());
        if (requestedVisibility != null && VIS_TEAM.equals(oldVisibility)
                && !VIS_TEAM.equals(requestedVisibility)) {
            /* 团队共享收窄会让其他成员突然看不到：只允许文档负责人操作，避免管理员误锁他人 */
            String owner = Texts.trimToNull(d.getOwnerUserId());
            if (owner != null && !owner.equals(userId)) {
                throw AppException.badRequest("团队共享文档收窄可见范围需由文档负责人操作，避免其他成员突然看不到");
            }
        }
        /* 乐观锁：打开文档时的 updatedAt 原样带回，与库内当前版本不一致说明他人先保存过 */
        java.time.LocalDateTime oldUpdatedAt = parseUpdatedAt(req.getUpdatedAt());
        String oldReqId = d.getReqId();
        String oldParentId = d.getParentId();
        String oldTitle = d.getTitle();
        DocumentType oldDocType = DocumentType.parseOrOther(d.getDocType());
        String oldContent = d.getContent();
        String oldFormat = d.getFormat();
        String oldStatus = d.getStatus();
        String oldOwner = d.getOwner();
        String oldOwnerUserId = d.getOwnerUserId();
        String reqId = ensureProject(workspaceId, req.getReqId());
        projectAccess.assertWrite(workspaceId, userId, reqId);
        List<String> memberIds = apply(d, reqId, req, userId, oldVisibility, oldMemberIds);
        if (docMapper.update(d, oldUpdatedAt) == 0) {
            throw AppException.conflict("文档已被他人修改，请刷新查看最新内容后再保存");
        }
        saveVisibilityMembers(workspaceId, id, memberIds);
        String newVisibility = Texts.trimToNull(d.getVisibility());
        /* 存量文档 visibility 为空等同团队共享（与 SQL 默认值口径一致），不产生「team → team」噪音动态 */
        String oldVisNorm = oldVisibility == null ? VIS_TEAM : oldVisibility;
        if (!Objects.equals(oldVisNorm, newVisibility)) {
            if (!VIS_TEAM.equals(newVisibility)) {
                /* 可见范围收窄后旧公开链接必须立即失效，否则绕过名单继续对外暴露正文 */
                shareMapper.deleteByDoc(workspaceId, id);
            }
            workActivityService.record(workspaceId, WorkActivityService.REQUIREMENT_DOC, id, userId, "update",
                    "可见范围：" + visLabel(oldVisNorm) + " → " + visLabel(newVisibility));
        }
        recordChange(userId, workspaceId, id, "标题", oldTitle, d.getTitle());
        recordChange(userId, workspaceId, id, "分类", oldDocType.getLabel(),
                DocumentType.parseOrOther(d.getDocType()).getLabel());
        if (!java.util.Objects.equals(oldContent, d.getContent())) {
            /* 快照的是修改前正文：历史版本用来恢复旧内容，不能存成修改后的新版本 */
            if (Texts.trimToNull(oldContent) != null) {
                snapshot(userId, d, oldTitle, oldContent, oldFormat);
            }
            workActivityService.record(workspaceId, WorkActivityService.REQUIREMENT_DOC, id, userId,
                    "update", "更新了正文");
        }
        recordChange(userId, workspaceId, id, "状态", oldStatus, d.getStatus());
        if (!java.util.Objects.equals(oldOwner, d.getOwner())
                || !java.util.Objects.equals(oldOwnerUserId, d.getOwnerUserId())) {
            workActivityService.record(workspaceId, WorkActivityService.REQUIREMENT_DOC, id, userId, "update",
                    "负责人：" + display(oldOwner) + " → " + display(d.getOwner()));
        }
        if (!java.util.Objects.equals(oldReqId, reqId)) {
            workActivityService.record(workspaceId, WorkActivityService.REQUIREMENT_DOC, id, userId, "update",
                    "所属项目：" + projectDisplay(oldReqId) + " → " + projectDisplay(reqId));
        }
        /* 文档换归属范围（项目↔项目、项目↔空间级）后，仍挂在旧范围下的任务会指向别处的文档：解掉这些关联 */
        if (!java.util.Objects.equals(oldReqId, reqId)) {
            java.util.List<String> affectedTaskIds;
            if (reqId == null) {
                /* 转为空间级：不再属于任何项目，全部任务引用都解绑（clearTaskRefExceptReq 对 null 项目会漏掉项目内任务） */
                affectedTaskIds = taskMapper.selectIdsByReqDocForCascade(workspaceId, d.getId());
                docMapper.clearTaskRef(workspaceId, d.getId());
            } else {
                affectedTaskIds = taskMapper.selectIdsByReqDocExceptReqForCascade(workspaceId, d.getId(), reqId);
                docMapper.clearTaskRefExceptReq(workspaceId, d.getId(), reqId);
            }
            deletionTrace.logTaskCascade(workspaceId, userId, affectedTaskIds,
                    "需求文档「" + d.getTitle() + "」已更换归属范围，自动解除关联");
            /* 旧范围的需求关联同样失效（关联要求同项目），避免需求详情里看到别处的文档 */
            docMapper.deleteDemandLinksByDoc(workspaceId, d.getId());
            /* 子文档留在旧范围，提升到本文档原来的父级，避免跨范围形成断掉的子树 */
            docMapper.reparentChildren(workspaceId, d.getId(), oldParentId);
        }
        boolean changed = !Objects.equals(oldTitle, d.getTitle())
                || !Objects.equals(oldContent, d.getContent())
                || !Objects.equals(oldStatus, d.getStatus())
                || oldDocType != DocumentType.parseOrOther(d.getDocType())
                || !Objects.equals(oldReqId, d.getReqId())
                || !Objects.equals(oldVisNorm, newVisibility);
        if (changed) {
            notifyDocOwner(d, userId, "文档「" + d.getTitle() + "」已更新",
                    "文档内容或属性有更新");
        }
        return withMembers(docMapper.selectById(id));
    }

    /**
     * 单独调整可见范围（不改正文）：与编辑路径共用负责人门控、收窄保护与名单校验。
     * 团队共享收窄为指定成员/仅负责人只允许文档负责人操作，收窄后旧公开链接立即失效。
     */
    @Transactional
    public RequirementDoc changeVisibility(String userId, String workspaceId, String id, String visibility,
                                           java.util.List<String> memberIds) {
        RequirementDoc d = getVisible(workspaceId, userId, id);
        assertDocMutate(workspaceId, userId, d);
        String oldVisibility = Texts.trimToNull(d.getVisibility());
        String oldVisNorm = oldVisibility == null ? VIS_TEAM : oldVisibility;
        String newVisibility = visibility == null ? VIS_TEAM : visOf(visibility);
        if (VIS_TEAM.equals(oldVisNorm) && !VIS_TEAM.equals(newVisibility)) {
            String owner = Texts.trimToNull(d.getOwnerUserId());
            if (owner != null && !owner.equals(userId)) {
                throw AppException.badRequest("团队共享文档收窄可见范围需由文档负责人操作，避免其他成员突然看不到");
            }
        }
        java.util.List<String> members = memberIdsOf(workspaceId, d.getReqId(), newVisibility, memberIds);
        String ownerName = d.getOwner();
        String ownerUserId = d.getOwnerUserId();
        /* 非团队共享必须有真实负责人账号，否则文档会变成谁都打不开；历史自由文本负责人归到操作者 */
        if (!VIS_TEAM.equals(newVisibility) && Texts.trimToNull(ownerUserId) == null) {
            AppUser me = userMapper.selectById(userId);
            ownerName = me == null ? ownerName : Texts.cut(me.getDisplayName(), 32);
            ownerUserId = userId;
        }
        docMapper.updateVisibility(workspaceId, id, newVisibility, ownerName, ownerUserId);
        saveVisibilityMembers(workspaceId, id, members);
        if (!VIS_TEAM.equals(newVisibility)) {
            shareMapper.deleteByDoc(workspaceId, id);
        }
        if (!Objects.equals(oldVisNorm, newVisibility)) {
            workActivityService.record(workspaceId, WorkActivityService.REQUIREMENT_DOC, id, userId, "update",
                    "可见范围：" + visLabel(oldVisNorm) + " → " + visLabel(newVisibility));
        }
        return withMembers(docMapper.selectById(id));
    }

    /** 需求文档活动查询前复用详情可见性校验。 */
    public com.hourglass.dto.PageResult<WorkActivity> activities(String workspaceId, String userId, String id,
                                                                  int offset, int limit) {
        getVisible(workspaceId, userId, id);
        return workActivityService.listByEntity(workspaceId, WorkActivityService.REQUIREMENT_DOC, id,
                offset, limit);
    }

    /** 空间级文档动态流：项目与草稿可见性已在 SQL 中过滤，列表与总数同口径。 */
    public com.hourglass.dto.PageResult<ReqDocActivityView> feedActivities(String workspaceId, String userId,
                                                                            int offset, int limit) {
        String viewerId = projectAccess.viewerScope(workspaceId, userId);
        boolean seeAllDrafts = ProjectAccessService.isPrivileged(projectAccess.roleOf(workspaceId, userId));
        com.hourglass.dto.PageResult<ReqDocActivityView> page = workActivityService.docActivities(
                workspaceId, viewerId, userId, seeAllDrafts, offset, limit);
        for (ReqDocActivityView row : page.getItems()) {
            row.setOwnerUserId(null);
            row.setPublishedAt(null);
        }
        return page;
    }

    /**
     * 阅读/树拖拽排序：批量调整同一空间内若干文档的 sort_order 与 parent_id。
     * 校验每篇文档的写权限，并阻止跨项目拖拽（reqId 必须相同）。
     */
    @Transactional
    public void reorder(String userId, String workspaceId, ReqDocReorderRequest req) {
        if (req == null || req.getItems() == null || req.getItems().isEmpty()) {
            return;
        }
        // 先按 id 查出文档，校验可见性（他人草稿按不存在处理）、写权限与项目一致性
        java.util.Map<String, RequirementDoc> docs = new java.util.HashMap<String, RequirementDoc>();
        String commonReqId = null;
        for (ReqDocReorderRequest.Item item : req.getItems()) {
            RequirementDoc d = getVisible(workspaceId, userId, item.getId());
            projectAccess.assertWrite(workspaceId, userId, d.getReqId());
            if (commonReqId == null) {
                commonReqId = d.getReqId();
            } else if (!commonReqId.equals(d.getReqId())) {
                throw AppException.badRequest("只能对同一项目下的文档排序");
            }
            docs.put(d.getId(), d);
        }
        // 先按「本批调整后的最终父子关系」整体校验，再落库：逐条校验会用到尚未生效的旧父级，
        // 同一批里 A→B、B→A 这类互挂会被漏掉
        java.util.Map<String, String> finalParent = new java.util.HashMap<String, String>();
        for (ReqDocReorderRequest.Item item : req.getItems()) {
            String newParentId = item.getParentId();
            finalParent.put(item.getId(), newParentId == null || newParentId.isEmpty() ? null : newParentId);
        }
        for (ReqDocReorderRequest.Item item : req.getItems()) {
            String newParentId = finalParent.get(item.getId());
            // 父文档必须同项目；空表示根级
            if (newParentId != null) {
                RequirementDoc parent = docs.containsKey(newParentId) ? docs.get(newParentId) : docMapper.selectById(newParentId);
                if (parent == null || !workspaceId.equals(parent.getWorkspaceId())
                        || !canSeeDraft(parent.getOwnerUserId(), parent.getPublishedAt(), userId,
                                projectAccess.roleOf(workspaceId, userId))) {
                    throw AppException.badRequest("父文档不存在：" + newParentId);
                }
                if (!commonReqId.equals(parent.getReqId())) {
                    throw AppException.badRequest("父文档必须属于同一项目");
                }
                if (formsCycle(item.getId(), finalParent, docs)) {
                    throw AppException.badRequest("不能将文档放到自己的子文档下");
                }
            }
        }
        // 落库
        for (ReqDocReorderRequest.Item item : req.getItems()) {
            docMapper.updateSortOrder(workspaceId, item.getId(),
                    item.getSortOrder() == null ? 0 : item.getSortOrder(), finalParent.get(item.getId()));
        }
        // 记录一条活动：用第一个文档的标题代表这次排序操作
        RequirementDoc first = docs.get(req.getItems().get(0).getId());
        workActivityService.record(workspaceId, WorkActivityService.REQUIREMENT_DOC, first.getId(), userId,
                "update", "调整了文档「" + first.getTitle() + "」的顺序/层级");
    }

    /** 沿最终父级链（本批调整优先，其余取库内现值）向上走，回到自身即成环；链过深也按成环拒绝 */
    private boolean formsCycle(String id, java.util.Map<String, String> finalParent,
                               java.util.Map<String, RequirementDoc> cache) {
        String cursor = finalParent.get(id);
        int guard = 0;
        while (cursor != null) {
            if (cursor.equals(id) || ++guard > 200) {
                return true;
            }
            if (finalParent.containsKey(cursor)) {
                cursor = finalParent.get(cursor);
                continue;
            }
            RequirementDoc d = cache.get(cursor);
            if (d == null) {
                d = docMapper.selectById(cursor);
                if (d != null) cache.put(cursor, d);
            }
            cursor = d == null ? null : d.getParentId();
        }
        return false;
    }

    /**
     * 看板拖拽等轻量状态流转：只改状态，不碰正文、不建历史快照、不走整篇乐观锁。
     */
    @Transactional
    public RequirementDoc changeStatus(String userId, String workspaceId, String id, String status) {
        RequirementDoc d = getVisible(workspaceId, userId, id);
        assertDocMutate(workspaceId, userId, d);
        if (!"draft".equals(status) && !"active".equals(status) && !"done".equals(status)) {
            throw AppException.badRequest("文档状态不合法");
        }
        if (!status.equals(d.getStatus())) {
            docMapper.updateStatus(workspaceId, id, status);
            recordChange(userId, workspaceId, id, "状态", d.getStatus(), status);
        }
        return withMembers(docMapper.selectById(id));
    }

    /**
     * 行内重命名等轻量改名：只改 title，不碰正文、不建历史快照、不走整篇乐观锁。
     */
    @Transactional
    public RequirementDoc rename(String userId, String workspaceId, String id, String title) {
        RequirementDoc d = getVisible(workspaceId, userId, id);
        assertDocMutate(workspaceId, userId, d);
        String newTitle = Texts.cut(Texts.trimToNull(title), 100);
        if (newTitle == null) {
            throw AppException.badRequest("文档标题不能为空");
        }
        String oldTitle = d.getTitle();
        if (!newTitle.equals(oldTitle)) {
            docMapper.updateTitle(workspaceId, id, newTitle);
            recordChange(userId, workspaceId, id, "标题", oldTitle, newTitle);
            notifyDocOwner(docMapper.selectById(id), userId,
                    "文档「" + newTitle + "」已更新", "文档标题：由「" + oldTitle + "」改为「" + newTitle + "」");
        }
        return withMembers(docMapper.selectById(id));
    }

    /**
     * 删除需求：任务上的关联解绑（任务本身不动），然后删需求。
     * 任务保留原项目，所以不会连带删任务。
     */
    public void delete(String workspaceId, String id) {
        delete(null, workspaceId, id);
    }

    @Transactional
    public void delete(String userId, String workspaceId, String id) {
        RequirementDoc d = getVisible(workspaceId, userId, id);
        assertDocMutate(workspaceId, userId, d);
        deletionTrace.recordDelete(workspaceId, userId, "requirement_doc_delete", "requirement_doc", id,
                d.getTitle(), "删除需求文档「" + d.getTitle() + "」（"
                        + (d.getReqId() == null ? "未归属项目" : "项目 " + d.getReqId())
                        + "；子文档上移，关联任务已解绑，评论与历史一并清理）");
        /* 子文档提升到被删文档的父级，避免整棵子树变成孤儿 */
        docMapper.reparentChildren(workspaceId, id, d.getParentId());
        docMapper.deleteDemandLinksByDoc(workspaceId, id);
        java.util.List<String> affectedTaskIds = taskMapper.selectIdsByReqDocForCascade(workspaceId, id);
        docMapper.clearTaskRef(workspaceId, d.getId());
        deletionTrace.logTaskCascade(workspaceId, userId, affectedTaskIds,
                "关联需求文档「" + d.getTitle() + "」已删除，自动解除关联");
        commentMapper.deleteByDoc(workspaceId, id);
        historyMapper.deleteByDoc(workspaceId, id);
        shareMapper.deleteByDoc(workspaceId, id);
        docMapper.deleteVisibilityMembersByDoc(workspaceId, id);
        attachmentService.deleteByTarget(workspaceId, id, AttachmentService.KIND_DOC);
        docMapper.delete(d.getId());
        workActivityService.deleteByEntity(workspaceId, WorkActivityService.REQUIREMENT_DOC, id);
        notifyDocOwner(d, userId, "文档「" + d.getTitle() + "」已被删除",
                "需求文档已删除，关联任务已解绑");
    }

    /** 项目被删除时连带清理（由 RequirementService 调用） */
    @Transactional
    public int deleteByReq(String workspaceId, String reqId) {
        /* 需求没了，任务上的 req_doc_id 必须一起解绑；
           只删 requirement_doc 会留下悬空引用，任务详情里看不到但数据已经不一致。 */
        docMapper.deleteDemandLinksByReq(workspaceId, reqId);
        commentMapper.deleteByReq(workspaceId, reqId);
        historyMapper.deleteByReq(workspaceId, reqId);
        for (String docId : docMapper.selectIdsByReq(workspaceId, reqId)) {
            docMapper.clearTaskRef(workspaceId, docId);
            docMapper.deleteDemandLinksByDoc(workspaceId, docId);
            shareMapper.deleteByDoc(workspaceId, docId);
            attachmentService.deleteByTarget(workspaceId, docId, AttachmentService.KIND_DOC);
            workActivityService.deleteByEntity(workspaceId, WorkActivityService.REQUIREMENT_DOC, docId);
        }
        docMapper.deleteVisibilityMembersByReq(workspaceId, reqId);
        return docMapper.deleteByReq(workspaceId, reqId);
    }

    /* ---------------- 历史版本 ---------------- */

    /** 版本列表（不含正文）：读取前校验项目可见范围 */
    public com.hourglass.dto.PageResult<RequirementDocHistory> history(String workspaceId, String userId, String docId,
                                                                       int offset, int limit) {
        getVisible(workspaceId, userId, docId);
        int safeOffset = Math.max(0, offset);
        int safeLimit = Math.max(1, Math.min(100, limit));
        int total = historyMapper.countByDoc(workspaceId, docId);
        List<RequirementDocHistory> items = total <= safeOffset
                ? new java.util.ArrayList<RequirementDocHistory>()
                : historyMapper.selectByDoc(workspaceId, docId, safeOffset, safeLimit);
        return com.hourglass.dto.PageResult.of(items, total, safeOffset, safeLimit);
    }

    /** 单个版本（含正文）：读取前校验项目可见范围 */
    public RequirementDocHistory historyVersion(String workspaceId, String userId, String docId, String historyId) {
        getVisible(workspaceId, userId, docId);
        RequirementDocHistory h = historyMapper.selectById(historyId);
        if (h == null || !docId.equals(h.getDocId()) || !workspaceId.equals(h.getWorkspaceId())) {
            throw AppException.notFound("历史版本不存在：" + historyId);
        }
        return h;
    }

    /** 恢复到指定历史版本：恢复前先把当前正文留一版快照（恢复本身可再撤销） */
    @Transactional
    public RequirementDoc restore(String userId, String workspaceId, String docId, String historyId) {
        RequirementDoc d = getVisible(workspaceId, userId, docId);
        /* 恢复历史版本会覆盖正文（等价 update），同走创建人保护，避免绕过 update 门控 */
        assertDocMutate(workspaceId, userId, d);
        RequirementDocHistory h = historyMapper.selectById(historyId);
        if (h == null || !docId.equals(h.getDocId()) || !workspaceId.equals(h.getWorkspaceId())) {
            throw AppException.notFound("历史版本不存在：" + historyId);
        }
        snapshot(userId, d);
        d.setTitle(h.getTitle());
        d.setContent(h.getContent());
        d.setFormat(h.getFormat());
        d.setContentBrief("markdown".equals(d.getFormat()) ? excerptOfMarkdown(d.getContent()) : excerptOf(d.getContent()));
        docMapper.update(d, null);
        workActivityService.record(workspaceId, WorkActivityService.REQUIREMENT_DOC, docId, userId,
                "restore", "恢复到第 " + h.getVersionNo() + " 版（" + h.getTitle() + "）");
        notifyDocOwner(d, userId, "文档「" + d.getTitle() + "」已恢复到历史版本",
                "文档已恢复到第 " + h.getVersionNo() + " 版，请确认内容");
        return withMembers(docMapper.selectById(docId));
    }

    /**
     * 发布（published=true）或收回发布（false）。
     * 权限：创建人保护（A 轻量档）——负责人本人或空间 owner/admin；空负责人回退项目可写。
     * 与前端对非负责人隐藏发布入口、原型「发布撤回」口径一致。
     * 发布不触碰正文与历史，只改 published_at；收回发布同时吊销分享链接。
     */
    @Transactional
    public RequirementDoc publish(String userId, String workspaceId, String id, boolean published) {
        RequirementDoc d = getVisible(workspaceId, userId, id);
        assertDocMutate(workspaceId, userId, d);
        if (published == (d.getPublishedAt() != null)) {
            return d;
        }
        docMapper.updatePublished(id, published ? java.time.LocalDateTime.now() : null);
        if (!published) {
            /* 收回发布即吊销分享：旧链接不能在再次发布后自动复活，需重新生成 */
            shareMapper.deleteByDoc(workspaceId, id);
        }
        String vis = Texts.trimToNull(d.getVisibility());
        String visible = VIS_MEMBERS.equals(vis) ? "，仅指定成员可见"
                : VIS_PERSONAL.equals(vis) ? "，仅负责人可见" : "，成员可见";
        workActivityService.record(workspaceId, WorkActivityService.REQUIREMENT_DOC, id, userId, "update",
                published ? "发布了文档「" + d.getTitle() + "」" + visible
                        : "收回了文档「" + d.getTitle() + "」的发布，转为草稿");
        return withMembers(docMapper.selectById(id));
    }

    /* ---------------- 只读分享 ---------------- */

    private static final int SHARE_DAYS = 30;

    /** 生成/重置分享链接：仅已发布文档可分享；权限=项目/空间可写者（分发已发布内容，不走创建人门控，与发布/改删区分） */
    @Transactional
    public ReqDocShare createShare(String userId, String workspaceId, String docId) {
        RequirementDoc d = getVisible(workspaceId, userId, docId);
        projectAccess.assertWrite(workspaceId, userId, d.getReqId());
        if (d.getPublishedAt() == null) {
            throw AppException.badRequest("文档尚未发布，发布后才能生成分享链接");
        }
        String vis = Texts.trimToNull(d.getVisibility());
        if (vis != null && !VIS_TEAM.equals(vis)) {
            throw AppException.badRequest("仅团队共享文档可生成公开分享链接，请先调整可见范围");
        }
        ReqDocShare share = new ReqDocShare();
        share.setWorkspaceId(workspaceId);
        share.setDocId(docId);
        share.setToken(Ids.genToken());
        share.setCreatedAt(java.time.LocalDateTime.now());
        share.setExpiresAt(java.time.LocalDateTime.now().plusDays(SHARE_DAYS));
        shareMapper.upsert(share);
        workActivityService.record(workspaceId, WorkActivityService.REQUIREMENT_DOC, docId, userId, "share",
                "生成了文档「" + d.getTitle() + "」的只读分享链接");
        return shareMapper.selectByDoc(workspaceId, docId);
    }

    /** 查看现有分享链接：分享凭证仅当前项目可写者可见；已过期按无链接处理 */
    public ReqDocShare shareInfo(String userId, String workspaceId, String docId) {
        RequirementDoc d = getVisible(workspaceId, userId, docId);
        projectAccess.assertWrite(workspaceId, userId, d.getReqId());
        ReqDocShare share = shareMapper.selectByDoc(workspaceId, docId);
        if (share != null && share.getExpiresAt() != null
                && share.getExpiresAt().isBefore(java.time.LocalDateTime.now())) {
            return null;
        }
        return share;
    }

    @Transactional
    public void revokeShare(String userId, String workspaceId, String docId) {
        RequirementDoc d = getVisible(workspaceId, userId, docId);
        projectAccess.assertWrite(workspaceId, userId, d.getReqId());
        shareMapper.deleteByDoc(workspaceId, docId);
        workActivityService.record(workspaceId, WorkActivityService.REQUIREMENT_DOC, docId, userId, "share",
                "撤销了文档「" + d.getTitle() + "」的只读分享链接");
    }

    /** 公开只读：按 token 返回文档；token 无效、过期或文档已收回发布一律 404 */
    public ReqDocShareResponse publicShare(String token) {
        if (token == null || token.trim().isEmpty()) {
            throw AppException.notFound("分享链接无效或已过期");
        }
        ReqDocShare share = shareMapper.selectByToken(token.trim());
        if (share == null || (share.getExpiresAt() != null
                && share.getExpiresAt().isBefore(java.time.LocalDateTime.now()))) {
            throw AppException.notFound("分享链接无效或已过期");
        }
        RequirementDoc d = docMapper.selectById(share.getDocId());
        String vis = d == null ? null : Texts.trimToNull(d.getVisibility());
        if (d == null || !share.getWorkspaceId().equals(d.getWorkspaceId()) || d.getPublishedAt() == null
                || (vis != null && !VIS_TEAM.equals(vis))) {
            /* 文档收回发布或收窄为指定成员/仅自己后，旧链接一律失效，不能绕过名单继续对外暴露 */
            throw AppException.notFound("分享链接无效或已过期");
        }
        Workspace ws = workspaceMapper.selectById(share.getWorkspaceId());
        if (ws == null) {
            throw AppException.notFound("分享链接无效或已过期");
        }
        ReqDocShareResponse resp = new ReqDocShareResponse();
        resp.setWorkspaceName(ws.getName());
        resp.setDocId(d.getId());
        resp.setTitle(d.getTitle());
        resp.setDocType(d.getDocType());
        resp.setFormat(d.getFormat());
        resp.setContent(d.getContent());
        resp.setStatus(d.getStatus());
        resp.setOwner(d.getOwner());
        resp.setUpdatedAt(d.getUpdatedAt());
        resp.setGeneratedAt(java.time.LocalDateTime.now());
        return resp;
    }

    /** 把当前正文留一版快照（恢复历史版本前调用） */
    private void snapshot(String userId, RequirementDoc d) {
        snapshot(userId, d, d.getTitle(), d.getContent(), d.getFormat());
    }

    /** 保存指定正文快照，并把每文档保留版数截断到 HISTORY_KEEP */
    private void snapshot(String userId, RequirementDoc d, String title, String content, String format) {
        RequirementDocHistory h = new RequirementDocHistory();
        h.setId(Ids.gen("DH"));
        h.setDocId(d.getId());
        h.setWorkspaceId(d.getWorkspaceId());
        h.setVersionNo(historyMapper.maxVersionNo(d.getId()) + 1);
        h.setTitle(title);
        h.setContent(content);
        h.setFormat(format);
        AppUser me = userMapper.selectById(userId);
        h.setSavedBy(me == null ? null : Texts.cut(me.getDisplayName(), 32));
        h.setSavedByUserId(userId);
        historyMapper.insert(h);
        historyMapper.deleteOld(d.getId(), HISTORY_KEEP);
    }

    /* ---------------- 需求池 ↔ 文档 ---------------- */

    public com.hourglass.dto.PageResult<ReqDocView> docsOfDemand(String workspaceId, String demandId, String userId,
                                                                  int offset, int limit) {
        Demand demand = demandMapper.selectById(demandId);
        if (demand == null || !workspaceId.equals(demand.getWorkspaceId())) {
            throw AppException.notFound("需求不存在：" + demandId);
        }
        projectAccess.assertView(workspaceId, userId, demand.getReqId());
        int safeOffset = Math.max(0, offset);
        int safeLimit = Math.max(1, Math.min(100, limit));
        String viewerId = projectAccess.viewerScope(workspaceId, userId);
        String role = projectAccess.roleOf(workspaceId, userId);
        boolean seeAllDrafts = ProjectAccessService.isPrivileged(role);
        int total = docMapper.countByDemand(workspaceId, demandId, viewerId, userId, seeAllDrafts);
        List<ReqDocView> rows = total <= safeOffset ? new java.util.ArrayList<ReqDocView>()
                : docMapper.selectByDemand(workspaceId, demandId, viewerId, userId, seeAllDrafts,
                        safeOffset, safeLimit);
        for (ReqDocView row : rows) {
            row.setExcerpt(excerptOf(row.getContentBrief()));
            row.setContentBrief(null);
        }
        return com.hourglass.dto.PageResult.of(rows, total, safeOffset, safeLimit);
    }

    public com.hourglass.dto.PageResult<Map<String, Object>> demandsOfDoc(String workspaceId, String id,
                                                                           int offset, int limit) {
        get(workspaceId, id);
        int safeOffset = Math.max(0, offset);
        int safeLimit = Math.max(1, Math.min(100, limit));
        int total = docMapper.countDemandsByDoc(workspaceId, id);
        List<Map<String, Object>> items = total <= safeOffset ? new java.util.ArrayList<Map<String, Object>>()
                : docMapper.selectDemandsByDoc(workspaceId, id, safeOffset, safeLimit);
        return com.hourglass.dto.PageResult.of(items, total, safeOffset, safeLimit);
    }

    /** 只允许关联同一项目下的文档，避免需求详情里出现别的项目的规格 */
    @Transactional
    public void linkDemand(String workspaceId, String demandId, String docId, String userId) {
        Demand demand = demandMapper.selectById(demandId);
        if (demand == null || !workspaceId.equals(demand.getWorkspaceId())) {
            throw AppException.notFound("需求不存在：" + demandId);
        }
        projectAccess.assertWrite(workspaceId, userId, demand.getReqId());
        RequirementDoc doc = getVisible(workspaceId, userId, docId);
        if (!Objects.equals(demand.getReqId(), doc.getReqId())) {
            throw AppException.badRequest("只能关联同一项目下的文档");
        }
        docMapper.linkDemand(workspaceId, demandId, docId, userId);
    }

    @Transactional
    public void unlinkDemand(String workspaceId, String demandId, String docId, String userId) {
        Demand demand = demandMapper.selectById(demandId);
        if (demand == null || !workspaceId.equals(demand.getWorkspaceId())) {
            throw AppException.notFound("需求不存在：" + demandId);
        }
        projectAccess.assertWrite(workspaceId, userId, demand.getReqId());
        docMapper.unlinkDemand(workspaceId, demandId, docId);
    }

    /** 需求池条目被删除时清理关联（由 DemandService 调用） */
    @Transactional
    public void unlinkAllForDemand(String workspaceId, String demandId) {
        docMapper.deleteDemandLinksByDemand(workspaceId, demandId);
    }

    /** 某项目下的需求文档数（项目列表展示 / 删除前提示用） */
    public int countByReq(String workspaceId, String reqId) {
        return docMapper.countByReq(workspaceId, reqId);
    }

    /** 项目列表用：一次 GROUP BY 取全部项目的需求数 */
    public java.util.Map<String, Integer> countByReqMap(String workspaceId, String userId, boolean seeAllDrafts) {
        java.util.Map<String, Integer> out = new java.util.HashMap<String, Integer>();
        for (java.util.Map<String, Object> row : docMapper.countGroupByReq(workspaceId, userId, seeAllDrafts)) {
            Object k = row.get("reqId");
            Object v = row.get("cnt");
            if (k != null && v instanceof Number) {
                out.put(String.valueOf(k), ((Number) v).intValue());
            }
        }
        return out;
    }

    /**
     * HTML 白名单清洗。返回 null 表示"清洗后没有实质内容"（空段落之类）。
     */
    public static String sanitize(String html) {
        if (html == null || html.trim().isEmpty()) {
            return null;
        }
        String src = html.length() > CONTENT_MAX ? html.substring(0, CONTENT_MAX) : html;
        Document dirty = Jsoup.parseBodyFragment(src);
        dirty.outputSettings().prettyPrint(false);
        Document clean = new org.jsoup.safety.Cleaner(SAFELIST).clean(dirty);
        clean.outputSettings().prettyPrint(false);
        filterStyles(clean.body());
        filterImages(clean.body());
        String out = clean.body().html();
        if (out == null || out.trim().isEmpty()) {
            return null;
        }
        /* 只有空标签（<p><br></p> 之类）也视为空 */
        String text = clean.body().text();
        return (text == null || text.trim().isEmpty()) && out.indexOf("<hr") < 0 ? null : out;
    }

    /**
     * 将 Word 文档导入为清洗后的 HTML 正文（docx 保留排版，doc 提取文本）。
     * 复用 DocPreviewService 的转换能力，再经白名单清洗。
     * 图片以 base64 data URL 内联在 HTML 中；不提取为独立附件。
     */
    public String importWord(java.io.File file) {
        return importWord(file, "docx");
    }

    /** 导入 Word：docx 走 XHTML 转换，doc 走 POI 文本提取，最后统一白名单清洗 */
    public String importWord(java.io.File file, String ext) {
        Map<String, String> preview = docPreviewService.preview(file, ext);
        String html = preview == null ? null : preview.get("content");
        if (html == null || html.trim().isEmpty()) {
            throw AppException.badRequest("文档内容为空或无法识别");
        }
        String clean = sanitize(html);
        if (clean == null) {
            throw AppException.badRequest("文档内容为空或无法识别");
        }
        return clean;
    }

    /**
     * 只保留色值/对齐相关的 style 属性：编辑器的调色板会写成 inline style，
     * 直接放行整个 style 串风险太大（可塞 position:fixed、background-image:url(...) 之类）。
     */
    private static void filterStyles(org.jsoup.nodes.Element body) {
        for (org.jsoup.nodes.Element el : body.select("[style]")) {
            StringBuilder sb = new StringBuilder();
            for (String part : el.attr("style").split(";")) {
                int i = part.indexOf(':');
                if (i <= 0) {
                    continue;
                }
                String k = part.substring(0, i).trim().toLowerCase();
                String v = part.substring(i + 1).trim();
                if (!STYLE_ALLOW.contains(k) || !STYLE_VALUE.matcher(v).matches()) {
                    continue;
                }
                if (sb.length() > 0) {
                    sb.append("; ");
                }
                sb.append(k).append(": ").append(v);
            }
            if (sb.length() == 0) {
                el.removeAttr("style");
            } else {
                el.attr("style", sb.toString());
            }
        }
    }

    /**
     * 图片白名单：只允许 png/jpeg/gif/webp 的 data URL 或 http(s) 外链，单图 3MB 以内。
     * 刻意排除 svg（可内嵌脚本）与其它 data 类型。
     */
    private static void filterImages(org.jsoup.nodes.Element body) {
        for (org.jsoup.nodes.Element img : body.select("img")) {
            String src = img.attr("src");
            boolean ok = src.startsWith("data:image/png;base64,")
                    || src.startsWith("data:image/jpeg;base64,")
                    || src.startsWith("data:image/jpg;base64,")
                    || src.startsWith("data:image/gif;base64,")
                    || src.startsWith("data:image/webp;base64,")
                    || src.startsWith("http://")
                    || src.startsWith("https://");
            if (!ok || src.length() > 3_000_000) {
                img.remove();
                continue;
            }
            String alt = img.attr("alt");
            img.clearAttributes();
            img.attr("src", src);
            if (!alt.isEmpty()) {
                img.attr("alt", alt);
            }
        }
    }

    /** 文档负责人不是操作者时才通知，避免自己改自己的文档还收到站内信 */
    private void notifyDocOwner(RequirementDoc d, String actorId, String title, String body) {
        String owner = Texts.trimToNull(d.getOwnerUserId());
        if (owner == null || owner.equals(actorId)) {
            return;
        }
        /* 文档 ID 不是任务 ID：写 refKind/refId，通知中心按文档打开 */
        notificationEvents.notifyLinked(owner, d.getWorkspaceId(), UserNotificationPreferenceService.DEMAND_STATUS,
                title, body, "doc", d.getId(), d.getReqId());
    }

    private List<String> apply(RequirementDoc d, String reqId, ReqDocSaveRequest req, String userId) {
        return apply(d, reqId, req, userId, null, java.util.Collections.<String>emptyList());
    }

    /**
     * 写入文档字段，并返回需要落库的指定可见成员名单。
     * 可见范围省略时：编辑沿用原值、新建默认团队共享；收窄/放宽后成员名单由这里统一归一。
     */
    private List<String> apply(RequirementDoc d, String reqId, ReqDocSaveRequest req, String userId,
                               String oldVisibility, List<String> oldMemberIds) {
        String code = Texts.trimToNull(req.getDocType());
        /* 省略分类时编辑沿用原值；新建及旧文档缺省归入其他。显式非法分类必须拒绝。 */
        DocumentType docType = code == null ? DocumentType.parseOrOther(d.getDocType()) : DocumentType.parse(code);
        if (docType == null) {
            throw AppException.badRequest("文档分类不合法");
        }
        d.setDocType(docType.getCode());
        d.setReqId(reqId);
        d.setCategoryId(resolveCategory(d, reqId, req.getCategoryId()));
        d.setParentId(validateParent(d, reqId, req.getParentId()));
        d.setTitle(Texts.cut(Texts.trimToNull(req.getTitle()), 100));
        String format = Texts.trimToNull(req.getFormat());
        if (format == null) {
            /* 新建默认 Markdown；编辑未显式传格式时沿用原格式，避免把旧 HTML 文档误判 */
            format = d.getFormat() == null ? "markdown" : d.getFormat();
        }
        d.setFormat(format);
        d.setContent(contentOf(format, req.getContent()));
        if (d.getSortOrder() == null) {
            d.setSortOrder(0);
        }
        /* 列表摘要随正文同步维护：列表接口不再读 MEDIUMTEXT */
        d.setContentBrief("markdown".equals(format) ? excerptOfMarkdown(d.getContent()) : excerptOf(d.getContent()));
        String status = Texts.trimToNull(req.getStatus());
        if (status == null) {
            status = "draft";
        }
        /* 状态与发布可见性是两个维度：status 只允许 draft/active/done，
           未知值（如历史误写的 published）会让前端全部落到「草稿」 */
        if (!"draft".equals(status) && !"active".equals(status) && !"done".equals(status)) {
            throw AppException.badRequest("文档状态不合法");
        }
        d.setStatus(status);
        String owner = Texts.trimToNull(req.getOwner());
        if (owner != null) {
            d.setOwner(Texts.cut(owner, 32));
            d.setOwnerUserId(null);
        } else if (Texts.trimToNull(d.getOwner()) == null && Texts.trimToNull(d.getOwnerUserId()) == null) {
            /* 未指定负责人且文档还没有负责人（新建/历史数据）才落到当前用户；
               编辑时保留原负责人，避免「谁最后保存谁就变成负责人」 */
            AppUser me = userMapper.selectById(userId);
            d.setOwner(me == null ? null : Texts.cut(me.getDisplayName(), 32));
            d.setOwnerUserId(userId);
        }
        String currentVisibility = Texts.trimToNull(d.getVisibility());
        String visibility = visOf(Texts.trimToNull(req.getVisibility()) != null
                ? req.getVisibility() : (oldVisibility != null ? oldVisibility : currentVisibility));
        d.setVisibility(visibility);
        /* 非团队共享必须有真实负责人账号，否则文档会变成谁都打不开；
           历史自由文本负责人没有账号 ID 时，收窄动作落到操作者身上 */
        if (!VIS_TEAM.equals(visibility) && Texts.trimToNull(d.getOwnerUserId()) == null) {
            AppUser me = userMapper.selectById(userId);
            d.setOwner(me == null ? d.getOwner() : Texts.cut(me.getDisplayName(), 32));
            d.setOwnerUserId(userId);
        }
        /* 名单省略时沿用原名单（编辑器保存不带名单，不能静默清空）。
           沿用不再复核项目可见性：名单成员后来被移出项目不该阻断正文保存；主动改名单时才校验。 */
        if (req.getMemberIds() == null && VIS_MEMBERS.equals(visibility)
                && VIS_MEMBERS.equals(Texts.trimToNull(oldVisibility))) {
            return oldMemberIds == null ? java.util.Collections.<String>emptyList() : oldMemberIds;
        }
        return memberIdsOf(d.getWorkspaceId(), reqId, visibility,
                req.getMemberIds() == null ? oldMemberIds : req.getMemberIds());
    }

    /** 可见范围归一：非法值拒绝，避免把拼错的值静默落成 team */
    private static String visOf(String raw) {
        String v = Texts.trimToNull(raw);
        if (v == null) {
            return VIS_TEAM;
        }
        if (VIS_TEAM.equals(v) || VIS_MEMBERS.equals(v) || VIS_PERSONAL.equals(v)) {
            return v;
        }
        throw AppException.badRequest("文档可见范围不合法");
    }

    private static String visLabel(String visibility) {
        if (VIS_MEMBERS.equals(visibility)) {
            return "指定成员可见";
        }
        if (VIS_PERSONAL.equals(visibility)) {
            return "仅负责人可见";
        }
        return "团队共享";
    }

    /** 指定成员名单：去重、上限，且必须真的看得到本项目，否则授权没有意义 */
    private List<String> memberIdsOf(String workspaceId, String reqId, String visibility, List<String> raw) {
        if (!VIS_MEMBERS.equals(visibility)) {
            return java.util.Collections.emptyList();
        }
        List<String> ids = new java.util.ArrayList<String>();
        for (String id : raw == null ? java.util.Collections.<String>emptyList() : raw) {
            String uid = Texts.trimToNull(id);
            if (uid != null && !ids.contains(uid)) {
                ids.add(uid);
            }
        }
        if (ids.isEmpty()) {
            throw AppException.badRequest("「指定成员可见」至少要选一位成员");
        }
        if (ids.size() > MAX_VIS_MEMBERS) {
            throw AppException.badRequest("指定成员最多 " + MAX_VIS_MEMBERS + " 位，请改用团队共享");
        }
        for (String uid : ids) {
            if (!projectAccess.canView(workspaceId, uid, reqId)) {
                throw AppException.badRequest("所选成员里有人看不到本项目，请先在成员管理里授权");
            }
        }
        return ids;
    }

    private void saveVisibilityMembers(String workspaceId, String docId, List<String> memberIds) {
        docMapper.deleteVisibilityMembersByDoc(workspaceId, docId);
        if (memberIds != null && !memberIds.isEmpty()) {
            docMapper.insertVisibilityMembers(workspaceId, docId, memberIds);
        }
    }

    /**
     * 分类解析：省略（null）时编辑沿用原分类、新建为未分类；显式空串清空；
     * 给了分类则校验存在、同空间，且归属范围与文档 reqId 一致（空间级分类→reqId 须为 null）。
     * 写权限由调用方按最终 reqId 走 assertWrite，前端过滤只是 UX，服务端在此兜底归属一致性。
     */
    private String resolveCategory(RequirementDoc d, String reqId, String rawCategoryId) {
        if (rawCategoryId == null) {
            String existing = d.getCategoryId();
            if (existing == null || docCategories == null) {
                return existing;
            }
            /* 沿用原分类，但归属范围已变（换项目 / 转空间级）时原分类失效，自动清空避免悬空归类 */
            com.hourglass.entity.DocCategory cat = docCategories.findForDoc(d.getWorkspaceId(), existing);
            String catScope = Texts.trimToNull(cat.getReqId());
            return java.util.Objects.equals(catScope, reqId) ? existing : null;
        }
        String cid = Texts.trimToNull(rawCategoryId);
        if (cid == null) {
            return null;
        }
        if (docCategories == null) {
            throw AppException.badRequest("分类服务不可用");
        }
        com.hourglass.entity.DocCategory cat = docCategories.findForDoc(d.getWorkspaceId(), cid);
        String catScope = Texts.trimToNull(cat.getReqId());
        if (!java.util.Objects.equals(catScope, reqId)) {
            throw AppException.badRequest("文档归属项目须与所选分类一致（空间级分类不能挂到项目下，反之亦然）");
        }
        return cat.getId();
    }

    /** 父文档必须存在、同范围（同项目或同为空间级），且不能形成环 */
    private String validateParent(RequirementDoc d, String reqId, String rawParentId) {
        String parentId = Texts.trimToNull(rawParentId);
        if (parentId == null) {
            return null;
        }
        if (parentId.equals(d.getId())) {
            throw AppException.badRequest("上级文档不能是当前文档");
        }
        RequirementDoc parent = docMapper.selectById(parentId);
        if (parent == null || !d.getWorkspaceId().equals(parent.getWorkspaceId())) {
            throw AppException.badRequest("上级文档不存在：" + parentId);
        }
        if (!java.util.Objects.equals(reqId, parent.getReqId())) {
            throw AppException.badRequest("上级文档必须属于同一项目或同为空间级");
        }
        String cursor = parent.getParentId();
        int guard = 0;
        while (cursor != null && guard++ < 100) {
            if (cursor.equals(d.getId())) {
                throw AppException.badRequest("上级文档不能是当前文档的子文档");
            }
            RequirementDoc p = docMapper.selectById(cursor);
            cursor = p == null ? null : p.getParentId();
        }
        return parentId;
    }

    /**
     * 解析前端带回的文档版本时间。为空表示旧客户端跳过乐观锁；
     * 格式非法直接拒绝，避免静默放过拼错的版本号。
     */
    private static java.time.LocalDateTime parseUpdatedAt(String raw) {
        String s = Texts.trimToNull(raw);
        if (s == null) {
            return null;
        }
        try {
            return java.time.LocalDateTime.parse(s, java.time.format.DateTimeFormatter.ISO_LOCAL_DATE_TIME);
        } catch (java.time.format.DateTimeParseException e) {
            throw AppException.badRequest("文档版本不合法");
        }
    }

    /** 按格式落库正文：Markdown 原样保存，HTML 走白名单清洗 */
    public static String contentOf(String format, String content) {
        if ("markdown".equals(format)) {
            if (content == null || content.trim().isEmpty()) {
                return null;
            }
            return content.length() > CONTENT_MAX ? content.substring(0, CONTENT_MAX) : content;
        }
        return sanitize(content);
    }

    /** 归属项目解析：空 = 空间级文档（返回 null，写权限走 assertWrite 对 null 项目的「非查看者」口径）；非空须是本空间项目。 */
    private String ensureProject(String workspaceId, String reqId) {
        String rid = Texts.trimToNull(reqId);
        if (rid == null) {
            return null;
        }
        Requirement r = reqMapper.selectById(rid);
        if (r == null || !workspaceId.equals(r.getWorkspaceId())) {
            throw AppException.badRequest("所属项目不存在：" + rid);
        }
        return rid;
    }

    private void recordChange(String userId, String workspaceId, String id,
                              String field, Object oldValue, Object newValue) {
        if (!java.util.Objects.equals(oldValue, newValue)) {
            workActivityService.record(workspaceId, WorkActivityService.REQUIREMENT_DOC, id, userId, "update",
                    field + "：" + display(oldValue) + " → " + display(newValue));
        }
    }

    private String projectDisplay(String reqId) {
        Requirement project = reqId == null ? null : reqMapper.selectById(reqId);
        return project == null || Texts.trimToNull(project.getName()) == null ? display(reqId) : project.getName();
    }

    private static String display(Object value) {
        return value == null ? "（空）" : String.valueOf(value);
    }

    /** LIKE 通配符转义：用户输入里的 % _ \ 按字面匹配（SQL 侧 ESCAPE '\'） */
    private static String likePattern(String kw) {
        if (kw == null || kw.isEmpty()) {
            return null;
        }
        return kw.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
    }

    /** 从 Markdown 抽纯文本摘要（列表用） */
    public static String excerptOfMarkdown(String markdown) {
        if (markdown == null || markdown.trim().isEmpty()) {
            return null;
        }
        String text = markdown
                .replaceAll("(?s)```.*?```", " ")
                .replaceAll("(?m)^\\s*#{1,6}\\s*", "")
                .replaceAll("(?m)^\\s*>\\s?", "")
                .replaceAll("(?m)^\\s*[-*+]\\s+", "")
                .replaceAll("(?m)^\\s*\\d+\\.\\s+", "")
                .replaceAll("!\\[([^\\]]*)\\]\\([^)]*\\)", "$1")
                .replaceAll("\\[([^\\]]*)\\]\\([^)]*\\)", "$1")
                .replaceAll("[`*_~]", "")
                .replaceAll("<[^>]+>", " ")
                .replaceAll("\\s+", " ")
                .trim();
        if (text.isEmpty()) {
            return null;
        }
        return text.length() <= EXCERPT_MAX ? text : text.substring(0, EXCERPT_MAX) + "…";
    }

    /** 从 HTML 片段抽纯文本摘要（列表与备份导入共用） */
    public static String excerptOf(String html) {
        if (html == null || html.trim().isEmpty()) {
            return null;
        }
        String text = Jsoup.parse(html).text().replaceAll("\\s+", " ").trim();
        if (text.isEmpty()) {
            return null;
        }
        return text.length() <= EXCERPT_MAX ? text : text.substring(0, EXCERPT_MAX) + "…";
    }
}
