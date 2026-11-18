package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.common.Texts;
import com.hourglass.dto.TaskWatcherView;
import com.hourglass.entity.Task;
import com.hourglass.entity.WorkspaceMember;
import com.hourglass.mapper.TaskMapper;
import com.hourglass.mapper.TaskWatchMapper;
import com.hourglass.mapper.WorkspaceMemberMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Collection;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** 任务关注人：关注后新评论、列流转、移入回收站/恢复等事件会通知关注者（字段编辑不打扰）。 */
@Service
public class TaskWatchService {

    private static final Logger log = LoggerFactory.getLogger(TaskWatchService.class);

    private final TaskWatchMapper watchMapper;
    private final TaskMapper taskMapper;
    private final WorkspaceMemberMapper memberMapper;
    private final ProjectAccessService projectAccess;
    private final NotificationEventService notificationEvents;

    public TaskWatchService(TaskWatchMapper watchMapper, TaskMapper taskMapper,
                            WorkspaceMemberMapper memberMapper, ProjectAccessService projectAccess,
                            NotificationEventService notificationEvents) {
        this.watchMapper = watchMapper;
        this.taskMapper = taskMapper;
        this.memberMapper = memberMapper;
        this.projectAccess = projectAccess;
        this.notificationEvents = notificationEvents;
    }

    public Map<String, Object> status(String userId, String workspaceId, String taskId) {
        Task t = requireTask(workspaceId, taskId);
        projectAccess.assertViewTask(workspaceId, userId, t);
        Map<String, Object> res = new LinkedHashMap<String, Object>();
        res.put("watching", watchMapper.countMine(workspaceId, taskId, userId) > 0);
        res.put("count", watchMapper.countByTask(workspaceId, taskId));
        /* 关注名单与「能否代他人管理」随状态返回：抽屉打开时一次拿全，不再单独请求 */
        res.put("canManage", projectAccess.canWrite(workspaceId, userId, t.getReqId()));
        res.put("watchers", watcherViews(workspaceId, taskId));
        return res;
    }

    @Transactional
    public Map<String, Object> watch(String userId, String workspaceId, String taskId) {
        Task t = requireTask(workspaceId, taskId);
        projectAccess.assertViewTask(workspaceId, userId, t);
        if (t.getDeletedAt() != null) {
            throw AppException.badRequest("任务在回收站中，不能关注（可先恢复）");
        }
        watchMapper.insertIgnore(workspaceId, taskId, userId);
        return status(userId, workspaceId, taskId);
    }

    @Transactional
    public Map<String, Object> unwatch(String userId, String workspaceId, String taskId) {
        Task t = requireTask(workspaceId, taskId);
        projectAccess.assertViewTask(workspaceId, userId, t);
        watchMapper.delete(workspaceId, taskId, userId);
        return status(userId, workspaceId, taskId);
    }

    /** 项目可写者代他人关注：成员与项目可见性逐项校验，回收站任务不允许再加人 */
    @Transactional
    public Map<String, Object> addWatcher(String userId, String workspaceId, String taskId, String targetUserId) {
        Task t = requireTask(workspaceId, taskId);
        projectAccess.assertViewTask(workspaceId, userId, t);
        projectAccess.assertWrite(workspaceId, userId, t.getReqId());
        String target = Texts.trimToNull(targetUserId);
        if (target == null) {
            throw AppException.badRequest("请选择关注人");
        }
        if (t.getDeletedAt() != null) {
            throw AppException.badRequest("任务在回收站中，不能添加关注人（可先恢复）");
        }
        requireWatchable(t, target);
        watchMapper.insertIgnore(workspaceId, taskId, target);
        log.info("工作项关注人：workspace={} task={} operator={} target={} action=add",
                workspaceId, taskId, userId, target);
        return status(userId, workspaceId, taskId);
    }

    /** 移除关注人：本人可取消关注，项目可写者可移除他人 */
    @Transactional
    public Map<String, Object> removeWatcher(String userId, String workspaceId, String taskId, String targetUserId) {
        Task t = requireTask(workspaceId, taskId);
        projectAccess.assertViewTask(workspaceId, userId, t);
        String target = Texts.trimToNull(targetUserId);
        if (target == null) {
            throw AppException.badRequest("请选择要移除的关注人");
        }
        if (!target.equals(userId)) {
            projectAccess.assertWrite(workspaceId, userId, t.getReqId());
        }
        watchMapper.delete(workspaceId, taskId, target);
        log.info("工作项关注人：workspace={} task={} operator={} target={} action=remove",
                workspaceId, taskId, userId, target);
        return status(userId, workspaceId, taskId);
    }

    private void requireWatchable(Task t, String target) {
        WorkspaceMember member = memberMapper.selectMember(t.getWorkspaceId(), target);
        if (member == null) {
            throw AppException.badRequest("关注人不是当前空间成员");
        }
        if (!projectAccess.canView(t.getWorkspaceId(), target, t.getReqId())) {
            throw AppException.badRequest("关注人对该项目不可见，无法接收工作项通知");
        }
    }

    /** 关注名单（含姓名）；表缺失/联查异常只返回空，不影响主业务 */
    private List<TaskWatcherView> watcherViews(String workspaceId, String taskId) {
        try {
            List<TaskWatcherView> rows = watchMapper.selectWatchers(workspaceId, taskId);
            return rows == null ? Collections.<TaskWatcherView>emptyList() : rows;
        } catch (Exception e) {
            log.warn("读取任务关注名单失败（不影响主业务）：workspace={} task={}", workspaceId, taskId, e);
            return Collections.emptyList();
        }
    }

    /** 关注人列表；表缺失/读取异常只返回空，不影响主业务通知 */
    public List<String> watcherIds(String workspaceId, String taskId) {
        try {
            return watchMapper.selectUserIdsByTask(workspaceId, taskId);
        } catch (Exception e) {
            log.warn("读取任务关注人失败（不影响主业务）：workspace={} task={}", workspaceId, taskId, e);
            return Collections.emptyList();
        }
    }

    /**
     * 给关注者投递事件通知，已单独通知过的人（负责人/被 @ 者）由调用方放进 skip，避免重复。
     */
    public void notifyWatchers(String workspaceId, String taskId, String actorId, String eventType,
                               String title, String body, String reqId, Collection<String> skip) {
        for (String watcherId : watcherIds(workspaceId, taskId)) {
            if (watcherId.equals(actorId) || (skip != null && skip.contains(watcherId))) {
                continue;
            }
            notificationEvents.notify(watcherId, workspaceId, eventType, title, body, taskId, reqId);
        }
    }

    private Task requireTask(String workspaceId, String taskId) {
        Task t = taskMapper.selectById(taskId);
        if (t == null || !workspaceId.equals(t.getWorkspaceId())) {
            throw AppException.notFound("任务不存在：" + taskId);
        }
        return t;
    }
}
