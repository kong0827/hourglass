package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.common.Texts;
import com.hourglass.dto.SubtaskRequest;
import com.hourglass.entity.Subtask;
import com.hourglass.entity.Task;
import com.hourglass.entity.TaskLog;
import com.hourglass.mapper.SubtaskMapper;
import com.hourglass.mapper.TaskLogMapper;
import com.hourglass.mapper.TaskMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
public class SubtaskService {

    private final SubtaskMapper subtaskMapper;
    private final TaskMapper taskMapper;
    private final TaskLogMapper logMapper;
    private final ProjectAccessService projectAccess;

    public SubtaskService(SubtaskMapper subtaskMapper, TaskMapper taskMapper, TaskLogMapper logMapper,
                          ProjectAccessService projectAccess) {
        this.subtaskMapper = subtaskMapper;
        this.taskMapper = taskMapper;
        this.logMapper = logMapper;
        this.projectAccess = projectAccess;
    }

    public com.hourglass.dto.PageResult<Subtask> list(
            String workspaceId, String userId, String taskId, int offset, int limit) {
        projectAccess.assertViewTask(workspaceId, userId, ensureTask(workspaceId, taskId));
        int safeOffset = Math.max(0, offset);
        int safeLimit = Math.max(1, Math.min(100, limit));
        int total = subtaskMapper.countByTaskId(workspaceId, taskId);
        List<Subtask> items = total <= safeOffset ? new java.util.ArrayList<Subtask>()
                : subtaskMapper.selectPageByTaskId(workspaceId, taskId, safeOffset, safeLimit);
        return com.hourglass.dto.PageResult.of(items, total, safeOffset, safeLimit);
    }

    @Transactional
    public Subtask create(String userId, String workspaceId, String taskId, SubtaskRequest req) {
        projectAccess.assertWrite(workspaceId, userId, ensureTask(workspaceId, taskId).getReqId());
        String title = Texts.trimToNull(req.getTitle());
        if (title == null) {
            throw AppException.badRequest("请填写子任务内容");
        }
        Subtask s = new Subtask();
        s.setTaskId(taskId);
        s.setWorkspaceId(workspaceId);
        s.setTitle(Texts.cut(title, 60));
        s.setDone(Boolean.FALSE);
        subtaskMapper.insert(s);
        log(userId, workspaceId, taskId, "添加子任务「" + s.getTitle() + "」");
        return subtaskMapper.selectById(s.getId());
    }

    @Transactional
    public Subtask update(String userId, String workspaceId, Long id, SubtaskRequest req) {
        Subtask s = subtaskMapper.selectById(id);
        if (s == null || !workspaceId.equals(s.getWorkspaceId())) {
            throw AppException.notFound("子任务不存在：" + id);
        }
        Task parent = ensureTask(workspaceId, s.getTaskId()); // 父任务须仍有效（回收站中的任务不可再改清单）
        projectAccess.assertWrite(workspaceId, userId, parent.getReqId());
        String title = Texts.trimToNull(req.getTitle());
        if (title != null && !title.equals(s.getTitle())) {
            log(userId, workspaceId, s.getTaskId(), "重命名子任务「" + s.getTitle() + "」→「" + Texts.cut(title, 60) + "」");
            s.setTitle(Texts.cut(title, 60));
        }
        Boolean done = req.getDone();
        if (done != null && !done.equals(s.getDone())) {
            s.setDone(done);
            log(userId, workspaceId, s.getTaskId(), (done ? "完成子任务「" : "取消完成子任务「") + s.getTitle() + "」");
        }
        subtaskMapper.update(s);
        return subtaskMapper.selectById(id);
    }

    @Transactional
    public void delete(String userId, String workspaceId, Long id) {
        Subtask s = subtaskMapper.selectById(id);
        if (s == null || !workspaceId.equals(s.getWorkspaceId())) {
            throw AppException.notFound("子任务不存在：" + id);
        }
        Task parent = ensureTask(workspaceId, s.getTaskId()); // 与修改一致：父任务无效（回收站中）不可删清单
        projectAccess.assertWrite(workspaceId, userId, parent.getReqId());
        subtaskMapper.deleteById(id);
        log(userId, workspaceId, s.getTaskId(), "删除子任务「" + s.getTitle() + "」");
    }

    private Task ensureTask(String workspaceId, String taskId) {
        Task t = taskMapper.selectById(taskId);
        if (t == null || !workspaceId.equals(t.getWorkspaceId()) || t.getDeletedAt() != null) {
            throw AppException.notFound("任务不存在：" + taskId);
        }
        return t;
    }

    private void log(String userId, String workspaceId, String taskId, String detail) {
        TaskLog taskLog = new TaskLog();
        taskLog.setTaskId(taskId);
        taskLog.setWorkspaceId(workspaceId);
        taskLog.setActorId(userId);
        taskLog.setAction("update");
        taskLog.setDetail(detail);
        logMapper.insert(taskLog);
    }
}
