package com.devstudio.kanban.service;

import com.devstudio.kanban.common.AppException;
import com.devstudio.kanban.common.Texts;
import com.devstudio.kanban.entity.AppUser;
import com.devstudio.kanban.entity.Task;
import com.devstudio.kanban.entity.TaskComment;
import com.devstudio.kanban.entity.TaskLog;
import com.devstudio.kanban.mapper.TaskCommentMapper;
import com.devstudio.kanban.mapper.TaskLogMapper;
import com.devstudio.kanban.mapper.TaskMapper;
import com.devstudio.kanban.mapper.UserMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

/**
 * 任务评论 / 讨论（N-6）。
 * 与 task_log 分开：时间线记"系统做了什么"，评论记"人说了什么"。
 * 回收站中的任务保留可读（历史讨论可追溯），但不允许再发新评论。
 */
@Service
public class TaskCommentService {

    private static final int MAX_LEN = 500;

    private final TaskCommentMapper commentMapper;
    private final TaskMapper taskMapper;
    private final TaskLogMapper logMapper;
    private final UserMapper userMapper;
    private final NotificationEventService notificationEvents;
    private final ProjectAccessService projectAccess;

    public TaskCommentService(TaskCommentMapper commentMapper, TaskMapper taskMapper, TaskLogMapper logMapper,
                              UserMapper userMapper, NotificationEventService notificationEvents,
                              ProjectAccessService projectAccess) {
        this.commentMapper = commentMapper;
        this.taskMapper = taskMapper;
        this.logMapper = logMapper;
        this.userMapper = userMapper;
        this.notificationEvents = notificationEvents;
        this.projectAccess = projectAccess;
    }

    /** 读评论：允许回收站中的任务（保留可读） */
    public List<TaskComment> list(String workspaceId, String taskId) {
        Task t = taskMapper.selectById(taskId);
        if (t == null || !workspaceId.equals(t.getWorkspaceId())) {
            throw AppException.notFound("任务不存在：" + taskId);
        }
        return commentMapper.selectByTaskId(workspaceId, taskId);
    }

    public List<TaskComment> list(String workspaceId, String userId, String taskId) {
        Task t = taskMapper.selectById(taskId);
        if (t == null || !workspaceId.equals(t.getWorkspaceId())) {
            throw AppException.notFound("任务不存在：" + taskId);
        }
        projectAccess.assertViewTask(workspaceId, userId, t);
        return commentMapper.selectByTaskId(workspaceId, taskId);
    }

    @Transactional
    public TaskComment create(String userId, String workspaceId, String taskId, String content) {
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

        TaskLog taskLog = new TaskLog();
        taskLog.setTaskId(taskId);
        taskLog.setWorkspaceId(workspaceId);
        taskLog.setActorId(userId);
        taskLog.setAction("update");
        taskLog.setDetail(Texts.cut(author + " 发表评论：" + Texts.cut(text, 80), 250));
        logMapper.insert(taskLog);

        // 定向通知负责人本人（不是自己发的才通知）
        if (t.getOwnerUserId() != null && !t.getOwnerUserId().equals(userId)) {
            notificationEvents.notify(t.getOwnerUserId(), workspaceId,
                    UserNotificationPreferenceService.TASK_COMMENT,
                    "「" + t.getTitle() + "」有新评论",
                    author + "：" + Texts.cut(text, 160), taskId, t.getReqId());
        }
        return c;
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
        commentMapper.deleteById(id);
    }
}
