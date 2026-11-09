package com.hourglass.service;

import com.hourglass.common.TaskCalc;
import com.hourglass.dto.TaskBucketRow;
import com.hourglass.dto.WorkSumRow;
import com.hourglass.entity.BoardColumn;
import com.hourglass.entity.Task;
import com.hourglass.mapper.TaskCompletionRecordMapper;
import com.hourglass.mapper.TaskMapper;
import com.hourglass.mapper.TimeLogMapper;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

/**
 * 分析类页面的统一聚合层（IA-1）。
 *
 * <p>趋势、完成记录、流程体检、周回顾都各自算过"完成数 / 工时 / 逾期"，
 * 口径散落在各 Service 里。这里收口三件最容易算错的事：
 * <ul>
 *   <li>逾期：统一走 {@link TaskCalc#dueKind}（与看板、日历完全一致）；</li>
 *   <li>工时：统一走 {@link TimeLogMapper#sumWork}（累计 / 本周期 × 全空间 / 我）；</li>
 *   <li>完成数：以完成快照表 {@code task_completion_record} 为准（任务后来被删也不影响历史统计）。</li>
 * </ul>
 *
 * <p>注意：趋势图的历史"完成"仍读任务表的 completed_at —— 旧数据在执行
 * sql/06 的可选回填之前没有快照；在回填完成前切换会让历史趋势突然归零，因此本版本只做汇总口径统一，
 * 不替换趋势数据源（完成记录页本身一直读快照）。
 */
@Service
public class MetricsService {

    private final TaskMapper taskMapper;
    private final TimeLogMapper timeLogMapper;
    private final TaskCompletionRecordMapper completionMapper;
    private final WorkspaceMetaCache metaCache;

    public MetricsService(TaskMapper taskMapper, TimeLogMapper timeLogMapper,
                          TaskCompletionRecordMapper completionMapper, WorkspaceMetaCache metaCache) {
        this.taskMapper = taskMapper;
        this.timeLogMapper = timeLogMapper;
        this.completionMapper = completionMapper;
        this.metaCache = metaCache;
    }

    /** 该周期内完成的条数（完成快照口径，已排除彻底删除造成的历史丢失） */
    public int completedCount(String workspaceId, LocalDate from, LocalDate toExclusive) {
        return completionMapper.countByRange(workspaceId, from, toExclusive);
    }

    /** 逾期任务：与看板/日历共用 dueKind，不再各写一套日期比较 */
    public List<Task> overdue(List<Task> tasks, LocalDate today) {
        List<Task> out = new ArrayList<Task>();
        if (tasks == null) {
            return out;
        }
        for (Task t : tasks) {
            String rule = processingRuleOf(t.getWorkspaceId(), t.getBoardColumn());
            if ("over".equals(TaskCalc.dueKind(t.getBoardColumn(), rule, t.getDueDate(), today))) {
                out.add(t);
            }
        }
        return out;
    }

    private String processingRuleOf(String workspaceId, String column) {
        if ("done".equals(column)) {
            return "done";
        }
        if ("backlog".equals(column)) {
            return "backlog";
        }
        BoardColumn c = metaCache.column(workspaceId, column);
        String rule = c == null ? null : c.getProcessingRule();
        return rule == null ? "normal" : rule;
    }

    /** 当前各列计数 + 逾期（看板/报表/流程体检共用） */
    public TaskBucketRow buckets(String workspaceId, String viewerId, LocalDate today) {
        return taskMapper.countBuckets(workspaceId, viewerId, today);
    }

    /** 工时汇总：累计 / 本周期 × 全空间 / 我（一次 SQL；viewerId 非空时排除不可见项目） */
    public WorkSumRow workMinutes(String workspaceId, String userId, LocalDateTime from, String viewerId) {
        return timeLogMapper.sumWork(workspaceId, userId, from, null, viewerId, null);
    }
}
