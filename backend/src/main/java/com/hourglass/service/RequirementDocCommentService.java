package com.hourglass.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.hourglass.common.AppException;
import com.hourglass.common.Ids;
import com.hourglass.common.Mentions;
import com.hourglass.common.Texts;
import com.hourglass.dto.ReqDocCommentRequest;
import com.hourglass.dto.ReqDocCommentView;
import com.hourglass.dto.TaskSaveRequest;
import com.hourglass.entity.AppUser;
import com.hourglass.entity.RequirementDoc;
import com.hourglass.entity.RequirementDocComment;
import com.hourglass.entity.Task;
import com.hourglass.entity.WorkspaceMember;
import com.hourglass.mapper.RequirementDocCommentMapper;
import com.hourglass.mapper.RequirementDocMapper;
import com.hourglass.mapper.UserMapper;
import com.hourglass.mapper.WorkspaceMemberMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 文档评论：查看文档即可阅读；当前项目可写者可发表、回复、解决、删除评论。
 * 支持一层回复、@提及站内通知、评论转工作项并回链。
 */
@Service
public class RequirementDocCommentService {

    private static final Logger log = LoggerFactory.getLogger(RequirementDocCommentService.class);
    private static final int PREVIEW_LEN = 120;
    private static final ObjectMapper JSON = new ObjectMapper();

    private final RequirementDocCommentMapper commentMapper;
    private final RequirementDocMapper docMapper;
    private final UserMapper userMapper;
    private final WorkspaceMemberMapper memberMapper;
    private final ProjectAccessService projectAccess;
    private final WorkActivityService workActivityService;
    private final AuditService auditService;
    private final NotificationEventService notificationEvents;
    private final TaskCommandService taskCommandService;

    public RequirementDocCommentService(RequirementDocCommentMapper commentMapper,
                                        RequirementDocMapper docMapper,
                                        UserMapper userMapper,
                                        WorkspaceMemberMapper memberMapper,
                                        ProjectAccessService projectAccess,
                                        WorkActivityService workActivityService,
                                        AuditService auditService,
                                        NotificationEventService notificationEvents,
                                        TaskCommandService taskCommandService) {
        this.commentMapper = commentMapper;
        this.docMapper = docMapper;
        this.userMapper = userMapper;
        this.memberMapper = memberMapper;
        this.projectAccess = projectAccess;
        this.workActivityService = workActivityService;
        this.auditService = auditService;
        this.notificationEvents = notificationEvents;
        this.taskCommandService = taskCommandService;
    }

    public com.hourglass.dto.PageResult<ReqDocCommentView> list(String workspaceId, String userId, String docId,
                                                                 boolean unresolvedOnly, int offset, int limit) {
        RequirementDoc doc = requireVisibleDoc(workspaceId, userId, docId);
        int safeOffset = Math.max(0, offset);
        int safeLimit = Math.max(1, Math.min(100, limit));
        int total = commentMapper.countTopByDoc(workspaceId, docId, unresolvedOnly);
        List<RequirementDocComment> tops = total <= safeOffset ? new ArrayList<RequirementDocComment>()
                : commentMapper.selectTopByDoc(workspaceId, docId, unresolvedOnly, safeOffset, safeLimit);
        List<String> parentIds = new ArrayList<String>();
        for (RequirementDocComment t : tops) {
            parentIds.add(t.getId());
        }
        List<RequirementDocComment> replies = parentIds.isEmpty() ? Collections.<RequirementDocComment>emptyList()
                : commentMapper.selectRepliesByParents(workspaceId, docId, parentIds);

        List<RequirementDocComment> all = new ArrayList<RequirementDocComment>(tops);
        all.addAll(replies);
        Map<String, String> userNames = namesOf(all);
        boolean canWrite = projectAccess.canWrite(workspaceId, userId, doc.getReqId());

        Map<String, List<ReqDocCommentView>> replyMap = new HashMap<String, List<ReqDocCommentView>>();
        for (RequirementDocComment r : replies) {
            List<ReqDocCommentView> bucket = replyMap.get(r.getParentId());
            if (bucket == null) {
                bucket = new ArrayList<ReqDocCommentView>();
                replyMap.put(r.getParentId(), bucket);
            }
            bucket.add(toView(r, userNames, canWrite));
        }
        List<ReqDocCommentView> views = new ArrayList<ReqDocCommentView>(tops.size());
        for (RequirementDocComment t : tops) {
            ReqDocCommentView v = toView(t, userNames, canWrite);
            v.setReplies(replyMap.get(t.getId()));
            views.add(v);
        }
        return com.hourglass.dto.PageResult.of(views, total, safeOffset, safeLimit);
    }

