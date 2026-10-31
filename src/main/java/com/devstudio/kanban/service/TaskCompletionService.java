package com.devstudio.kanban.service;

import com.devstudio.kanban.entity.Requirement;
import com.devstudio.kanban.entity.RequirementDoc;
import com.devstudio.kanban.entity.Task;
import com.devstudio.kanban.entity.TaskCompletionRecord;
import com.devstudio.kanban.entity.TimeBounds;
import com.devstudio.kanban.mapper.RequirementDocMapper;
import com.devstudio.kanban.mapper.RequirementMapper;
import com.devstudio.kanban.mapper.TaskCompletionRecordMapper;
import com.devstudio.kanban.mapper.TimeLogMapper;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.time.YearMonth;
import java.util.List;

/**
 * 任务完成快照：任务完成的那一刻把「名称 / 详情 / 归属项目 / 负责人 / 起止时间 / 总耗时」
 * 存成一条**独立记录**，之后任务改名、换项目、被删除都不影响已归档的统计。
 *
 * <p>写入由 TaskService 在移入「已完成」时触发，前端不用关心。
 */
@Service
public class TaskCompletionService {

    /** 详情快照最大长度（与表字段一致） */
    private static final int DESC_MAX = 200;

    private final TaskCompletionRecordMapper recordMapper;
    private final TimeLogMapper timeLogMapper;
    private final RequirementMapper reqMapper;
    private final RequirementDocMapper requirementDocMapper;

    public TaskCompletionService(TaskCompletionRecordMapper recordMapper, TimeLogMapper timeLogMapper,
                                 RequirementMapper reqMapper, RequirementDocMapper requirementDocMapper) {
        this.recordMapper = recordMapper;
        this.timeLogMapper = timeLogMapper;
        this.reqMapper = reqMapper;
        this.requirementDocMapper = requirementDocMapper;
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
        r.setCategory(t.getCategory());
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

    /** 取消完成时删掉该任务的记录（再次完成会重新生成） */
    public void remove(String workspaceId, String taskId) {
        if (workspaceId == null || taskId == null) {
            return;
        }
        recordMapper.deleteByTaskId(workspaceId, taskId);
    }

    /** 按月查询（month 为 null 时取当月） */
    public List<TaskCompletionRecord> listByMonth(String workspaceId, YearMonth month) {
        YearMonth ym = month == null ? YearMonth.now() : month;
        LocalDate from = ym.atDay(1);
        return recordMapper.selectByRange(workspaceId, from, from.plusMonths(1));
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
