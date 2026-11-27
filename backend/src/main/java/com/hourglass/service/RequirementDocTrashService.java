package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.common.Texts;
import com.hourglass.dto.PageResult;
import com.hourglass.entity.RequirementDoc;
import com.hourglass.mapper.ReqDocShareMapper;
import com.hourglass.mapper.RequirementDocCommentMapper;
import com.hourglass.mapper.RequirementDocHistoryMapper;
import com.hourglass.mapper.RequirementDocMapper;
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
import java.util.ArrayList;
import java.util.List;

/**
 * 文档回收站：软删除在 {@link RequirementDocService#delete} 完成，这里负责查看、恢复、
 * 彻底删除与 30 天过期清理。彻底删除才清理评论、历史、附件与任务关联，恢复后原样可用。
 */
@Service
public class RequirementDocTrashService {

    private static final Logger log = LoggerFactory.getLogger(RequirementDocTrashService.class);
    /** 回收站保留天数 */
    static final int KEEP_DAYS = 30;
    private static final int PURGE_BATCH_SIZE = 100;

    private final RequirementDocMapper docMapper;
    private final RequirementDocCommentMapper commentMapper;
    private final RequirementDocHistoryMapper historyMapper;
    private final ReqDocShareMapper shareMapper;
    private final TaskMapper taskMapper;
    private final ProjectAccessService projectAccess;
    private final WorkActivityService workActivityService;
    private final AttachmentService attachmentService;
    private final DeletionTraceService deletionTrace;
    /** 定时清理：每批一个独立事务，单批失败不影响其它批 */
    private final TransactionTemplate purgeTx;

