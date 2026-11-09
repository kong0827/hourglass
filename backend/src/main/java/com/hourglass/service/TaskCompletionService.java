package com.hourglass.service;

import com.hourglass.entity.Requirement;
import com.hourglass.entity.RequirementDoc;
import com.hourglass.entity.Task;
import com.hourglass.entity.TaskCompletionRecord;
import com.hourglass.entity.TimeBounds;
import com.hourglass.mapper.RequirementDocMapper;
import com.hourglass.mapper.RequirementMapper;
import com.hourglass.mapper.TaskCompletionRecordMapper;
import com.hourglass.mapper.TimeLogMapper;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.List;

/**
 * 任务完成快照：任务完成的那一刻把「名称 / 详情 / 归属项目 / 负责人 / 起止时间 / 总耗时」
 * 存成一条**独立记录**，之后任务改名、换项目、被删除都不影响已归档的统计。
 *
 * <p>写入由 TaskWorkflowService / TaskCommandService 在移入「已完成」时触发，前端不用关心。
 */
@Service
public class TaskCompletionService {

    /** 详情快照最大长度（与表字段一致） */
    private static final int DESC_MAX = 2000;

    private final TaskCompletionRecordMapper recordMapper;
    private final TimeLogMapper timeLogMapper;
    private final RequirementMapper reqMapper;
    private final RequirementDocMapper requirementDocMapper;
    /** 模块ID → 名称解析（快照存完成当时的模块名） */
    private final WorkspaceMetaCache metaCache;
    private final ProjectAccessService projectAccess;

    public TaskCompletionService(TaskCompletionRecordMapper recordMapper, TimeLogMapper timeLogMapper,
                                 RequirementMapper reqMapper, RequirementDocMapper requirementDocMapper,
                                 WorkspaceMetaCache metaCache, ProjectAccessService projectAccess) {
        this.recordMapper = recordMapper;
        this.timeLogMapper = timeLogMapper;
        this.reqMapper = reqMapper;
        this.requirementDocMapper = requirementDocMapper;
        this.metaCache = metaCache;
        this.projectAccess = projectAccess;
    }

    /**
     * 归档一条完成快照（同一任务重复完成 → 覆盖，由唯一键保证）。
     * 调用前任务状态必须已落库（completedAt / boardColumn 都是最终值）。
     */
    public void archive(Task t) {
        if (t == null || t.getId() == null || t.getWorkspaceId() == null) {
            return;
        }
        TaskCompletionRecord r = new TaskCompletionRecord();
        r.setWorkspaceId(t.getWorkspaceId());
        r.setTaskId(t.getId());
        r.setTitle(t.getTitle());
        r.setDescription(truncate(t.getDescription(), DESC_MAX));
        r.setReqId(t.getReqId());
        /* 项目名冗余存一份：项目改名、删除后，历史统计仍然读得出当时的名字 */
        if (t.getReqId() != null) {
            Requirement req = reqMapper.selectById(t.getReqId());
            if (req != null && t.getWorkspaceId().equals(req.getWorkspaceId())) {
                r.setReqName(req.getName());
            }
        }
        /* 关联需求也存快照：需求改名 / 删除后，任务清单仍然读得出当时的名字 */
        if (t.getReqDocId() != null) {
            RequirementDoc doc = requirementDocMapper.selectById(t.getReqDocId());
            if (doc != null && t.getWorkspaceId().equals(doc.getWorkspaceId())) {
                r.setReqDocId(doc.getId());
                r.setReqDocTitle(doc.getTitle());
            }
        }
        r.setOwner(t.getOwner());
        r.setOwnerUserId(t.getOwnerUserId());
        /* 快照存完成当时的模块名：解析不到（异常数据）就留空，展示层显示「—」 */
        r.setCategory(categoryName(t.getWorkspaceId(), t.getCategoryId()));
        r.setPriority(t.getPriority());
        r.setStartDate(t.getStartDate());
        r.setCompletedAt(t.getCompletedAt() == null ? LocalDate.now() : t.getCompletedAt());

        Integer total = timeLogMapper.sumByTaskId(t.getWorkspaceId(), t.getId());
        r.setTotalMinutes(total == null ? 0 : total);
        TimeBounds bounds = timeLogMapper.selectBoundsByTask(t.getWorkspaceId(), t.getId());
        if (bounds != null) {
            r.setFirstStartedAt(bounds.getFirstStartedAt());
            r.setLastEndedAt(bounds.getLastEndedAt());
        }
        recordMapper.upsert(r);
    }

