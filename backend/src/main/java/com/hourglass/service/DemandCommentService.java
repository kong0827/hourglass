package com.hourglass.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.hourglass.common.AppException;
import com.hourglass.common.Ids;
import com.hourglass.common.Mentions;
import com.hourglass.common.Texts;
import com.hourglass.dto.DemandCommentRequest;
import com.hourglass.dto.DemandCommentView;
import com.hourglass.dto.TaskSaveRequest;
import com.hourglass.entity.AppUser;
import com.hourglass.entity.Demand;
import com.hourglass.entity.DemandComment;
import com.hourglass.entity.Task;
import com.hourglass.entity.WorkspaceMember;
import com.hourglass.mapper.DemandCommentMapper;
import com.hourglass.mapper.DemandMapper;
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
 * 需求池评论：查看需求即可阅读；当前项目可写者可发表、回复、解决、删除评论。
 * 支持一层回复、@提及站内通知、评论转工作项并回链。评论区随需求硬删除一起清理。
 */
@Service
public class DemandCommentService {

    private static final Logger log = LoggerFactory.getLogger(DemandCommentService.class);
    private static final int PREVIEW_LEN = 120;
    private static final ObjectMapper JSON = new ObjectMapper();

    private final DemandCommentMapper commentMapper;
    private final DemandMapper demandMapper;
    private final UserMapper userMapper;
    private final WorkspaceMemberMapper memberMapper;
    private final ProjectAccessService projectAccess;
    private final AuditService auditService;
    private final NotificationEventService notificationEvents;
    private final TaskCommandService taskCommandService;
    private final DemandWatchService demandWatch;

    public DemandCommentService(DemandCommentMapper commentMapper,
                                DemandMapper demandMapper,
                                UserMapper userMapper,
                                WorkspaceMemberMapper memberMapper,
                                ProjectAccessService projectAccess,
                                AuditService auditService,
                                NotificationEventService notificationEvents,
                                TaskCommandService taskCommandService,
                                DemandWatchService demandWatch) {
        this.commentMapper = commentMapper;
        this.demandMapper = demandMapper;
        this.userMapper = userMapper;
        this.memberMapper = memberMapper;
        this.projectAccess = projectAccess;
        this.auditService = auditService;
        this.notificationEvents = notificationEvents;
        this.taskCommandService = taskCommandService;
        this.demandWatch = demandWatch;
    }

    public com.hourglass.dto.PageResult<DemandCommentView> list(String workspaceId, String userId, String demandId,
                                                                 boolean unresolvedOnly, int offset, int limit) {
        Demand demand = requireVisibleDemand(workspaceId, userId, demandId);
        int safeOffset = Math.max(0, offset);
        int safeLimit = Math.max(1, Math.min(100, limit));
        int total = commentMapper.countTopByDemand(workspaceId, demandId, unresolvedOnly);
        List<DemandComment> tops = total <= safeOffset ? new ArrayList<DemandComment>()
                : commentMapper.selectTopByDemand(workspaceId, demandId, unresolvedOnly, safeOffset, safeLimit);
        List<String> parentIds = new ArrayList<String>();
        for (DemandComment t : tops) {
            parentIds.add(t.getId());
        }
        List<DemandComment> replies = parentIds.isEmpty() ? Collections.<DemandComment>emptyList()
                : commentMapper.selectRepliesByParents(workspaceId, demandId, parentIds);

        List<DemandComment> all = new ArrayList<DemandComment>(tops);
        all.addAll(replies);
        Map<String, String> userNames = namesOf(all);
        boolean canWrite = projectAccess.canWrite(workspaceId, userId, demand.getReqId());

        Map<String, List<DemandCommentView>> replyMap = new HashMap<String, List<DemandCommentView>>();
        for (DemandComment r : replies) {
            List<DemandCommentView> bucket = replyMap.get(r.getParentId());
            if (bucket == null) {
                bucket = new ArrayList<DemandCommentView>();
                replyMap.put(r.getParentId(), bucket);
            }
            bucket.add(toView(r, userNames, canWrite));
        }
        List<DemandCommentView> views = new ArrayList<DemandCommentView>(tops.size());
        for (DemandComment t : tops) {
            DemandCommentView v = toView(t, userNames, canWrite);
            v.setReplies(replyMap.get(t.getId()));
            views.add(v);
        }
        return com.hourglass.dto.PageResult.of(views, total, safeOffset, safeLimit);
    }

    public Map<String, Integer> counts(String workspaceId, String userId, String demandId) {
        requireVisibleDemand(workspaceId, userId, demandId);
        Map<String, Integer> out = new HashMap<String, Integer>();
        out.put("total", commentMapper.countByDemand(workspaceId, demandId));
        out.put("unresolved", commentMapper.countUnresolvedByDemand(workspaceId, demandId));
        return out;
    }

