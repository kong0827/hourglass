package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.common.Texts;
import com.hourglass.dto.PageResult;
import com.hourglass.dto.TaskPublicationJudgementBatchRequest;
import com.hourglass.dto.TaskPublicationJudgementRequest;
import com.hourglass.entity.AppUser;
import com.hourglass.entity.Task;
import com.hourglass.entity.TaskPublicationJudgement;
import com.hourglass.mapper.TaskMapper;
import com.hourglass.mapper.TaskPublicationJudgementMapper;
import com.hourglass.mapper.UserMapper;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;

/**
 * 工作项历史发布人工标记：补录从其他系统迁移、没有正式发布记录的事实。
 *
 * <p>只影响工作项徽标与「发布态」筛选，不写入 version_release，不改变 publicationState，
 * 也不参与需求交付阶段派生、交付说明与版本统计。修改采用「撤销旧记录 + 新增记录」，
 * 保留完整历史；撤销后回落为未发布。
 */
@Service
public class TaskPublicationJudgementService {

    public static final String STATE_PUBLISHED = "published";
    private static final int MAX_BATCH = 100;
    private static final int MAX_PAGE_SIZE = 100;

    private final TaskMapper taskMapper;
    private final TaskPublicationJudgementMapper judgementMapper;
    private final UserMapper userMapper;
    private final ProjectAccessService projectAccess;
    private final ReleasePermissionService releasePermission;
    private final TaskAuditLogger auditLogger;

    public TaskPublicationJudgementService(TaskMapper taskMapper,
                                           TaskPublicationJudgementMapper judgementMapper,
                                           UserMapper userMapper, ProjectAccessService projectAccess,
                                           ReleasePermissionService releasePermission,
                                           TaskAuditLogger auditLogger) {
        this.taskMapper = taskMapper;
        this.judgementMapper = judgementMapper;
        this.userMapper = userMapper;
        this.projectAccess = projectAccess;
        this.releasePermission = releasePermission;
        this.auditLogger = auditLogger;
    }

    /** 新建或替换当前标记：旧记录自动撤销，新记录追加。 */
    @Transactional
    public TaskPublicationJudgement mark(String userId, String workspaceId, String taskId,
                                         TaskPublicationJudgementRequest body) {
        LocalDate effectiveOn = requireEffectiveOn(body == null ? null : body.getEffectiveOn());
        String reason = requireReason(body == null ? null : body.getNote());
        Task task = requireTask(workspaceId, taskId, false);
        assertCanJudge(userId, workspaceId, task, null);
        return applyMark(userId, workspaceId, task, effectiveOn, reason);
    }

    /** 批量标记：单次最多 100 条，整批一个事务；任一条失败全部回滚，错误信息带条目序号与标题。 */
    @Transactional
    public Map<String, Integer> markBatch(String userId, String workspaceId,
                                          TaskPublicationJudgementBatchRequest body) {
        List<Task> tasks = requireBatchTasks(userId, workspaceId, body == null ? null : body.getTaskIds());
        LocalDate effectiveOn = requireEffectiveOn(body.getEffectiveOn());
        String reason = requireReason(body.getNote());
        int marked = 0;
        for (int i = 0; i < tasks.size(); i++) {
            Task task = tasks.get(i);
            applyMark(userId, workspaceId, task, effectiveOn, reason);
            marked++;
        }
        Map<String, Integer> result = new LinkedHashMap<String, Integer>();
        result.put("marked", marked);
        return result;
    }

    /** 撤销当前标记：保留历史，立即回落为未发布。 */
    @Transactional
    public void revoke(String userId, String workspaceId, String taskId,
                       TaskPublicationJudgementRequest body) {
        String reason = requireReason(body == null ? null : body.getNote());
        Task task = requireTask(workspaceId, taskId, false);
        assertCanJudge(userId, workspaceId, task, null);
        TaskPublicationJudgement active = judgementMapper.selectActive(workspaceId, taskId);
        if (active == null) {
            throw AppException.badRequest("当前没有生效的人工发布标记");
        }
        if (judgementMapper.revoke(active.getId(), userId, operatorName(userId), reason) != 1) {
            throw AppException.conflict("人工发布标记已被其他人撤销，请刷新后重试");
        }
        auditLogger.log(userId, workspaceId, taskId, "update", "撤销人工发布标记：" + reason);
    }

    /** 批量撤销：只撤销仍有生效标记的工作项，已撤销的跳过；整批一个事务。 */
    @Transactional
    public Map<String, Integer> revokeBatch(String userId, String workspaceId,
                                            TaskPublicationJudgementBatchRequest body) {
        List<Task> tasks = requireBatchTasks(userId, workspaceId, body == null ? null : body.getTaskIds());
        String reason = requireReason(body == null ? null : body.getNote());
        int revoked = 0;
        for (Task task : tasks) {
            TaskPublicationJudgement active = judgementMapper.selectActive(workspaceId, task.getId());
            if (active == null) {
                continue;
            }
            if (judgementMapper.revoke(active.getId(), userId, operatorName(userId), reason) != 1) {
                continue;
            }
            auditLogger.log(userId, workspaceId, task.getId(), "update", "撤销人工发布标记：" + reason);
            revoked++;
        }
        if (revoked == 0) {
            throw AppException.badRequest("所选工作项都没有生效的人工发布标记");
        }
        Map<String, Integer> result = new LinkedHashMap<String, Integer>();
        result.put("revoked", revoked);
        return result;
    }

