package com.hourglass.service;

import com.hourglass.common.Texts;
import com.hourglass.entity.Task;
import com.hourglass.mapper.TaskMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * BE-ARCH-1：回收站（软删除 / 恢复 / 彻底删除 / 过期清理），并入原 TrashService 的定时任务。
 *
 * <p>彻底删除的子表清单一律交给 {@link TaskCascade}，这里不再维护第二份表名。
 */
@Service
public class TaskTrashService {

    private static final Logger log = LoggerFactory.getLogger(TaskTrashService.class);
    /** 回收站保留天数 */
    private static final int KEEP_DAYS = 30;
    /** 回收站清理每批条数：每批一个独立事务，单批失败不影响其它批 */
    private static final int PURGE_BATCH_SIZE = 100;

    private final TaskMapper taskMapper;
    private final TaskSupport support;
    /** 任务级联删除的唯一实现（子表清单、附件 afterCommit、完成快照口径都在这里） */
    private final TaskCascade cascade;
    /** 计时口径统一收在 TimeLogService，这里只负责在删除时触发关闭 */
    private final TimeLogService timeLogService;
    private final TaskAuditLogger audit;
    private final ProjectAccessService projectAccess;
    private final com.hourglass.mapper.MailDeliveryMapper mailDeliveryMapper;
    private final NotificationEventService notificationEvents;
    private final TaskWatchService watchService;
    /** 回收站清理：批量事务模板（REQUIRES_NEW 保证每批独立提交） */
    private final TransactionTemplate purgeTx;