    public Map<String, Integer> counts(String workspaceId, String userId, String docId) {
        requireVisibleDoc(workspaceId, userId, docId);
        Map<String, Integer> out = new HashMap<String, Integer>();
        out.put("total", commentMapper.countByDoc(workspaceId, docId));
        out.put("unresolved", commentMapper.countUnresolvedByDoc(workspaceId, docId));
        return out;
    }

    @Transactional
    public ReqDocCommentView create(String userId, String workspaceId, String docId, ReqDocCommentRequest req) {
        RequirementDoc doc = requireVisibleDoc(workspaceId, userId, docId);
        projectAccess.assertWrite(workspaceId, userId, doc.getReqId());
        String content = Texts.trimToNull(req.getContent());
        if (content == null) {
            throw AppException.badRequest("评论内容不能为空");
        }
        String parentId = Texts.trimToNull(req.getParentId());
        RequirementDocComment parent = null;
        if (parentId != null) {
            parent = commentMapper.selectById(parentId);
            if (parent == null || !workspaceId.equals(parent.getWorkspaceId()) || !docId.equals(parent.getDocId())) {
                throw AppException.notFound("父评论不存在：" + parentId);
            }
            if (parent.getParentId() != null) {
                throw AppException.badRequest("只支持一层回复");
            }
        }
        List<String> mentioned = mentionTargets(content, req.getMentionUserIds(), workspaceId, userId);
        RequirementDocComment c = new RequirementDocComment();
        c.setId(Ids.gen("DC"));
        c.setWorkspaceId(workspaceId);
        c.setDocId(docId);
        c.setUserId(userId);
        c.setContent(content);
        c.setQuoteText(Texts.cut(Texts.trimToNull(req.getQuoteText()), 500));
        c.setParentId(parentId);
        c.setMentions(toJson(mentioned));
        commentMapper.insert(c);

        String author = displayName(userId);
        workActivityService.record(workspaceId, WorkActivityService.REQUIREMENT_DOC, docId, userId,
                "update", parent == null ? "发表了评论" : "回复了评论");
        auditService.recordCurrent(workspaceId, "comment_create", "comment", c.getId(), doc.getTitle(), true,
                "在文档「" + doc.getTitle() + "」下" + (parent == null ? "发表评论" : "回复评论"), null);

        notifyComment(doc, c, parent, author, content, mentioned, userId);
        return toView(c, workspaceId, userId, doc.getReqId());
    }

    @Transactional
    public ReqDocCommentView resolve(String userId, String workspaceId, String docId, String commentId,
                                     boolean resolved) {
        RequirementDoc doc = requireVisibleDoc(workspaceId, userId, docId);
        projectAccess.assertWrite(workspaceId, userId, doc.getReqId());
        RequirementDocComment c = requireComment(workspaceId, docId, commentId);
        LocalDateTime now = resolved ? LocalDateTime.now() : null;
        String by = resolved ? userId : null;
        commentMapper.updateResolve(workspaceId, commentId, now, by);
        c.setResolvedAt(now);
        c.setResolvedBy(by);
        workActivityService.record(workspaceId, WorkActivityService.REQUIREMENT_DOC, docId, userId,
                "update", resolved ? "解决了一条评论" : "重新打开了一条评论");
        auditService.recordCurrent(workspaceId, resolved ? "comment_resolve" : "comment_reopen",
                "comment", commentId, doc.getTitle(), true,
                (resolved ? "解决" : "重新打开") + "文档「" + doc.getTitle() + "」下的一条评论", null);
        return toView(c, workspaceId, userId, doc.getReqId());
    }