    public PageResult<TaskPublicationJudgement> history(String workspaceId, String userId, String taskId,
                                                        int offset, int limit) {
        Task task = requireTask(workspaceId, taskId, true);
        projectAccess.assertViewTask(workspaceId, userId, task);
        int safeOffset = Math.max(0, offset);
        int safeLimit = Math.max(1, Math.min(MAX_PAGE_SIZE, limit));
        int total = judgementMapper.countHistory(workspaceId, taskId);
        List<TaskPublicationJudgement> items = total <= safeOffset
                ? new ArrayList<TaskPublicationJudgement>()
                : judgementMapper.selectHistory(workspaceId, taskId, safeOffset, safeLimit);
        return PageResult.of(items, total, safeOffset, safeLimit);
    }

    /** 列表投影：一次批量读出生效标记，按 taskId 返回；调用方负责可见范围。 */
    public List<TaskPublicationJudgement> activeByTasks(String workspaceId, List<String> taskIds) {
        if (taskIds == null || taskIds.isEmpty()) {
            return new ArrayList<TaskPublicationJudgement>();
        }
        List<TaskPublicationJudgement> rows = new ArrayList<TaskPublicationJudgement>();
        for (int start = 0; start < taskIds.size(); start += 500) {
            List<String> batch = taskIds.subList(start, Math.min(start + 500, taskIds.size()));
            rows.addAll(judgementMapper.selectActiveByTasks(workspaceId, batch));
        }
        return rows;
    }

    private TaskPublicationJudgement applyMark(String userId, String workspaceId, Task task,
                                               LocalDate effectiveOn, String reason) {
        TaskPublicationJudgement active = judgementMapper.selectActive(workspaceId, task.getId());
        if (active != null
                && judgementMapper.revoke(active.getId(), userId, operatorName(userId), "重新标记已发布") != 1) {
            throw AppException.conflict("人工发布标记已被其他人修改，请刷新后重试");
        }
        TaskPublicationJudgement judgement = new TaskPublicationJudgement();
        judgement.setWorkspaceId(workspaceId);
        judgement.setTaskId(task.getId());
        judgement.setJudgedState(STATE_PUBLISHED);
        judgement.setEffectiveOn(effectiveOn);
        judgement.setJudgeReason(reason);
        judgement.setJudgedByUserId(userId);
        judgement.setJudgedByName(operatorName(userId));
        try {
            judgementMapper.insert(judgement);
        } catch (DuplicateKeyException e) {
            throw AppException.conflict("人工发布标记已被其他人修改，请刷新后重试");
        }
        auditLogger.log(userId, workspaceId, task.getId(), "update",
                "人工标记已发布（生效 " + effectiveOn + "）：" + reason);
        return judgement;
    }

    private List<Task> requireBatchTasks(String userId, String workspaceId, List<String> ids) {
        LinkedHashSet<String> unique = new LinkedHashSet<String>();
        if (ids != null) {
            for (String id : ids) {
                String value = Texts.trimToNull(id);
                if (value != null) {
                    unique.add(value);
                }
            }
        }
        if (unique.isEmpty()) {
            throw AppException.badRequest("请选择要标记的工作项");
        }
        if (unique.size() > MAX_BATCH) {
            throw AppException.badRequest("单次最多标记 " + MAX_BATCH + " 个工作项");
        }
        List<Task> tasks = new ArrayList<Task>();
        int index = 0;
        for (String id : unique) {
            index++;
            Task task = requireTask(workspaceId, id, false);
            assertCanJudge(userId, workspaceId, task, "第 " + index + " 条（" + taskLabel(task) + "）：");
            tasks.add(task);
        }
        return tasks;
    }

    private Task requireTask(String workspaceId, String taskId, boolean allowDeleted) {
        Task task = taskMapper.selectById(taskId);
        if (task == null || !workspaceId.equals(task.getWorkspaceId())) {
            throw AppException.notFound("工作项不存在：" + taskId);
        }
        if (!allowDeleted && task.getDeletedAt() != null) {
            throw AppException.badRequest("工作项已在回收站，不能标记发布状态");
        }
        return task;
    }

    private void assertCanJudge(String userId, String workspaceId, Task task, String prefix) {
        try {
            releasePermission.assertJudgePublication(userId, workspaceId, task.getReqId());
        } catch (AppException e) {
            if (e.getCode() == 403) {
                throw new AppException(403, (prefix == null ? "" : prefix) + e.getMessage());
            }
            throw e;
        }
    }

    private String taskLabel(Task task) {
        String title = Texts.trimToNull(task.getTitle());
        String no = task.getItemNo() == null ? null : "WI-" + String.format("%03d", task.getItemNo());
        if (no == null) {
            return title == null ? task.getId() : title;
        }
        return title == null ? no : no + " " + Texts.cut(title, 30);
    }

    private LocalDate requireEffectiveOn(LocalDate effectiveOn) {
        if (effectiveOn == null) {
            throw AppException.badRequest("请选择标记生效日期");
        }
        if (effectiveOn.isAfter(LocalDate.now())) {
            throw AppException.badRequest("标记生效日期不能晚于今天");
        }
        return effectiveOn;
    }

    private String requireReason(String note) {
        String reason = Texts.trimToNull(note);
        if (reason == null) {
            throw AppException.badRequest("请填写人工标记原因");
        }
        if (reason.length() > 500) {
            throw AppException.badRequest("人工标记原因不能超过 500 字");
        }
        return reason;
    }

    private String operatorName(String userId) {
        AppUser user = userMapper.selectById(userId);
        String name = user == null ? null : Texts.trimToNull(user.getDisplayName());
        return name == null ? userId : name;
    }
}