    public TaskTrashService(TaskMapper taskMapper, TaskSupport support, TaskCascade cascade,
                            TimeLogService timeLogService, TaskAuditLogger audit,
                            ProjectAccessService projectAccess,
                            com.hourglass.mapper.MailDeliveryMapper mailDeliveryMapper,
                            NotificationEventService notificationEvents, TaskWatchService watchService,
                            PlatformTransactionManager transactionManager) {
        this.taskMapper = taskMapper;
        this.support = support;
        this.cascade = cascade;
        this.timeLogService = timeLogService;
        this.audit = audit;
        this.projectAccess = projectAccess;
        this.mailDeliveryMapper = mailDeliveryMapper;
        this.notificationEvents = notificationEvents;
        this.watchService = watchService;
        this.purgeTx = new TransactionTemplate(transactionManager);
        this.purgeTx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    public List<Task> trash(String workspaceId, String userId) {
        List<Task> list = taskMapper.selectDeleted(workspaceId);
        java.util.Set<String> hiddenReqs = projectAccess.hiddenProjectIds(workspaceId, userId);
        if (hiddenReqs.isEmpty()) {
            return list;
        }
        List<Task> visible = new ArrayList<Task>();
        for (Task t : list) {
            if (t.getReqId() == null || !hiddenReqs.contains(t.getReqId())) {
                visible.add(t);
            }
        }
        return visible;
    }

    /** 软删除：进回收站，30 天后由定时任务清理 */
    @Transactional
    public void delete(String userId, String workspaceId, String id) {
        Task t = support.require(workspaceId, id);
        projectAccess.assertViewTask(workspaceId, userId, t);
        projectAccess.assertWrite(workspaceId, userId, t.getReqId());
        taskMapper.softDelete(id);
        mailDeliveryMapper.deleteByReferenceIds(java.util.Collections.singletonList(id));
        /* Epic 进回收站后其子任务立即解除归属，避免指向已删除的任务 */
        taskMapper.clearEpicChildren(workspaceId, id);
        timeLogService.closeRunningForTask(workspaceId, id, userId, "任务已移入回收站");
        audit.log(userId, workspaceId, id, "delete", "移入回收站「" + t.getTitle() + "」（30 天后自动清理）");
        /* 软删除后任务已不可打开，通知不带任务引用，避免通知中心点进去 404 */
        notifyParticipants(workspaceId, userId, t, "任务移入回收站：「" + t.getTitle() + "」",
                "任务已被移入回收站，30 天后自动清理；可由空间成员在回收站恢复", null);
    }

    @Transactional
    public void restore(String userId, String workspaceId, String id) {
        Task t = support.requireDeleted(workspaceId, id);
        projectAccess.assertViewTask(workspaceId, userId, t);
        projectAccess.assertWrite(workspaceId, userId, t.getReqId());
        taskMapper.restore(id);
        /* O-26：把"刚删就撤销"和"从回收站恢复"在时间线上区分开，让"这条任务为什么又回来了"可解释 */
        boolean undo = t.getDeletedAt() != null
                && ChronoUnit.SECONDS.between(t.getDeletedAt(), LocalDateTime.now()) <= 120;
        audit.log(userId, workspaceId, id, "restore", undo
                ? "撤销删除：「" + t.getTitle() + "」回到看板"
                : "从回收站恢复「" + t.getTitle() + "」");
        notifyParticipants(workspaceId, userId, t, "任务已恢复：「" + t.getTitle() + "」",
                "任务已从回收站恢复到看板", id);
    }

    @Transactional
    public void purge(String workspaceId, String id) {
        support.requireDeleted(workspaceId, id);
        cascade.purgeTasks(workspaceId, Collections.singletonList(id));
    }

    /** 删除/恢复通知负责人与关注者；操作者不做打扰，负责人已单独通知时不重复 */
    private void notifyParticipants(String workspaceId, String actorId, Task task,
                                    String title, String body, String referenceId) {
        String owner = Texts.trimToNull(task.getOwnerUserId());
        List<String> skip = Collections.emptyList();
        if (owner != null && !owner.equals(actorId)) {
            notificationEvents.notify(owner, workspaceId, UserNotificationPreferenceService.TASK_UPDATED,
                    title, body, referenceId, task.getReqId());
            skip = Collections.singletonList(owner);
        }
        watchService.notifyWatchers(workspaceId, task.getId(), actorId,
                UserNotificationPreferenceService.TASK_WATCH, title, body, task.getReqId(), skip);
    }

    /**
     * 定时任务调用：清理超过保留期的回收站任务（跨空间），返回成功清理的条数。
     * 每 100 条一个独立事务：单批失败只回滚该批（任务留在回收站，下次再清），不影响其它批。
     */
    public int purgeExpired(LocalDateTime cutoff) {
        int purged = 0;
        while (true) {
            List<Task> tasks = taskMapper.selectPurgeable(cutoff, PURGE_BATCH_SIZE);
            if (tasks == null || tasks.isEmpty()) {
                break;
            }
            boolean failed = false;
            for (int from = 0; from < tasks.size(); from += PURGE_BATCH_SIZE) {
                final List<Task> batch = new ArrayList<Task>(
                        tasks.subList(from, Math.min(from + PURGE_BATCH_SIZE, tasks.size())));
                try {
                    purgeTx.execute(status -> {
                        cascade.purgeTasks(batch);
                        return null;
                    });
                    purged += batch.size();
                } catch (Exception e) {
                    log.warn("回收站清理批次失败（{} 条），本批回滚，留待下次清理：{}",
                            batch.size(), e.getMessage(), e);
                    failed = true;
                }
            }
            if (failed || tasks.size() < PURGE_BATCH_SIZE) {
                break;
            }
        }
        return purged;
    }

    /** 每天 04:30 清理删除满 30 天的任务（原 TrashService 的定时职责） */
    @Scheduled(cron = "0 30 4 * * *")
    public void scheduledPurge() {
        try {
            int count = purgeExpired(LocalDateTime.now().minusDays(KEEP_DAYS));
            if (count > 0) {
                log.info("回收站自动清理 {} 项任务（删除已超过 {} 天）", count, KEEP_DAYS);
            }
        } catch (Exception e) {
            log.warn("回收站自动清理失败", e);
        }
    }
}
