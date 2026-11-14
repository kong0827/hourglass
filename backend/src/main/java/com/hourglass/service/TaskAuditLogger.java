package com.hourglass.service;

import com.hourglass.common.DefectMeta;
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
    /** 模块ID → 名称解析（时间线差异文案展示人话，不展示 ID） */
    private final WorkspaceMetaCache metaCache;
    private final com.fasterxml.jackson.databind.ObjectMapper objectMapper;

    public TaskAuditLogger(TaskLogMapper logMapper, RequirementMapper reqMapper, WorkspaceMetaCache metaCache,
                           com.fasterxml.jackson.databind.ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
        this.logMapper = logMapper;
        this.reqMapper = reqMapper;
        this.metaCache = metaCache;
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

    /** 结构数据完整保存；序列化失败使业务事务回滚，不降级丢失证据。 */
    public void logChange(String userId, String workspaceId, String taskId, String action, String detail,
                          Object before, Object after, String reason) {
        java.util.Map<String, Object> data = new java.util.LinkedHashMap<String, Object>();
        data.put("before", before);
        data.put("after", after);
        data.put("reason", reason);
        TaskLog taskLog = new TaskLog();
        taskLog.setTaskId(taskId);
        taskLog.setWorkspaceId(workspaceId);
        taskLog.setActorId(userId);
        taskLog.setAction(action);
        taskLog.setDetail(Texts.cut(detail, 250));
        try {
            taskLog.setChangeData(objectMapper.writeValueAsString(data));
        } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
            throw new IllegalStateException("任务变更审计序列化失败", e);
        }
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
        if (!Objects.equals(old.getCategoryId(), t.getCategoryId())) {
            parts.add("模块 " + categoryName(workspaceId, old.getCategoryId())
                    + "→" + categoryName(workspaceId, t.getCategoryId()));
        }
        if (!Objects.equals(old.getOwner(), t.getOwner())) {
            parts.add("负责人 " + old.getOwner() + "→" + t.getOwner());
        }
        /* 测试负责人与开发负责人相互独立：改派和清空回待领取都要留痕，否则「谁在测」这段历史断链 */
        if (!Objects.equals(old.getTestOwnerUserId(), t.getTestOwnerUserId())
                || !Objects.equals(old.getTestOwner(), t.getTestOwner())) {
            parts.add("测试负责人 " + testOwnerName(old.getTestOwner()) + "→" + testOwnerName(t.getTestOwner()));
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
        /* 类型/史诗/里程碑：单独修改时也必须产生差异，否则保存后时间线只显示「无字段变化」 */
        if (!Objects.equals(old.getItemType(), t.getItemType())) {
            parts.add("类型 " + itemTypeName(old.getItemType()) + "→" + itemTypeName(t.getItemType()));
        }
        if (!Objects.equals(old.getEpicId(), t.getEpicId())) {
            parts.add(t.getEpicId() == null ? "解除史诗归属" : "挂到史诗");
        }
        if (!Objects.equals(Boolean.TRUE.equals(old.getIsMilestone()), Boolean.TRUE.equals(t.getIsMilestone()))) {
            parts.add(Boolean.TRUE.equals(t.getIsMilestone()) ? "设为里程碑" : "取消里程碑");
        }
        /* 缺陷专属字段：类型不变时也可能单独调整 */
        if (!Objects.equals(old.getSeverity(), t.getSeverity())) {
            parts.add("严重程度 " + DefectMeta.severityLabel(old.getSeverity())
                    + "→" + DefectMeta.severityLabel(t.getSeverity()));
        }
        if (!Objects.equals(old.getEnvironment(), t.getEnvironment())) {
            parts.add("缺陷环境变更");
        }
        if (!Objects.equals(old.getReproduceSteps(), t.getReproduceSteps())) {
            parts.add("复现步骤变更");
        }
        if (!Objects.equals(old.getFoundVersionId(), t.getFoundVersionId())) {
            parts.add("发现版本变更");
        }
        if (!Objects.equals(old.getRegressionStatus(), t.getRegressionStatus())) {
            parts.add("回归状态 " + regressionName(old.getRegressionStatus())
                    + "→" + regressionName(t.getRegressionStatus()));
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
        if (!Objects.equals(old.getRemindTarget(), t.getRemindTarget())) {
            parts.add("提醒对象变更");
        }
        if (!Objects.equals(Boolean.TRUE.equals(old.getBlocked()), Boolean.TRUE.equals(t.getBlocked()))) {
            parts.add(Boolean.TRUE.equals(t.getBlocked())
                    ? ("标记为被阻塞" + (t.getBlockedReason() == null ? "" : "（" + Texts.cut(t.getBlockedReason(), 40) + "）"))
                    : "解除阻塞");
        } else if (Boolean.TRUE.equals(t.getBlocked()) && !Objects.equals(old.getBlockedReason(), t.getBlockedReason())) {
            parts.add("卡点原因变更");
        }
        /* 已阻塞状态下更换前置任务：原因没变时也必须留下差异 */
        if (!Objects.equals(old.getBlockedByTaskId(), t.getBlockedByTaskId())) {
            parts.add(t.getBlockedByTaskId() == null ? "解除前置任务" : "前置任务变更");
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

    private String testOwnerName(String name) {
        String trimmed = Texts.trimToNull(name);
        return trimmed == null ? "待领取" : trimmed;
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

    private String itemTypeName(String type) {
        if ("epic".equals(type)) {
            return "史诗";
        }
        if ("bug".equals(type)) {
            return "缺陷";
        }
        return "任务";
    }

    private String regressionName(String status) {
        if (DefectMeta.REGRESSION_PASSED.equals(status)) {
            return "回归通过";
        }
        if (DefectMeta.REGRESSION_FAILED.equals(status)) {
            return "回归失败";
        }
        if (DefectMeta.REGRESSION_PENDING.equals(status)) {
            return "待回归";
        }
        return "未标记";
    }

    private String reqName(String workspaceId, String reqId) {
        if (reqId == null) {
            return "无";
        }
        Requirement r = reqMapper.selectById(reqId);
        return r == null || !workspaceId.equals(r.getWorkspaceId()) ? "无" : r.getName();
    }

    private String categoryName(String workspaceId, String categoryId) {
        if (categoryId == null || categoryId.isEmpty()) {
            return "未指定";
        }
        for (com.hourglass.entity.Category c : metaCache.categories(workspaceId)) {
            if (categoryId.equals(c.getId())) {
                return c.getName();
            }
        }
        return "未指定";
    }
}
