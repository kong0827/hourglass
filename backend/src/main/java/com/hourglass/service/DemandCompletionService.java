package com.hourglass.service;

import com.hourglass.entity.Demand;
import com.hourglass.mapper.DemandMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 需求完成判定：唯一能把需求置为「已完成」的自动入口。
 *
 * <p>完成 ≠ 交付。完成条件按证据优先级判断：成功生产发布或生效的人工交付判定直接完成；
 * 否则要求至少 1 个未删除工作项全部处于完成列，且关联用例最新一次执行全部通过（无用例视为通过）。
 * 当前已完成的需求一旦不再满足条件，自动退回「已排期」，目标版本与计划日期保留。
 *
 * <p>所有改变工作项 / 用例 / 发布证据的写路径都必须在同一事务内调用本服务；判定幂等，
 * 状态没变时不写日志、不发通知。状态写入使用带原状态条件的单条 UPDATE，避免与编辑的
 * revision CAS 互相覆盖，也避免为一次派生额外持有项目锁。
 */
@Service
public class DemandCompletionService {

    private static final String ACTION_COMPLETE = "complete";
    private static final String ACTION_AUTO_REOPEN = "auto_reopen";
    private static final com.fasterxml.jackson.databind.ObjectMapper JSON =
            new com.fasterxml.jackson.databind.ObjectMapper();

    private final DemandMapper demandMapper;
    private final NotificationEventService notificationEvents;
    private final DemandWatchService demandWatch;

    public DemandCompletionService(DemandMapper demandMapper,
                                   NotificationEventService notificationEvents,
                                   DemandWatchService demandWatch) {
        this.demandMapper = demandMapper;
        this.notificationEvents = notificationEvents;
        this.demandWatch = demandWatch;
    }

    /** 批量刷新：去重后逐条判定，供批量移动、备份导入等场景使用。 */
    @Transactional
    public void refreshCompletion(String workspaceId, Collection<String> demandIds) {
        refreshCompletion(workspaceId, demandIds, true, true);
    }

    /**
     * 批量刷新（可静默）：备份导入属于管理员覆盖操作，状态回正只写日志，不打扰提交人与关注人。
     */
    @Transactional
    public void refreshCompletion(String workspaceId, Collection<String> demandIds, boolean notify) {
        refreshCompletion(workspaceId, demandIds, notify, true);
    }

    /**
     * 备份导入专用：备份不携带发布记录与人工交付判定，无法证明「已完成」失效，
     * 因此只按导入证据补齐 plan → done，不把 done 退回 plan；同样可静默。
     */
    @Transactional
    public void refreshCompletionPreservingDone(String workspaceId, Collection<String> demandIds, boolean notify) {
        refreshCompletion(workspaceId, demandIds, notify, false);
    }

    @Transactional
    public void refreshCompletion(String workspaceId, Collection<String> demandIds, boolean notify, boolean allowReopen) {
        if (demandIds == null) {
            return;
        }
        java.util.Set<String> seen = new java.util.LinkedHashSet<String>();
        for (String demandId : demandIds) {
            if (demandId != null && seen.add(demandId)) {
                refreshOne(workspaceId, demandId, notify, allowReopen);
            }
        }
    }

    /**
     * 重新判定单条需求。只处理「已排期 / 已完成」；其他主状态没有自动流转入口。
     * 返回是否发生了状态变化。
     */
    @Transactional
    public boolean refreshCompletion(String workspaceId, String demandId) {
        return refreshOne(workspaceId, demandId, true, true);
    }

