package com.hourglass.service;

import com.hourglass.common.Texts;
import com.hourglass.entity.Requirement;
import com.hourglass.entity.Task;
import com.hourglass.entity.TaskLog;
import com.hourglass.mapper.RequirementMapper;
import com.hourglass.mapper.TaskLogMapper;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Objects;

/**
 * 任务操作日志与字段差异（BE-ARCH-1 拆分）。
 *
 * <p>从 TaskService 抽出的审计职责：只负责"把一次修改翻译成一句人话"并落 task_log，
 * 不参与任何业务规则。这样流程体检 / 任务时间线依赖的日志格式只有一处维护。
 */
@Component
public class TaskAuditLogger {

    private final TaskLogMapper logMapper;
    private final RequirementMapper reqMapper;

    public TaskAuditLogger(TaskLogMapper logMapper, RequirementMapper reqMapper) {
        this.logMapper = logMapper;
        this.reqMapper = reqMapper;
    }

    public void log(String userId, String workspaceId, String taskId, String action, String detail) {
        log(userId, workspaceId, taskId, action, detail, null, null);
    }

    /**
     * 带列信息的日志：move 事件额外记下移动前后的列 id。
     * 流程体检靠这两个字段算「每列停留多久」「有没有往回退」——
     * 只靠 detail 里的列名，列一旦改名历史就断链了。
     */
    public void log(String userId, String workspaceId, String taskId, String action, String detail,
                    String fromColumn, String toColumn) {
        TaskLog taskLog = new TaskLog();
        taskLog.setTaskId(taskId);
        taskLog.setWorkspaceId(workspaceId);
        taskLog.setActorId(userId);
        taskLog.setAction(action);
        taskLog.setDetail(detail);
        taskLog.setFromColumn(fromColumn);
        taskLog.setToColumn(toColumn);
        logMapper.insert(taskLog);
    }

    /** 把新旧任务对象逐字段比较，返回给时间线看的中文片段 */
    public List<String> diffParts(String workspaceId, Task old, Task t, List<String> oldTags, List<String> newTags) {
        List<String> parts = new ArrayList<String>();
        if (!Objects.equals(old.getTitle(), t.getTitle())) {
            parts.add("标题");
        }
        if (!Objects.equals(old.getDescription(), t.getDescription())) {
            parts.add("描述");
        }
        if (!Objects.equals(old.getPriority(), t.getPriority())) {
            parts.add("优先级 " + old.getPriority() + "→" + t.getPriority());
        }
        if (!Objects.equals(old.getCategory(), t.getCategory())) {
            parts.add("模块 " + old.getCategory() + "→" + t.getCategory());
        }
        if (!Objects.equals(old.getOwner(), t.getOwner())) {
            parts.add("负责人 " + old.getOwner() + "→" + t.getOwner());
        }
        /* 列变化单独写 move 日志（见 TaskWorkflowService.afterEditColumnChange()），这里不重复。 */
        if (!Objects.equals(old.getStartDate(), t.getStartDate())) {
            parts.add("开始日期 " + fmtDate(old.getStartDate()) + "→" + fmtDate(t.getStartDate()));
        }
        if (!Objects.equals(old.getDueDate(), t.getDueDate())) {
            parts.add("截止日期 " + fmtDate(old.getDueDate()) + "→" + fmtDate(t.getDueDate()));
        }
        if (!Objects.equals(old.getReqId(), t.getReqId())) {
            parts.add("所属项目 " + reqName(workspaceId, old.getReqId()) + "→" + reqName(workspaceId, t.getReqId()));
        }
        if (!Objects.equals(old.getReqDocId(), t.getReqDocId())) {
            parts.add("关联文档变更");
        }
        if (!Objects.equals(old.getBranchId(), t.getBranchId())) {
            parts.add("所属分支变更");
        }
        if (!Objects.equals(old.getEstimateMinutes(), t.getEstimateMinutes())) {
            parts.add("预估耗时 " + (old.getEstimateMinutes() == null ? "无" : old.getEstimateMinutes() + " 分钟")
                    + "→" + (t.getEstimateMinutes() == null ? "无" : t.getEstimateMinutes() + " 分钟"));
        }
        if (!Objects.equals(old.getRecurType(), t.getRecurType())) {
            parts.add("循环 " + recurName(old.getRecurType()) + "→" + recurName(t.getRecurType()));
        }
        if (!Objects.equals(old.getRemindAt(), t.getRemindAt())) {
            parts.add("提醒时间 " + fmtTime(old.getRemindAt()) + "→" + fmtTime(t.getRemindAt()));
        }
        if (!Objects.equals(Boolean.TRUE.equals(old.getBlocked()), Boolean.TRUE.equals(t.getBlocked()))) {
            parts.add(Boolean.TRUE.equals(t.getBlocked())
                    ? ("标记为被阻塞" + (t.getBlockedReason() == null ? "" : "（" + Texts.cut(t.getBlockedReason(), 40) + "）"))
                    : "解除阻塞");
        } else if (Boolean.TRUE.equals(t.getBlocked()) && !Objects.equals(old.getBlockedReason(), t.getBlockedReason())) {
            parts.add("卡点原因变更");
        }
        if (!Objects.equals(old.getOwnerUserId(), t.getOwnerUserId()) && t.getOwnerUserId() != null) {
            parts.add("绑定负责人账号");
        }
        List<String> tags = new ArrayList<String>();
        if (newTags != null) {
            for (String tag : newTags) {
                String name = Texts.trimToNull(tag);
                if (name != null) {
                    name = name.replace(',', ' ').replace('，', ' ').trim();
                    if (!name.isEmpty()) {
                        name = Texts.cut(name, 16);
                        if (!tags.contains(name)) {
                            tags.add(name);
                        }
                    }
                }
            }
        }
        if (!new HashSet<String>(oldTags).equals(new HashSet<String>(tags))) {
            parts.add("标签 " + (oldTags.isEmpty() ? "无" : String.join("/", oldTags)) + "→" + (tags.isEmpty() ? "无" : String.join("/", tags)));
        }
        int oldProgress = old.getProgress() == null ? 0 : old.getProgress();
        int newProgress = t.getProgress() == null ? 0 : t.getProgress();
        if (oldProgress != newProgress) {
            parts.add("进度 " + oldProgress + "%→" + newProgress + "%");
        }
        if (!Objects.equals(old.getNote(), t.getNote())) {
            parts.add("进度备注");
        }
        return parts;
    }

    private String fmtDate(LocalDate date) {
        return date == null ? "无" : date.toString();
    }

    private String fmtTime(LocalDateTime time) {
        if (time == null) {
            return "无";
        }
        return time.toLocalDate() + " " + String.format("%02d:%02d", time.getHour(), time.getMinute());
    }

    private String recurName(String type) {
        if ("daily".equals(type)) {
            return "每天";
        }
        if ("weekly".equals(type)) {
            return "每周";
        }
        if ("monthly".equals(type)) {
            return "每月";
        }
        return "不循环";
    }

    private String reqName(String workspaceId, String reqId) {
        if (reqId == null) {
            return "无";
        }
        Requirement r = reqMapper.selectById(reqId);
        return r == null || !workspaceId.equals(r.getWorkspaceId()) ? "无" : r.getName();
    }
}