    @Transactional
    public Map<String, Object> toTask(String userId, String workspaceId, String docId, String commentId) {
        RequirementDoc doc = requireVisibleDoc(workspaceId, userId, docId);
        projectAccess.assertWrite(workspaceId, userId, doc.getReqId());
        RequirementDocComment c = requireComment(workspaceId, docId, commentId);
        if (Texts.trimToNull(c.getTaskId()) != null) {
            throw AppException.badRequest("该评论已转为工作项");
        }
        String title = firstSentence(c.getContent());
        StringBuilder desc = new StringBuilder();
        if (Texts.trimToNull(c.getQuoteText()) != null) {
            desc.append("> ").append(c.getQuoteText().replace("\n", "\n> ")).append("\n\n");
        }
        desc.append(c.getContent()).append("\n\n");
        desc.append("来源：文档「").append(doc.getTitle()).append("」的评论");
        TaskSaveRequest req = new TaskSaveRequest();
        req.setTitle(Texts.cut(title, 60));
        req.setDescription(desc.toString());
        req.setReqId(doc.getReqId());
        req.setReqDocId(docId);
        req.setBoardColumn("backlog");
        req.setItemType("task");
        Task task = taskCommandService.create(userId, workspaceId, req);
        commentMapper.updateTaskId(workspaceId, commentId, task.getId());
        workActivityService.record(workspaceId, WorkActivityService.REQUIREMENT_DOC, docId, userId,
                "update", "把评论转为工作项「" + task.getTitle() + "」");
        auditService.recordCurrent(workspaceId, "comment_to_task", "comment", commentId, doc.getTitle(), true,
                "把文档「" + doc.getTitle() + "」下的评论转为工作项 " + task.getId(), null);
        Map<String, Object> out = new HashMap<String, Object>();
        out.put("taskId", task.getId());
        out.put("title", task.getTitle());
        return out;
    }

    @Transactional
    public void delete(String userId, String workspaceId, String docId, String commentId) {
        RequirementDoc doc = requireVisibleDoc(workspaceId, userId, docId);
        RequirementDocComment c = requireComment(workspaceId, docId, commentId);
        projectAccess.assertWrite(workspaceId, userId, doc.getReqId());
        if (c.getParentId() == null) {
            commentMapper.deleteByParent(workspaceId, docId, commentId);
        }
        commentMapper.delete(workspaceId, commentId);
        workActivityService.record(workspaceId, WorkActivityService.REQUIREMENT_DOC, docId, userId,
                "update", "删除了一条评论");
        auditService.recordCurrent(workspaceId, "comment_delete", "comment", commentId, doc.getTitle(), true,
                "删除文档「" + doc.getTitle() + "」下的一条评论", null);
    }

    public List<WorkspaceMember> mentionCandidates(String userId, String workspaceId, String docId) {
        RequirementDoc doc = requireVisibleDoc(workspaceId, userId, docId);
        return projectAccess.filterVisibleMembers(workspaceId,
                memberMapper.selectByWorkspace(workspaceId), doc.getReqId());
    }

    private void notifyComment(RequirementDoc doc, RequirementDocComment c, RequirementDocComment parent,
                               String author, String content, List<String> mentioned, String actorId) {
        String preview = author + "：" + Texts.cut(content, PREVIEW_LEN);
        Set<String> skip = new HashSet<String>(mentioned);
        for (String uid : mentioned) {
            notificationEvents.notifyLinked(uid, doc.getWorkspaceId(),
                    UserNotificationPreferenceService.TASK_COMMENT,
                    "文档「" + doc.getTitle() + "」提到了你", preview, "doc", doc.getId(), doc.getReqId());
        }
        String owner = Texts.trimToNull(doc.getOwnerUserId());
        if (owner != null && !owner.equals(actorId) && !skip.contains(owner)) {
            notificationEvents.notifyLinked(owner, doc.getWorkspaceId(),
                    UserNotificationPreferenceService.TASK_COMMENT,
                    "文档「" + doc.getTitle() + "」有新评论", preview, "doc", doc.getId(), doc.getReqId());
            skip.add(owner);
        }
        if (parent != null) {
            String parentAuthor = Texts.trimToNull(parent.getUserId());
            if (parentAuthor != null && !parentAuthor.equals(actorId) && !skip.contains(parentAuthor)) {
                notificationEvents.notifyLinked(parentAuthor, doc.getWorkspaceId(),
                        UserNotificationPreferenceService.TASK_COMMENT,
                        "文档「" + doc.getTitle() + "」的评论有回复", preview, "doc", doc.getId(), doc.getReqId());
            }
        }
    }

    private List<String> mentionTargets(String text, List<String> structuredIds,
                                        String workspaceId, String authorId) {
        List<WorkspaceMember> members;
        try {
            members = memberMapper.selectByWorkspace(workspaceId);
        } catch (Exception e) {
            log.warn("文档评论 @提及解析失败（不影响评论本身）：workspace={}", workspaceId, e);
            return Collections.emptyList();
        }
        Set<String> targets = new LinkedHashSet<String>(Mentions.mentionedUserIds(text, members));
        if (structuredIds != null) {
            Set<String> memberIds = new HashSet<String>();
            for (WorkspaceMember m : members) {
                if (m.getUserId() != null) {
                    memberIds.add(m.getUserId());
                }
            }
            for (String id : structuredIds) {
                String candidate = Texts.trimToNull(id);
                if (candidate != null && memberIds.contains(candidate)) {
                    targets.add(candidate);
                }
            }
        }
        targets.remove(authorId);
        return new ArrayList<String>(targets);
    }

