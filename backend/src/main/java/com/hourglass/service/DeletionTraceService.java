package com.hourglass.service;

import com.hourglass.common.Texts;
import com.hourglass.mapper.TaskLogMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * 不可逆删除的统一留痕（P0）：
 * 被删实体自己的时间线会随实体一起消失，因此删除前必须同时写两份独立记录——
 * 空间活动流（task_log 的 CFG 事件）与管理员审计（audit_log）。
 *
 * <p>删除成功后实体原日志被清理，这两条记录仍可回答「谁在什么时候删了什么」。
 * 另外承担级联改任务字段后的批量时间线补录（删列/模块/需求/文档/分支）。
 */
@Service
public class DeletionTraceService {

    private static final Logger log = LoggerFactory.getLogger(DeletionTraceService.class);
    /** 单条 SQL 的任务数上限，避免批量 INSERT 超过 max_allowed_packet */
    private static final int BATCH_SIZE = 200;

    private final ActivityService activityService;
    private final AuditService auditService;
    private final TaskLogMapper logMapper;

    public DeletionTraceService(ActivityService activityService, AuditService auditService,
                                TaskLogMapper logMapper) {
        this.activityService = activityService;
        this.auditService = auditService;
        this.logMapper = logMapper;
    }

    /**
     * @param action 审计动作（如 demand_delete / requirement_doc_delete / branch_delete / version_delete）
     * @param targetType 对象类型；与 action 一起供审计筛选
     * @param detail 人类可读摘要；同时写入空间活动流
     */
    public void recordDelete(String workspaceId, String userId, String action, String targetType,
                             String targetId, String targetName, String detail) {
        activityService.logConfig(workspaceId, userId, detail);
        auditService.recordCurrent(workspaceId, action, targetType, targetId, targetName, true, detail, null);
    }

    /**
     * 级联 SQL 改了任务字段时，为受影响任务（含回收站）补一条 update 时间线。
     * 时间线属于业务活动，写入失败只告警，不阻断删除本身。
     */
    public void logTaskCascade(String workspaceId, String userId, List<String> taskIds, String detail) {
        if (taskIds == null || taskIds.isEmpty()) {
            return;
        }
        String text = Texts.cut(detail, 250);
        for (int from = 0; from < taskIds.size(); from += BATCH_SIZE) {
            List<String> batch = taskIds.subList(from, Math.min(from + BATCH_SIZE, taskIds.size()));
            try {
                logMapper.insertBatch(workspaceId, batch, userId, "update", text);
            } catch (Exception e) {
                log.warn("级联任务时间线写入失败（workspace={}，{} 条）：{}",
                        workspaceId, batch.size(), detail, e);
            }
        }
    }
}