    @Transactional
    public DemandCommentView create(String userId, String workspaceId, String demandId, DemandCommentRequest req) {
        Demand demand = requireVisibleDemand(workspaceId, userId, demandId);
        projectAccess.assertWrite(workspaceId, userId, demand.getReqId());
        String content = Texts.trimToNull(req.getContent());
        if (content == null) {
            throw AppException.badRequest("评论内容不能为空");
        }
        String parentId = Texts.trimToNull(req.getParentId());
        DemandComment parent = null;
        if (parentId != null) {
            parent = commentMapper.selectById(parentId);
            if (parent == null || !workspaceId.equals(parent.getWorkspaceId())
                    || !demandId.equals(parent.getDemandId())) {
                throw AppException.notFound("父评论不存在：" + parentId);
            }
            if (parent.getParentId() != null) {
                throw AppException.badRequest("只支持一层回复");
            }
        }
        List<String> mentioned = mentionTargets(content, req.getMentionUserIds(), workspaceId, userId);
        DemandComment c = new DemandComment();
        c.setId(Ids.gen("DMC"));
        c.setWorkspaceId(workspaceId);
        c.setDemandId(demandId);
        c.setUserId(userId);
        c.setContent(content);
        c.setParentId(parentId);
        c.setMentions(toJson(mentioned));
        commentMapper.insert(c);

        String author = displayName(userId);
        auditService.recordCurrent(workspaceId, "comment_create", "demand_comment", c.getId(), demand.getTitle(), true,
                "在需求「" + demand.getTitle() + "」下" + (parent == null ? "发表评论" : "回复评论"), null);

        notifyComment(demand, c, parent, author, content, mentioned, userId);
        return toView(c, workspaceId, userId, demand.getReqId());
    }

    @Transactional
    public DemandCommentView resolve(String userId, String workspaceId, String demandId, String commentId,
                                     boolean resolved) {
        Demand demand = requireVisibleDemand(workspaceId, userId, demandId);
        projectAccess.assertWrite(workspaceId, userId, demand.getReqId());
        DemandComment c = requireComment(workspaceId, demandId, commentId);
        LocalDateTime now = resolved ? LocalDateTime.now() : null;
        String by = resolved ? userId : null;
        commentMapper.updateResolve(workspaceId, commentId, now, by);
        c.setResolvedAt(now);
        c.setResolvedBy(by);
        auditService.recordCurrent(workspaceId, resolved ? "comment_resolve" : "comment_reopen",
                "demand_comment", commentId, demand.getTitle(), true,
                (resolved ? "解决" : "重新打开") + "需求「" + demand.getTitle() + "」下的一条评论", null);
        return toView(c, workspaceId, userId, demand.getReqId());
    }

    @Transactional
    public Map<String, Object> toTask(String userId, String workspaceId, String demandId, String commentId) {
        Demand demand = requireVisibleDemand(workspaceId, userId, demandId);
        projectAccess.assertWrite(workspaceId, userId, demand.getReqId());
        DemandComment c = requireComment(workspaceId, demandId, commentId);
        if (Texts.trimToNull(c.getTaskId()) != null) {
            throw AppException.badRequest("该评论已转为工作项");
        }
        if ("closed".equals(demand.getStatus())) {
            throw AppException.badRequest("已关闭的需求不能把评论转为工作项");
        }
        String title = firstSentence(c.getContent());
        StringBuilder desc = new StringBuilder(c.getContent()).append("\n\n");
        desc.append("来源：需求「").append(demand.getTitle()).append("」的评论");
        TaskSaveRequest req = new TaskSaveRequest();
        req.setTitle(Texts.cut(title, 60));
        req.setDescription(desc.toString());
        req.setReqId(demand.getReqId());
        req.setDemandId(demand.getId());
        req.setCategoryId(demand.getCategoryId());
        req.setPriority(demand.getPriority());
        req.setBoardColumn("backlog");
        req.setItemType("task");
        Task task = taskCommandService.create(userId, workspaceId, req);
        commentMapper.updateTaskId(workspaceId, commentId, task.getId());
        auditService.recordCurrent(workspaceId, "comment_to_task", "demand_comment", commentId,
                demand.getTitle(), true,
                "把需求「" + demand.getTitle() + "」下的评论转为工作项 " + task.getId(), null);
        Map<String, Object> out = new HashMap<String, Object>();
        out.put("taskId", task.getId());
        out.put("title", task.getTitle());
        return out;
    }