    private RequirementDoc requireVisibleDoc(String workspaceId, String userId, String docId) {
        RequirementDoc doc = docMapper.selectById(docId);
        if (doc == null || !workspaceId.equals(doc.getWorkspaceId())) {
            throw AppException.notFound("文档不存在：" + docId);
        }
        projectAccess.assertView(workspaceId, userId, doc.getReqId());
        if (!RequirementDocService.canSeeDraft(doc.getOwnerUserId(), doc.getPublishedAt(), userId,
                projectAccess.roleOf(workspaceId, userId))) {
            throw AppException.notFound("文档不存在：" + docId);
        }
        return doc;
    }

    private RequirementDocComment requireComment(String workspaceId, String docId, String commentId) {
        RequirementDocComment c = commentMapper.selectById(commentId);
        if (c == null || !workspaceId.equals(c.getWorkspaceId()) || !docId.equals(c.getDocId())) {
            throw AppException.notFound("评论不存在：" + commentId);
        }
        return c;
    }

    private Map<String, String> namesOf(List<RequirementDocComment> rows) {
        Set<String> userIds = new LinkedHashSet<String>();
        for (RequirementDocComment row : rows) {
            if (row.getUserId() != null) {
                userIds.add(row.getUserId());
            }
            if (row.getResolvedBy() != null) {
                userIds.add(row.getResolvedBy());
            }
        }
        Map<String, String> names = new HashMap<String, String>();
        if (!userIds.isEmpty()) {
            for (AppUser user : userMapper.selectByIds(new ArrayList<String>(userIds))) {
                names.put(user.getId(), user.getDisplayName());
            }
        }
        return names;
    }

    private ReqDocCommentView toView(RequirementDocComment c, String workspaceId, String actorId, String docReqId) {
        Map<String, String> names = namesOf(Collections.singletonList(c));
        return toView(c, names, projectAccess.canWrite(workspaceId, actorId, docReqId));
    }

    private ReqDocCommentView toView(RequirementDocComment c, Map<String, String> names, boolean canWrite) {
        ReqDocCommentView v = new ReqDocCommentView();
        v.setId(c.getId());
        v.setUserId(c.getUserId());
        v.setUserName(displayName(c.getUserId(), names));
        v.setContent(c.getContent());
        v.setQuoteText(c.getQuoteText());
        v.setParentId(c.getParentId());
        v.setCreatedAt(c.getCreatedAt());
        v.setDeletable(canWrite);
        v.setResolved(c.getResolvedAt() != null);
        v.setResolvedAt(c.getResolvedAt());
        v.setResolvedBy(c.getResolvedBy());
        v.setResolvedByName(c.getResolvedBy() == null ? null : displayName(c.getResolvedBy(), names));
        v.setMentionUserIds(fromJson(c.getMentions()));
        v.setTaskId(c.getTaskId());
        return v;
    }

    private String displayName(String userId) {
        AppUser user = userMapper.selectById(userId);
        return user == null ? "—" : Texts.cut(user.getDisplayName(), 32);
    }

    private String displayName(String userId, Map<String, String> names) {
        if (userId == null) {
            return "—";
        }
        String name = names.get(userId);
        return name == null ? "—" : Texts.cut(name, 32);
    }

    private static String firstSentence(String content) {
        String text = Texts.trimToNull(content);
        if (text == null) {
            return "文档评论";
        }
        text = text.replaceAll("\\s+", " ").trim();
        int cut = text.length();
        for (int i = 0; i < text.length(); i++) {
            char ch = text.charAt(i);
            if (ch == '。' || ch == '！' || ch == '？' || ch == '\n' || ch == '.' || ch == '!' || ch == '?') {
                cut = i + 1;
                break;
            }
        }
        String title = text.substring(0, Math.min(cut, 60)).trim();
        return title.isEmpty() ? "文档评论" : title;
    }

    private static String toJson(List<String> ids) {
        if (ids == null || ids.isEmpty()) {
            return null;
        }
        try {
            return JSON.writeValueAsString(ids);
        } catch (Exception e) {
            return null;
        }
    }

    private static List<String> fromJson(String raw) {
        String text = Texts.trimToNull(raw);
        if (text == null) {
            return Collections.emptyList();
        }
        try {
            return JSON.readValue(text, new TypeReference<List<String>>() {});
        } catch (Exception e) {
            return Collections.emptyList();
        }
    }
}
