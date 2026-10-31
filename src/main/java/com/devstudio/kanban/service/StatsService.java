package com.devstudio.kanban.service;

import com.devstudio.kanban.dto.BoardResponse;
import com.devstudio.kanban.dto.NameCountRow;
import com.devstudio.kanban.dto.StatsResponse;
import com.devstudio.kanban.dto.TaskBucketRow;
import com.devstudio.kanban.dto.WeekCountRow;
import com.devstudio.kanban.dto.WorkSumRow;
import com.devstudio.kanban.mapper.TaskMapper;
import com.devstudio.kanban.mapper.TimeLogMapper;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.util.HashMap;
import java.util.Map;

@Service
public class StatsService {

    private final TaskMapper taskMapper;
    private final TimeLogMapper timeLogMapper;

    public StatsService(TaskMapper taskMapper, TimeLogMapper timeLogMapper) {
        this.taskMapper = taskMapper;
        this.timeLogMapper = timeLogMapper;
    }

    /** 近 N 周：每周新增/完成；窗口内完成按分类与负责人分布；当前积压与逾期（按空间隔离，工时按"我"统计） */
    public StatsResponse stats(String workspaceId, String userId, Integer weeks) {
        int w = weeks == null ? 8 : Math.max(4, Math.min(26, weeks));
        LocalDate today = LocalDate.now();
        LocalDate monday = today.minusDays(today.getDayOfWeek().getValue() - 1);
        LocalDate rangeStart = monday.minusWeeks(w - 1);
        /* 日期列比较统一用「上界 + 1 天」的开区间，避免 DATE/DATETIME 混用 */
        LocalDate before = today.plusDays(1);

        StatsResponse resp = new StatsResponse();

        /* 周聚合：SQL UNION ALL + GROUP BY，移除了「周数 × 全部任务」的双重循环 */
        Map<String, int[]> byWeek = new HashMap<String, int[]>();
        for (WeekCountRow row : taskMapper.countCreatedCompletedByWeek(workspaceId, rangeStart, before)) {
            if (row.getWeekStart() != null) {
                byWeek.put(row.getWeekStart().toString(),
                        new int[]{row.getCreated(), row.getCompleted()});
            }
        }
        for (int i = w - 1; i >= 0; i--) {
            LocalDate start = monday.minusWeeks(i);
            LocalDate end = start.plusDays(6);
            StatsResponse.WeekStat stat = new StatsResponse.WeekStat();
            stat.setStart(start.toString());
            stat.setEnd(end.toString());
            int[] c = byWeek.get(start.toString());
            stat.setCreated(c == null ? 0 : c[0]);
            stat.setCompleted(c == null ? 0 : c[1]);
            resp.getWeeks().add(stat);
        }

        for (NameCountRow row : taskMapper.countCompletedByCategory(workspaceId, rangeStart, before)) {
            resp.getByCategory().add(new BoardResponse.NameCount(row.getName(), row.getCnt()));
        }
        for (NameCountRow row : taskMapper.countCompletedByOwner(workspaceId, rangeStart, before)) {
            resp.getByOwner().add(new BoardResponse.NameCount(row.getName(), row.getCnt()));
        }

        TaskBucketRow buckets = taskMapper.countBuckets(workspaceId, today);
        StatsResponse.Current current = new StatsResponse.Current();
        current.setBacklog(buckets.getBacklog());
        current.setDoing(buckets.getDoing());
        current.setDone(buckets.getDone());
        current.setOther(buckets.getOther());
        current.setOverdue(buckets.getOverdue());

        /* 工时：累计 / 本周 × 全空间 / 我，一次聚合 */
        WorkSumRow work = timeLogMapper.sumWork(workspaceId, userId, monday.atStartOfDay(), null);
        if (work != null) {
            current.setWorkMinutes(work.getTotalMine());
            current.setWorkMinutesWeek(work.getWeekMine());
            current.setWorkMinutesAll(work.getTotalAll());
            current.setWorkMinutesWeekAll(work.getWeekAll());
        }
        resp.setCurrent(current);
        return resp;
    }
}