    private boolean refreshOne(String workspaceId, String demandId, boolean notify, boolean allowReopen) {
        if (workspaceId == null || demandId == null) {
            return false;
        }
        Demand d = demandMapper.selectById(demandId);
        if (d == null || !workspaceId.equals(d.getWorkspaceId())) {
            return false;
        }
        if (!"plan".equals(d.getStatus()) && !"done".equals(d.getStatus())) {
            return false;
        }
        boolean complete = isComplete(workspaceId, demandId);
        if (complete && "plan".equals(d.getStatus())) {
            if (demandMapper.markDone(workspaceId, demandId) == 1) {
                writeLog(d, ACTION_COMPLETE,
                        "自动完成：发布证据优先，其次全部工作项完成且用例最新执行通过",
                        "plan", "done");
                if (notify) {
                    notify(d, "已完成",
                            "关联工作项全部完成且用例最新执行通过，需求已自动标记为已完成；"
                                    + "交付状态仍需成功生产发布或人工交付判定。");
                }
                return true;
            }
            return false;
        }
        if (!complete && "done".equals(d.getStatus())) {
            if (!allowReopen) {
                return false;
            }
            if (demandMapper.reopenFromDone(workspaceId, demandId) == 1) {
                writeLog(d, ACTION_AUTO_REOPEN,
                        "自动退回：完成条件不再成立（工作项、用例或发布证据有变更），保留目标版本与计划日期",
                        "done", "plan");
                if (notify) {
                    notify(d, "已退回已排期",
                            "完成条件不再成立（工作项、用例或发布证据有变更），需求已自动退回已排期；"
                                    + "目标版本与计划日期不变。");
                }
                return true;
            }
        }
        return false;
    }

    private boolean isComplete(String workspaceId, String demandId) {
        Map<String, Object> ev = demandMapper.selectCompletionEvidence(workspaceId, demandId);
        if (ev == null || ev.isEmpty()) {
            return false;
        }
        if (intValue(ev.get("releaseDelivered")) > 0 || intValue(ev.get("manualDelivered")) > 0) {
            return true;
        }
        int taskCount = intValue(ev.get("taskCount"));
        int taskDone = intValue(ev.get("taskDone"));
        int caseCount = intValue(ev.get("caseCount"));
        int casePassed = intValue(ev.get("casePassed"));
        return taskCount > 0 && taskDone >= taskCount && casePassed >= caseCount;
    }

    private void writeLog(Demand d, String action, String note, String beforeStatus, String afterStatus) {
        Map<String, Object> data = new LinkedHashMap<String, Object>();
        Map<String, Object> before = new LinkedHashMap<String, Object>();
        before.put("status", beforeStatus);
        Map<String, Object> after = new LinkedHashMap<String, Object>();
        after.put("status", afterStatus);
        data.put("before", before);
        data.put("after", after);
        data.put("reason", note);
        try {
            demandMapper.insertChangeLog(d.getWorkspaceId(), d.getId(), action, note, null,
                    JSON.writeValueAsString(data));
        } catch (com.fasterxml.jackson.core.JsonProcessingException ex) {
            throw new IllegalStateException("需求完成判定日志序列化失败", ex);
        }
    }

    /** 系统自动流转：提交人与关注人都收，操作者为空。 */
    private void notify(Demand d, String action, String detail) {
        String title = "需求「" + d.getTitle() + "」" + action;
        String body = com.hourglass.common.Texts.cut(detail, 400);
        java.util.Set<String> notified = new java.util.HashSet<String>();
        if (d.getCreatedBy() != null) {
            notificationEvents.notifyLinked(d.getCreatedBy(), d.getWorkspaceId(),
                    UserNotificationPreferenceService.DEMAND_STATUS, title, body,
                    "demand", d.getId(), d.getReqId());
            notified.add(d.getCreatedBy());
        }
        demandWatch.notifyWatchers(d, null, UserNotificationPreferenceService.DEMAND_WATCH,
                title, body, notified);
    }

    private static int intValue(Object value) {
        if (value instanceof Boolean) {
            return ((Boolean) value) ? 1 : 0;
        }
        if (value instanceof Number) {
            return ((Number) value).intValue();
        }
        if (value == null) {
            return 0;
        }
        try {
            return Integer.parseInt(String.valueOf(value));
        } catch (NumberFormatException ex) {
            return 0;
        }
    }
}
