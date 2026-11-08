package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.common.Mentions;
import com.hourglass.common.Texts;
import com.hourglass.entity.AppUser;
import com.hourglass.entity.Attachment;
import com.hourglass.entity.Task;
import com.hourglass.entity.TaskComment;
import com.hourglass.entity.TaskLog;
import com.hourglass.entity.WorkspaceMember;
import com.hourglass.mapper.TaskCommentMapper;
import com.hourglass.mapper.TaskLogMapper;
import com.hourglass.mapper.TaskMapper;
import com.hourglass.mapper.UserMapper;
import com.hourglass.mapper.WorkspaceMemberMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 任务评论 / 讨论（N-6）。
 * 与 task_log 分开：时间线记"系统做了什么"，评论记"人说了什么"。
 * 回收站中的任务保留可读（历史讨论可追溯），但不允许再发新评论。
 */
@Service
public class TaskCommentService {

    private static final Logger log = LoggerFactory.getLogger(TaskCommentService.class);
    private static final int MAX_LEN = 500;
    private static final int PREVIEW_LEN = 160;

    private final TaskCommentMapper commentMapper;
    private final TaskMapper taskMapper;
    private final TaskLogMapper logMapper;
    private final UserMapper userMapper;
    private final WorkspaceMemberMapper memberMapper;
    private final NotificationEventService notificationEvents;
    private final ProjectAccessService projectAccess;
    private final TaskWatchService watchService;
    private final AttachmentService attachmentService;

    public TaskCommentService(TaskCommentMapper commentMapper, TaskMapper taskMapper, TaskLogMapper logMapper,
                              UserMapper userMapper, WorkspaceMemberMapper memberMapper,
                              NotificationEventService notificationEvents,
                              ProjectAccessService projectAccess, TaskWatchService watchService,
                              AttachmentService attachmentService) {
        this.commentMapper = commentMapper;
        this.taskMapper = taskMapper;
        this.logMapper = logMapper;
        this.userMapper = userMapper;
        this.memberMapper = memberMapper;
        this.notificationEvents = notificationEvents;
        this.projectAccess = projectAccess;
        this.watchService = watchService;
        this.attachmentService = attachmentService;
    }

    /** 读评论：允许回收站中的任务（保留可读） */
    public List<TaskComment> list(String workspaceId, String taskId) {
        Task t = taskMapper.selectById(taskId);
        if (t == null || !workspaceId.equals(t.getWorkspaceId())) {
            throw AppException.notFound("任务不存在：" + taskId);
        }
        return withAttachments(workspaceId, commentMapper.selectByTaskId(workspaceId, taskId));
    }

    public List<TaskComment> list(String workspaceId, String userId, String taskId) {
        Task t = taskMapper.selectById(taskId);
        if (t == null || !workspaceId.equals(t.getWorkspaceId())) {
            throw AppException.notFound("任务不存在：" + taskId);
        }
        projectAccess.assertViewTask(workspaceId, userId, t);
        return withAttachments(workspaceId, commentMapper.selectByTaskId(workspaceId, taskId));
    }

    /** 一次取回整条讨论的附件，按评论分桶，避免逐条查询 */
    private List<TaskComment> withAttachments(String workspaceId, List<TaskComment> comments) {
        if (comments == null || comments.isEmpty()) {
            return comments == null ? Collections.<TaskComment>emptyList() : comments;
        }
        List<String> ids = new ArrayList<String>(comments.size());
        for (TaskComment c : comments) {
            ids.add(String.valueOf(c.getId()));
        }
        Map<String, List<Attachment>> byTarget = new HashMap<String, List<Attachment>>();
        for (Attachment a : attachmentService.commentsAttachments(workspaceId, ids)) {
            List<Attachment> bucket = byTarget.get(a.getTargetId());
            if (bucket == null) {
                bucket = new ArrayList<Attachment>();
                byTarget.put(a.getTargetId(), bucket);
            }
            bucket.add(a);
        }
        for (TaskComment c : comments) {
            c.setAttachments(byTarget.containsKey(String.valueOf(c.getId()))
                    ? byTarget.get(String.valueOf(c.getId()))
                    : Collections.<Attachment>emptyList());
        }
        return comments;
    }

    /** 不传结构化提及时的兼容入口（仅解析正文里的 @名字） */
    public TaskComment create(String userId, String workspaceId, String taskId, String content) {
        return create(userId, workspaceId, taskId, content, null);
    }