    @Transactional
    public void delete(String userId, String workspaceId, String demandId, String commentId) {
        Demand demand = requireVisibleDemand(workspaceId, userId, demandId);
        DemandComment c = requireComment(workspaceId, demandId, commentId);
        projectAccess.assertWrite(workspaceId, userId, demand.getReqId());
        if (c.getParentId() == null) {
            commentMapper.deleteByParent(workspaceId, demandId, commentId);
        }
        commentMapper.delete(workspaceId, commentId);
        auditService.recordCurrent(workspaceId, "comment_delete", "demand_comment", commentId,
                demand.getTitle(), true, "删除需求「" + demand.getTitle() + "」下的一条评论", null);
    }

    public List<WorkspaceMember> mentionCandidates(String userId, String workspaceId, String demandId) {
        Demand demand = requireVisibleDemand(workspaceId, userId, demandId);
        return projectAccess.filterVisibleMembers(workspaceId,
                memberMapper.selectByWorkspace(workspaceId), demand.getReqId());
    }

    private void notifyComment(Demand demand, DemandComment c, DemandComment parent,
                               String author, String content, List<String> mentioned, String actorId) {
        String preview = author + "：" + Texts.cut(content, PREVIEW_LEN);
        Set<String> skip = new HashSet<String>(mentioned);
        for (String uid : mentioned) {
            notificationEvents.notifyLinked(uid, demand.getWorkspaceId(),
                    UserNotificationPreferenceService.TASK_COMMENT,
                    "需求「" + demand.getTitle() + "」提到了你", preview, "demand", demand.getId(), demand.getReqId());
        }
        String creator = Texts.trimToNull(demand.getCreatedBy());
        if (creator != null && !creator.equals(actorId) && !skip.contains(creator)) {
            notificationEvents.notifyLinked(creator, demand.getWorkspaceId(),
                    UserNotificationPreferenceService.TASK_COMMENT,
                    "需求「" + demand.getTitle() + "」有新评论", preview, "demand", demand.getId(), demand.getReqId());
            skip.add(creator);
        }
        if (parent != null) {
            String parentAuthor = Texts.trimToNull(parent.getUserId());
            if (parentAuthor != null && !parentAuthor.equals(actorId) && !skip.contains(parentAuthor)) {
                notificationEvents.notifyLinked(parentAuthor, demand.getWorkspaceId(),
                        UserNotificationPreferenceService.TASK_COMMENT,
                        "需求「" + demand.getTitle() + "」的评论有回复", preview,
                        "demand", demand.getId(), demand.getReqId());
                skip.add(parentAuthor);
            }
        }
        /* @ 提及、提交人与被回复人已单独收到评论通知，关注者只补发一次 */
        demandWatch.notifyWatchers(demand, actorId, UserNotificationPreferenceService.DEMAND_WATCH,
                "需求「" + demand.getTitle() + "」" + (parent == null ? "有新评论" : "的评论有回复"),
                preview, skip);
    }

    private List<String> mentionTargets(String text, List<String> structuredIds,
                                        String workspaceId, String authorId) {
        List<WorkspaceMember> members;
        try {
            members = memberMapper.selectByWorkspace(workspaceId);
        } catch (Exception e) {
            log.warn("需求评论 @提及解析失败（不影响评论本身）：workspace={}", workspaceId, e);
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

    private Demand requireVisibleDemand(String workspaceId, String userId, String demandId) {
        Demand demand = demandMapper.selectById(demandId);
        if (demand == null || !workspaceId.equals(demand.getWorkspaceId())) {
            throw AppException.notFound("需求不存在：" + demandId);
        }
        projectAccess.assertView(workspaceId, userId, demand.getReqId());
        return demand;
    }

    private DemandComment requireComment(String workspaceId, String demandId, String commentId) {
        DemandComment c = commentMapper.selectById(commentId);
        if (c == null || !workspaceId.equals(c.getWorkspaceId()) || !demandId.equals(c.getDemandId())) {
            throw AppException.notFound("评论不存在：" + commentId);
        }
        return c;
    }

    private Map<String, String> namesOf(List<DemandComment> rows) {
        Set<String> userIds = new LinkedHashSet<String>();
        for (DemandComment row : rows) {
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

    private DemandCommentView toView(DemandComment c, String workspaceId, String actorId, String demandReqId) {
        Map<String, String> names = namesOf(Collections.singletonList(c));
        return toView(c, names, projectAccess.canWrite(workspaceId, actorId, demandReqId));
    }

    private DemandCommentView toView(DemandComment c, Map<String, String> names, boolean canWrite) {
        DemandCommentView v = new DemandCommentView();
        v.setId(c.getId());
        v.setUserId(c.getUserId());
        v.setUserName(displayName(c.getUserId(), names));
        v.setContent(c.getContent());
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
            return "需求评论";
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
        return title.isEmpty() ? "需求评论" : title;
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
