package com.devstudio.kanban.service;

import com.devstudio.kanban.common.Consts;
import com.devstudio.kanban.dto.BoardResponse;
import com.devstudio.kanban.dto.StatsResponse;
import com.devstudio.kanban.entity.Task;
import com.devstudio.kanban.mapper.TaskMapper;
import com.devstudio.kanban.mapper.TimeLogMapper;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.List;
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

        List<Task> all = taskMapper.selectAll(workspaceId);
        StatsResponse resp = new StatsResponse();

        for (int i = w - 1; i >= 0; i--) {
            LocalDate start = monday.minusWeeks(i);
            LocalDate end = start.plusDays(6);
            StatsResponse.WeekStat stat = new StatsResponse.WeekStat();
            stat.setStart(start.toString());
            stat.setEnd(end.toString());
            int created = 0;
            int completed = 0;
            for (Task t : all) {
                LocalDate createdDate = t.getCreatedAt() == null ? null : t.getCreatedAt().toLocalDate();
                if (createdDate != null && !createdDate.isBefore(start) && !createdDate.isAfter(end)) {
                    created++;
                }
                if (Consts.COL_DONE.equals(t.getBoardColumn()) && t.getCompletedAt() != null
                        && !t.getCompletedAt().isBefore(start) && !t.getCompletedAt().isAfter(end)) {
                    completed++;
                }
            }
            stat.setCreated(created);
            stat.setCompleted(completed);
            resp.getWeeks().add(stat);
        }

        Map<String, Integer> catCount = new LinkedHashMap<String, Integer>();
        Map<String, Integer> ownerCount = new LinkedHashMap<String, Integer>();
        for (Task t : all) {
            if (!Consts.COL_DONE.equals(t.getBoardColumn()) || t.getCompletedAt() == null) {
                continue;
            }
            if (t.getCompletedAt().isBefore(rangeStart) || t.getCompletedAt().isAfter(today)) {
                continue;
            }
            catCount.merge(t.getCategory(), 1, Integer::sum);
            ownerCount.merge(t.getOwner(), 1, Integer::sum);
        }
        for (Map.Entry<String, Integer> e : catCount.entrySet()) {
            resp.getByCategory().add(new BoardResponse.NameCount(e.getKey(), e.getValue()));
        }
        for (Map.Entry<String, Integer> e : ownerCount.entrySet()) {
            resp.getByOwner().add(new BoardResponse.NameCount(e.getKey(), e.getValue()));
        }

        StatsResponse.Current current = new StatsResponse.Current();
        for (Task t : all) {
            if (Consts.COL_BACKLOG.equals(t.getBoardColumn())) {
                current.setBacklog(current.getBacklog() + 1);
            } else if (Consts.COL_DOING.equals(t.getBoardColumn())) {
                current.setDoing(current.getDoing() + 1);
            } else if (Consts.COL_DONE.equals(t.getBoardColumn())) {
                current.setDone(current.getDone() + 1);
            } else {
                current.setOther(current.getOther() + 1);
            }
            if (!Consts.COL_DONE.equals(t.getBoardColumn()) && t.getDueDate() != null
                    && t.getDueDate().isBefore(today)) {
                current.setOverdue(current.getOverdue() + 1);
            }
        }
        Integer workTotal = timeLogMapper.sumByWorkspaceUser(workspaceId, userId);
        Integer workWeek = timeLogMapper.sumSinceByWorkspaceUser(workspaceId, userId, monday.atStartOfDay());
        current.setWorkMinutes(workTotal == null ? 0 : workTotal);
        current.setWorkMinutesWeek(workWeek == null ? 0 : workWeek);
        /* N-5：team 口径（本空间全员合计），供报表页「仅我 / 全空间」切换 */
        Integer allTotal = timeLogMapper.sumByWorkspace(workspaceId);
        Integer allWeek = timeLogMapper.sumSinceByWorkspace(workspaceId, monday.atStartOfDay());
        current.setWorkMinutesAll(allTotal == null ? 0 : allTotal);
        current.setWorkMinutesWeekAll(allWeek == null ? 0 : allWeek);
        resp.setCurrent(current);
        return resp;
    }
}