    public RequirementDocTrashService(RequirementDocMapper docMapper,
                                      RequirementDocCommentMapper commentMapper,
                                      RequirementDocHistoryMapper historyMapper,
                                      ReqDocShareMapper shareMapper, TaskMapper taskMapper,
                                      ProjectAccessService projectAccess,
                                      WorkActivityService workActivityService,
                                      AttachmentService attachmentService,
                                      DeletionTraceService deletionTrace,
                                      PlatformTransactionManager transactionManager) {
        this.docMapper = docMapper;
        this.commentMapper = commentMapper;
        this.historyMapper = historyMapper;
        this.shareMapper = shareMapper;
        this.taskMapper = taskMapper;
        this.projectAccess = projectAccess;
        this.workActivityService = workActivityService;
        this.attachmentService = attachmentService;
        this.deletionTrace = deletionTrace;
        this.purgeTx = new TransactionTemplate(transactionManager);
        this.purgeTx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    /** 回收站列表：空间管理员看全部，普通成员只看自己删除或自己负责的文档 */
    public PageResult<RequirementDoc> trash(String workspaceId, String userId, int offset, int limit) {
        int safeOffset = Math.max(0, offset);
        int safeLimit = Math.max(1, Math.min(100, limit));
        String viewerId = projectAccess.viewerScope(workspaceId, userId);
        boolean seeAll = ProjectAccessService.isPrivileged(projectAccess.roleOf(workspaceId, userId));
        int total = docMapper.countTrash(workspaceId, viewerId, userId, seeAll);
        List<RequirementDoc> items = total <= safeOffset ? new ArrayList<RequirementDoc>()
                : docMapper.selectTrash(workspaceId, viewerId, userId, seeAll, safeOffset, safeLimit);
        return PageResult.of(items, total, safeOffset, safeLimit);
    }

    @Transactional
    public RequirementDoc restore(String userId, String workspaceId, String id) {
        RequirementDoc d = requireTrashed(workspaceId, id);
        assertManage(userId, workspaceId, d);
        if (docMapper.restoreFromTrash(workspaceId, id) == 0) {
            throw AppException.conflict("文档状态已变化，请刷新后重试");
        }
        workActivityService.record(workspaceId, WorkActivityService.REQUIREMENT_DOC, id, userId,
                "restore", "从回收站恢复了文档「" + d.getTitle() + "」");
        return docMapper.selectById(id);
    }

    @Transactional
    public void purge(String userId, String workspaceId, String id) {
        RequirementDoc d = requireTrashed(workspaceId, id);
        assertManage(userId, workspaceId, d);
        purgeOne(userId, workspaceId, d, false);
    }

    private RequirementDoc requireTrashed(String workspaceId, String id) {
        RequirementDoc d = docMapper.selectByIdAny(id);
        if (d == null || !workspaceId.equals(d.getWorkspaceId()) || d.getDeletedAt() == null) {
            throw AppException.notFound("文档不在回收站：" + id);
        }
        return d;
    }

    /** 恢复/彻底删除：项目可写 + （删除人、文档负责人或空间管理员） */
    private void assertManage(String userId, String workspaceId, RequirementDoc d) {
        projectAccess.assertWrite(workspaceId, userId, d.getReqId());
        if (projectAccess.canManage(workspaceId, userId)) {
            return;
        }
        if (userId.equals(d.getDeletedBy()) || userId.equals(d.getOwnerUserId())) {
            return;
        }
        throw new AppException(403, "仅删除人、文档负责人或空间管理员可恢复 / 彻底删除");
    }

    /**
     * 彻底删除：不可恢复。手工操作留独立墓碑；定时清理 silent=true 只做数据清理。
     * 子文档在移入回收站时已提升到父级，这里再兜底一次，防止历史数据遗留。
     */
    private void purgeOne(String userId, String workspaceId, RequirementDoc d, boolean silent) {
        String name = Texts.trimToNull(d.getTitle()) == null ? "未命名文档" : d.getTitle();
        if (!silent && userId != null) {
            deletionTrace.recordDelete(workspaceId, userId, "requirement_doc_purge", "requirement_doc",
                    d.getId(), name, "彻底删除文档「" + name + "」（不可恢复，评论、历史与附件一并清理）");
        }
        docMapper.reparentChildren(workspaceId, d.getId(), d.getParentId());
        docMapper.deleteDemandLinksByDoc(workspaceId, d.getId());
        List<String> affectedTaskIds = taskMapper.selectIdsByReqDocForCascade(workspaceId, d.getId());
        docMapper.clearTaskRef(workspaceId, d.getId());
        if (!silent) {
            deletionTrace.logTaskCascade(workspaceId, userId, affectedTaskIds,
                    "关联需求文档「" + name + "」已彻底删除，自动解除关联");
        }
        commentMapper.deleteByDoc(workspaceId, d.getId());
        historyMapper.deleteByDoc(workspaceId, d.getId());
        shareMapper.deleteByDoc(workspaceId, d.getId());
        docMapper.deleteVisibilityMembersByDoc(workspaceId, d.getId());
        attachmentService.deleteByTarget(workspaceId, d.getId(), AttachmentService.KIND_DOC);
        docMapper.delete(d.getId());
        if (!silent) {
            workActivityService.deleteByEntity(workspaceId, WorkActivityService.REQUIREMENT_DOC, d.getId());
        }
    }

    /** 定时任务调用：清理超过保留期的回收站文档，返回成功清理条数 */
    public int purgeExpired(LocalDateTime cutoff) {
        int purged = 0;
        while (true) {
            List<RequirementDoc> batch = docMapper.selectExpiredTrash(cutoff, PURGE_BATCH_SIZE);
            if (batch == null || batch.isEmpty()) {
                break;
            }
            boolean failed = false;
            for (final RequirementDoc d : batch) {
                try {
                    purgeTx.execute(status -> {
                        purgeOne(null, d.getWorkspaceId(), d, true);
                        return null;
                    });
                    purged++;
                } catch (Exception e) {
                    log.warn("文档回收站清理失败（{}）：{}", d.getId(), e.getMessage(), e);
                    failed = true;
                }
            }
            if (failed || batch.size() < PURGE_BATCH_SIZE) {
                break;
            }
        }
        return purged;
    }

    /** 每天 04:45 清理删除满 30 天的文档（比任务回收站晚 15 分钟，错开批量写库） */
    @Scheduled(cron = "0 45 4 * * *")
    public void scheduledPurge() {
        try {
            int count = purgeExpired(LocalDateTime.now().minusDays(KEEP_DAYS));
            if (count > 0) {
                log.info("文档回收站自动清理 {} 篇（删除已超过 {} 天）", count, KEEP_DAYS);
            }
        } catch (Exception e) {
            log.warn("文档回收站自动清理失败", e);
        }
    }
}