    @Transactional
    public TaskComment create(String userId, String workspaceId, String taskId, String content,
                              List<String> structuredMentionIds) {
        Task t = taskMapper.selectById(taskId);
        if (t == null || !workspaceId.equals(t.getWorkspaceId())) {
            throw AppException.notFound("任务不存在：" + taskId);
        }
        projectAccess.assertWrite(workspaceId, userId, t.getReqId());
        if (t.getDeletedAt() != null) {
            throw AppException.badRequest("任务在回收站中，不能发表评论（可先恢复）");
        }
        String text = Texts.trimToNull(content);
        if (text == null) {
            throw AppException.badRequest("评论内容不能为空");
        }
        AppUser u = userMapper.selectById(userId);
        String author = (u == null || Texts.trimToNull(u.getDisplayName()) == null) ? "未知" : u.getDisplayName();

        TaskComment c = new TaskComment();
        c.setTaskId(taskId);
        c.setWorkspaceId(workspaceId);
        c.setAuthorId(userId);
        c.setAuthorName(author);
        c.setContent(Texts.cut(text, MAX_LEN));
        commentMapper.insert(c);
        c.setCurrentAuthorName(author);
        c.setAttachments(Collections.<Attachment>emptyList());

        TaskLog taskLog = new TaskLog();
        taskLog.setTaskId(taskId);
        taskLog.setWorkspaceId(workspaceId);
        taskLog.setActorId(userId);
        taskLog.setAction("update");
        taskLog.setDetail(Texts.cut(author + " 发表评论：" + Texts.cut(text, 80), 250));
        logMapper.insert(taskLog);

        List<String> mentioned = mentionTargets(text, structuredMentionIds, workspaceId, userId);
        for (String mentionedUserId : mentioned) {
            notificationEvents.notify(mentionedUserId, workspaceId,
                    UserNotificationPreferenceService.TASK_COMMENT,
                    "「" + t.getTitle() + "」提到了你",
                    author + "：" + Texts.cut(text, PREVIEW_LEN), taskId, t.getReqId());
        }
        // 定向通知负责人本人；已在 @ 提及里通知过的人不再重复
        boolean ownerNotified = false;
        if (t.getOwnerUserId() != null && !t.getOwnerUserId().equals(userId)
                && !mentioned.contains(t.getOwnerUserId())) {
            notificationEvents.notify(t.getOwnerUserId(), workspaceId,
                    UserNotificationPreferenceService.TASK_COMMENT,
                    "「" + t.getTitle() + "」有新评论",
                    author + "：" + Texts.cut(text, PREVIEW_LEN), taskId, t.getReqId());
            ownerNotified = true;
        }
        /* 关注者：被 @ 或身为负责人的已经收到更具体的通知，不再重复 */
        java.util.Set<String> skip = new java.util.HashSet<String>(mentioned);
        if (ownerNotified) {
            skip.add(t.getOwnerUserId());
        }
        watchService.notifyWatchers(workspaceId, taskId, userId,
                UserNotificationPreferenceService.TASK_WATCH,
                "「" + t.getTitle() + "」有新评论",
                author + "：" + Texts.cut(text, PREVIEW_LEN), t.getReqId(), skip);
        return c;
    }

    /**
     * 正文 @名字 与前端选中的成员合并去重；结构化 ID 只接受空间成员，
     * 这样重名成员也能精确通知，同时避免伪造 ID 跨空间打扰他人。
     */
    private List<String> mentionTargets(String text, List<String> structuredIds,
                                        String workspaceId, String authorId) {
        List<WorkspaceMember> members;
        try {
            members = memberMapper.selectByWorkspace(workspaceId);
        } catch (Exception e) {
            log.warn("评论 @提及解析失败（不影响评论本身）：workspace={}", workspaceId, e);
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

    /** @提及候选：只返回对该任务所在项目可见的空间成员 */
    public List<WorkspaceMember> mentionCandidates(String userId, String workspaceId, String taskId) {
        Task t = taskMapper.selectById(taskId);
        if (t == null || !workspaceId.equals(t.getWorkspaceId())) {
            throw AppException.notFound("任务不存在：" + taskId);
        }
        projectAccess.assertViewTask(workspaceId, userId, t);
        return projectAccess.filterVisibleMembers(workspaceId,
                memberMapper.selectByWorkspace(workspaceId), t.getReqId());
    }

    @Transactional
    public void delete(String userId, String workspaceId, Long id) {
        TaskComment c = commentMapper.selectById(id);
        if (c == null || !workspaceId.equals(c.getWorkspaceId())) {
            throw AppException.notFound("评论不存在：" + id);
        }
        if (!userId.equals(c.getAuthorId())) {
            throw new AppException(403, "只能删除自己的评论");
        }
        Task t = taskMapper.selectById(c.getTaskId());
        if (t != null) {
            projectAccess.assertWrite(workspaceId, userId, t.getReqId());
        }
        /* 评论附件跟着评论走：记录随事务，文件提交后再删 */
        attachmentService.deleteByTarget(workspaceId, String.valueOf(id), AttachmentService.KIND_COMMENT);
        commentMapper.deleteById(id);
    }
}