    private String categoryName(String workspaceId, String categoryId) {
        if (categoryId == null || categoryId.isEmpty()) {
            return "";
        }
        for (com.hourglass.entity.Category c : metaCache.categories(workspaceId)) {
            if (categoryId.equals(c.getId())) {
                return c.getName();
            }
        }
        return "";
    }

    /**
     * 只刷新快照的「总工时 / 首次开始 / 最后结束」三列。
     * 补记或作废工时记录后调用；名称、归属等历史快照字段保持完成时的原值。
     * 任务尚未完成（没有快照）时 UPDATE 影响 0 行，不会凭空插入。
     */
    public void refreshWork(Task t) {
        if (t == null || t.getId() == null || t.getWorkspaceId() == null) {
            return;
        }
        Integer total = timeLogMapper.sumByTaskId(t.getWorkspaceId(), t.getId());
        TimeBounds bounds = timeLogMapper.selectBoundsByTask(t.getWorkspaceId(), t.getId());
        recordMapper.updateWork(t.getWorkspaceId(), t.getId(), total == null ? 0 : total,
                bounds == null ? null : bounds.getFirstStartedAt(),
                bounds == null ? null : bounds.getLastEndedAt());
    }

    /** 取消完成时删掉该任务的记录（再次完成会重新生成） */
    public void remove(String workspaceId, String taskId) {
        if (workspaceId == null || taskId == null) {
            return;
        }
        recordMapper.deleteByTaskId(workspaceId, taskId);
    }

    /** 按月分页（month 为 null 时取当月）；不可见项目的快照在 SQL 层直接排除，汇总与明细同口径 */
    public com.hourglass.dto.CompletionPageResponse page(String workspaceId, String userId,
                                                        YearMonth month, int offset, int limit) {
        YearMonth ym = month == null ? YearMonth.now() : month;
        LocalDate from = ym.atDay(1);
        LocalDate to = from.plusMonths(1);
        int safeOffset = Math.max(0, offset);
        int safeLimit = limit <= 0 ? 100 : Math.min(limit, 100);
        /* owner/admin/viewer 返回 null（全量可见），只有普通成员按项目级「不可见」过滤 */
        String viewerId = projectAccess.viewerScope(workspaceId, userId);

        com.hourglass.dto.CompletionSummary summary =
                recordMapper.summaryByRange(workspaceId, from, to, viewerId);
        List<TaskCompletionRecord> items = summary.getTotal() <= safeOffset ? new ArrayList<TaskCompletionRecord>()
                : recordMapper.selectPageByRange(workspaceId, from, to, viewerId, safeOffset, safeLimit);
        com.hourglass.dto.CompletionOwnerCount top =
                summary.getTotal() == 0 ? null : recordMapper.topOwnerByRange(workspaceId, from, to, viewerId);

        com.hourglass.dto.CompletionPageResponse resp = new com.hourglass.dto.CompletionPageResponse();
        resp.setTotal(summary.getTotal());
        resp.setOffset(safeOffset);
        resp.setLimit(safeLimit);
        resp.setHasMore(safeOffset + items.size() < summary.getTotal());
        resp.setItems(items);
        resp.setTotalMinutes(summary.getTotalMinutes());
        resp.setOwnerCount(summary.getOwnerCount());
        if (top != null && top.getOwner() != null) {
            resp.setTopOwner(top.getOwner());
            resp.setTopOwnerCount(top.getOwnerCount());
        }
        return resp;
    }

    /** 清空空间 / 覆盖导入前清空完成归档，避免旧快照挂在新任务上 */
    public int clearWorkspace(String workspaceId) {
        return recordMapper.deleteAllByWorkspace(workspaceId);
    }

    /** 彻底删除任务后快照仍保留，因此该 ID 不允许再被新任务复用 */
    public boolean hasSnapshot(String workspaceId, String taskId) {
        if (workspaceId == null || taskId == null) {
            return false;
        }
        return recordMapper.countByTaskId(workspaceId, taskId) > 0;
    }

    private String truncate(String s, int max) {
        if (s == null) {
            return null;
        }
        String t = s.trim();
        return t.length() <= max ? t : t.substring(0, max);
    }
}
