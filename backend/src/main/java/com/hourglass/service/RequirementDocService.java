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

    public RequirementDocService(RequirementDocMapper docMapper, RequirementDocHistoryMapper historyMapper,
                                 RequirementDocCommentMapper commentMapper,
                                 RequirementMapper reqMapper, UserMapper userMapper,
                                 TaskMapper taskMapper, WorkActivityService workActivityService,
                                 DemandMapper demandMapper, ProjectAccessService projectAccess,
                                 NotificationEventService notificationEvents,
                                 ReqDocShareMapper shareMapper, WorkspaceMapper workspaceMapper,
                                 DocPreviewService docPreviewService) {
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
    }

    public List<ReqDocView> list(String workspaceId, String userId) {
        return list(workspaceId, userId, null);
    }

    public List<ReqDocView> list(String workspaceId, String userId, String keyword) {
        List<ReqDocView> rows = docMapper.selectViewByWorkspace(workspaceId, likePattern(Texts.trimToNull(keyword)));
        java.util.Set<String> hiddenReqs = projectAccess.hiddenProjectIds(workspaceId, userId);
        String role = projectAccess.roleOf(workspaceId, userId);
        List<ReqDocView> visible = new java.util.ArrayList<ReqDocView>();
        for (ReqDocView v : rows) {
            if (hiddenReqs.contains(v.getReqId())) {
                continue;
            }
            /* 草稿（未发布）只对作者与空间 owner/admin 可见，其余成员按不存在处理 */
            if (!canSeeDraft(v.getOwnerUserId(), v.getPublishedAt(), userId, role)) {
                continue;
            }
            v.setExcerpt(excerptOf(v.getContentBrief()));
            v.setContentBrief(null);
            visible.add(v);
        }
        return visible;
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

    public RequirementDoc get(String workspaceId, String id) {
        RequirementDoc d = docMapper.selectById(id);
        if (d == null || !workspaceId.equals(d.getWorkspaceId())) {
            throw AppException.notFound("文档不存在：" + id);
        }
        return d;
    }

    /** 读取前校验项目可见范围与草稿可见性（不可见一律按不存在处理） */
    public RequirementDoc getVisible(String workspaceId, String userId, String id) {
        RequirementDoc d = get(workspaceId, id);
        projectAccess.assertView(workspaceId, userId, d.getReqId());
        if (!canSeeDraft(d.getOwnerUserId(), d.getPublishedAt(), userId,
                projectAccess.roleOf(workspaceId, userId))) {
            throw AppException.notFound("文档不存在：" + id);
        }
        return d;
    }

    public List<Task> tasks(String workspaceId, String id) {
        get(workspaceId, id);
        return taskMapper.selectByReqDoc(workspaceId, id);
    }

    @Transactional
    public RequirementDoc create(String userId, String workspaceId, ReqDocSaveRequest req) {
        String reqId = ensureProject(workspaceId, req.getReqId());
        projectAccess.assertWrite(workspaceId, userId, reqId);
        RequirementDoc d = new RequirementDoc();
        d.setId(Ids.gen("D"));
        d.setWorkspaceId(workspaceId);
        apply(d, reqId, req, userId);
        docMapper.insert(d);
        workActivityService.record(workspaceId, WorkActivityService.REQUIREMENT_DOC, d.getId(), userId,
                "create", "创建了文档「" + d.getTitle() + "」");
        return docMapper.selectById(d.getId());
    }

    @Transactional
    public RequirementDoc update(String userId, String workspaceId, String id, ReqDocSaveRequest req) {
        RequirementDoc d = getVisible(workspaceId, userId, id);
        projectAccess.assertWrite(workspaceId, userId, d.getReqId());
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
        apply(d, reqId, req, userId);
        if (docMapper.update(d, oldUpdatedAt) == 0) {
            throw AppException.conflict("文档已被他人修改，请刷新查看最新内容后再保存");
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
        /* 需求换项目后，仍挂在旧项目下的任务会指向别的项目的文档：解掉这些关联 */
        if (oldReqId != null && !oldReqId.equals(reqId)) {
            docMapper.clearTaskRefExceptReq(workspaceId, d.getId(), reqId);
            /* 旧项目的需求关联同样失效（关联要求同项目），避免需求详情里看到别的项目的文档 */
            docMapper.deleteDemandLinksByDoc(workspaceId, d.getId());
            /* 子文档留在旧项目，提升到本文档原来的父级，避免跨项目形成断掉的子树 */
            docMapper.reparentChildren(workspaceId, d.getId(), oldParentId);
        }
        boolean changed = !Objects.equals(oldTitle, d.getTitle())
                || !Objects.equals(oldContent, d.getContent())
                || !Objects.equals(oldStatus, d.getStatus())
                || oldDocType != DocumentType.parseOrOther(d.getDocType())
                || !Objects.equals(oldReqId, d.getReqId());
        if (changed) {
            notifyDocOwner(d, userId, "文档「" + d.getTitle() + "」已更新",
                    "文档内容或属性有更新");
        }
        return docMapper.selectById(id);
    }

    /** 需求文档活动查询前复用详情接口的空间归属校验。 */
    public List<WorkActivity> activities(String workspaceId, String id) {
        get(workspaceId, id);
        return workActivityService.listByEntity(workspaceId, WorkActivityService.REQUIREMENT_DOC, id);
    }

    /** 空间级文档动态流：按查看人过滤隐藏项目与他人草稿，最多返回 limit 条 */
    public List<ReqDocActivityView> feedActivities(String workspaceId, String userId, int limit) {
        List<ReqDocActivityView> rows = workActivityService.docActivities(workspaceId, limit);
        java.util.Set<String> hiddenReqs = projectAccess.hiddenProjectIds(workspaceId, userId);
        String role = projectAccess.roleOf(workspaceId, userId);
        List<ReqDocActivityView> visible = new java.util.ArrayList<ReqDocActivityView>(rows.size());
        for (ReqDocActivityView row : rows) {
            /* 文档已被删除（理论上活动随文档清理，保险起见跳过）或项目不可见：不外泄 */
            if (row.getDocId() == null || hiddenReqs.contains(row.getReqId())) {
                continue;
            }
            if (!canSeeDraft(row.getOwnerUserId(), row.getPublishedAt(), userId, role)) {
                continue;
            }
            row.setOwnerUserId(null);
            row.setPublishedAt(null);
            visible.add(row);
        }
        return visible;
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
        // 先按 id 查出文档，校验权限与项目一致性
        java.util.Map<String, RequirementDoc> docs = new java.util.HashMap<String, RequirementDoc>();
        String commonReqId = null;
        for (ReqDocReorderRequest.Item item : req.getItems()) {
            RequirementDoc d = get(workspaceId, item.getId());
            projectAccess.assertWrite(workspaceId, userId, d.getReqId());
            if (commonReqId == null) {
                commonReqId = d.getReqId();
            } else if (!commonReqId.equals(d.getReqId())) {
                throw AppException.badRequest("只能对同一项目下的文档排序");
            }
            docs.put(d.getId(), d);
        }
        // 落库
        for (ReqDocReorderRequest.Item item : req.getItems()) {
            RequirementDoc d = docs.get(item.getId());
            String newParentId = item.getParentId();
            // 父文档必须同项目；空表示根级
            if (newParentId != null && !newParentId.isEmpty()) {
                RequirementDoc parent = docMapper.selectById(newParentId);
                if (parent == null || !workspaceId.equals(parent.getWorkspaceId())) {
                    throw AppException.badRequest("父文档不存在：" + newParentId);
                }
                if (!commonReqId.equals(parent.getReqId())) {
                    throw AppException.badRequest("父文档必须属于同一项目");
                }
                // 不能形成环：新父级不能是当前文档本身或其任何后代
                if (item.getId().equals(newParentId) || isDescendant(item.getId(), newParentId, docs)) {
                    throw AppException.badRequest("不能将文档放到自己的子文档下");
                }
            }
            docMapper.updateSortOrder(workspaceId, item.getId(),
                    item.getSortOrder() == null ? 0 : item.getSortOrder(),
                    newParentId == null || newParentId.isEmpty() ? null : newParentId);
        }
        // 记录一条活动：用第一个文档的标题代表这次排序操作
        RequirementDoc first = docs.get(req.getItems().get(0).getId());
        workActivityService.record(workspaceId, WorkActivityService.REQUIREMENT_DOC, first.getId(), userId,
                "update", "调整了文档「" + first.getTitle() + "」的顺序/层级");
    }

    /** 判断 descendant 是否是 ancestor 的后代（仅用于排序时防环） */
    private boolean isDescendant(String ancestorId, String descendantId, java.util.Map<String, RequirementDoc> cache) {
        String cursor = descendantId;
        int guard = 0;
        while (cursor != null && guard++ < 100) {
            RequirementDoc d = cache.get(cursor);
            if (d == null) {
                d = docMapper.selectById(cursor);
                if (d != null) cache.put(cursor, d);
            }
            if (d == null) return false;
            if (ancestorId.equals(d.getParentId())) return true;
            cursor = d.getParentId();
        }
        return false;
    }

    /**
     * 看板拖拽等轻量状态流转：只改状态，不碰正文、不建历史快照、不走整篇乐观锁。
     */
    @Transactional
    public RequirementDoc changeStatus(String userId, String workspaceId, String id, String status) {
        RequirementDoc d = getVisible(workspaceId, userId, id);
        projectAccess.assertWrite(workspaceId, userId, d.getReqId());
        if (!"draft".equals(status) && !"active".equals(status) && !"done".equals(status)) {
            throw AppException.badRequest("文档状态不合法");
        }
        if (!status.equals(d.getStatus())) {
            docMapper.updateStatus(workspaceId, id, status);
            recordChange(userId, workspaceId, id, "状态", d.getStatus(), status);
        }
        return docMapper.selectById(id);
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
        projectAccess.assertWrite(workspaceId, userId, d.getReqId());
        /* 子文档提升到被删文档的父级，避免整棵子树变成孤儿 */
        docMapper.reparentChildren(workspaceId, id, d.getParentId());
        docMapper.deleteDemandLinksByDoc(workspaceId, id);
        docMapper.clearTaskRef(workspaceId, d.getId());
        commentMapper.deleteByDoc(workspaceId, id);
        historyMapper.deleteByDoc(workspaceId, id);
        shareMapper.deleteByDoc(workspaceId, id);
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
            workActivityService.deleteByEntity(workspaceId, WorkActivityService.REQUIREMENT_DOC, docId);
        }
        return docMapper.deleteByReq(workspaceId, reqId);
    }

    /* ---------------- 历史版本 ---------------- */

    /** 版本列表（不含正文）：读取前校验项目可见范围 */
    public List<RequirementDocHistory> history(String workspaceId, String userId, String docId) {
        getVisible(workspaceId, userId, docId);
        return historyMapper.selectByDoc(workspaceId, docId);
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
        projectAccess.assertWrite(workspaceId, userId, d.getReqId());
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
        return docMapper.selectById(docId);
    }

    /**
     * 发布（published=true）或收回发布（false）。
     * 权限：当前项目可写者（含空间 owner/admin）；作者身份不绕过只读限制。
     * 发布不触碰正文与历史，只改 published_at。
     */
    @Transactional
    public RequirementDoc publish(String userId, String workspaceId, String id, boolean published) {
        RequirementDoc d = getVisible(workspaceId, userId, id);
        projectAccess.assertWrite(workspaceId, userId, d.getReqId());
        if (published == (d.getPublishedAt() != null)) {
            return d;
        }
        docMapper.updatePublished(id, published ? java.time.LocalDateTime.now() : null);
        workActivityService.record(workspaceId, WorkActivityService.REQUIREMENT_DOC, id, userId, "update",
                published ? "发布了文档「" + d.getTitle() + "」，成员可见"
                        : "收回了文档「" + d.getTitle() + "」的发布，转为草稿");
        return docMapper.selectById(id);
    }

    /* ---------------- 只读分享 ---------------- */

    private static final int SHARE_DAYS = 30;

    /** 生成/重置分享链接：仅已发布文档可分享；权限同发布 */
    @Transactional
    public ReqDocShare createShare(String userId, String workspaceId, String docId) {
        RequirementDoc d = getVisible(workspaceId, userId, docId);
        projectAccess.assertWrite(workspaceId, userId, d.getReqId());
        if (d.getPublishedAt() == null) {
            throw AppException.badRequest("文档尚未发布，发布后才能生成分享链接");
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
        if (d == null || !share.getWorkspaceId().equals(d.getWorkspaceId()) || d.getPublishedAt() == null) {
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

    public List<ReqDocView> docsOfDemand(String workspaceId, String demandId) {
        return docsOfDemand(workspaceId, demandId, null);
    }

    public List<ReqDocView> docsOfDemand(String workspaceId, String demandId, String userId) {
        Demand demand = demandMapper.selectById(demandId);
        if (demand == null || !workspaceId.equals(demand.getWorkspaceId())) {
            throw AppException.notFound("需求不存在：" + demandId);
        }
        projectAccess.assertView(workspaceId, userId, demand.getReqId());
        List<ReqDocView> rows = docMapper.selectByDemand(workspaceId, demandId);
        String role = projectAccess.roleOf(workspaceId, userId);
        List<ReqDocView> visible = new java.util.ArrayList<ReqDocView>(rows.size());
        for (ReqDocView v : rows) {
            /* 历史关联可能跨项目（文档曾被移动）：按查看人可见范围过滤，避免泄露别的项目的内容 */
            if (userId != null && !projectAccess.canView(workspaceId, userId, v.getReqId())) {
                continue;
            }
            if (!canSeeDraft(v.getOwnerUserId(), v.getPublishedAt(), userId, role)) {
                continue;
            }
            v.setExcerpt(excerptOf(v.getContentBrief()));
            v.setContentBrief(null);
            visible.add(v);
        }
        return visible;
    }

    public List<Map<String, Object>> demandsOfDoc(String workspaceId, String id) {
        get(workspaceId, id);
        return docMapper.selectDemandsByDoc(workspaceId, id);
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
    public java.util.Map<String, Integer> countByReqMap(String workspaceId) {
        java.util.Map<String, Integer> out = new java.util.HashMap<String, Integer>();
        for (java.util.Map<String, Object> row : docMapper.countGroupByReq(workspaceId)) {
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

    private void apply(RequirementDoc d, String reqId, ReqDocSaveRequest req, String userId) {
        String code = Texts.trimToNull(req.getDocType());
        /* 省略分类时编辑沿用原值；新建及旧文档缺省归入其他。显式非法分类必须拒绝。 */
        DocumentType docType = code == null ? DocumentType.parseOrOther(d.getDocType()) : DocumentType.parse(code);
        if (docType == null) {
            throw AppException.badRequest("文档分类不合法");
        }
        d.setDocType(docType.getCode());
        d.setReqId(reqId);
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
        d.setStatus(status == null ? "draft" : status);
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
    }

    /** 父文档必须存在、同项目，且不能形成环 */
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
        if (!reqId.equals(parent.getReqId())) {
            throw AppException.badRequest("上级文档必须属于同一项目");
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

    private String ensureProject(String workspaceId, String reqId) {
        String rid = Texts.trimToNull(reqId);
        if (rid == null) {
            throw AppException.badRequest("请选择所属项目");
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
