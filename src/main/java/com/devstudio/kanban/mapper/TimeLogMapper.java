package com.devstudio.kanban.mapper;

import com.devstudio.kanban.entity.TimeAgg;
import com.devstudio.kanban.entity.TimeLog;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.time.LocalDateTime;
import java.util.List;

@Mapper
public interface TimeLogMapper {

    /** 某人某任务当前运行中的计时（计时按人） */
    TimeLog selectRunningByTaskAndUser(@Param("taskId") String taskId, @Param("userId") String userId);

    /** 某任务全部成员运行中的计时（任务完成/删除时统一结算） */
    List<TimeLog> selectRunningByTask(@Param("workspaceId") String workspaceId, @Param("taskId") String taskId);

    /** 某计时人当前运行中的计时（跨空间，同一人同一时刻只计一件事） */
    List<TimeLog> selectRunningAllByUser(@Param("userId") String userId);

    List<TimeLog> selectAllByWorkspace(@Param("workspaceId") String workspaceId);

    /** 任务累计工时（不区分计时人，用于卡片/任务角标） */
    List<TimeAgg> sumByTaskByWorkspace(@Param("workspaceId") String workspaceId);
    /** 本页任务的累计工时（按 id 批量） */
    List<TimeAgg> sumByTaskIds(@Param("workspaceId") String workspaceId, @Param("taskIds") List<String> taskIds);

    /** 结算某人在某任务上的运行中计时 */
    int closeRunning(@Param("taskId") String taskId, @Param("userId") String userId,
                     @Param("minutes") int minutes);

    int insert(TimeLog timeLog);

    int insertCompleted(TimeLog timeLog);

    int deleteByTaskId(@Param("workspaceId") String workspaceId, @Param("taskId") String taskId);

    int deleteAllByWorkspace(@Param("workspaceId") String workspaceId);

    /** 某人在某空间的累计工时（统计报表用） */
    Integer sumByWorkspaceUser(@Param("workspaceId") String workspaceId, @Param("userId") String userId);

    /**
     * 某用户某一天已记录的工时（跨空间、按 started_at 归日）。
     * 用于「每人每天最多 8 小时」的额度计算。
     */
    Integer sumMinutesByUserOnDate(@Param("userId") String userId, @Param("date") java.time.LocalDate date);

    /** 某任务计时的时间边界（首次开始 / 最后结束），任务完成快照用 */
    com.devstudio.kanban.entity.TimeBounds selectBoundsByTask(@Param("workspaceId") String workspaceId,
                                                             @Param("taskId") String taskId);

    Integer sumSinceByWorkspaceUser(@Param("workspaceId") String workspaceId, @Param("userId") String userId,
                                    @Param("from") LocalDateTime from);

    /** 某任务累计分钟（带空间条件，防任务 ID 跨空间复用串数） */
    Integer sumByTaskId(@Param("workspaceId") String workspaceId, @Param("taskId") String taskId);

    /* ---- N-5：团队工时可见 ---- */

    /** 本空间全员累计工时（分钟） */
    Integer sumByWorkspace(@Param("workspaceId") String workspaceId);

    /** 本空间自 from 起全员工时（分钟） */
    Integer sumSinceByWorkspace(@Param("workspaceId") String workspaceId, @Param("from") LocalDateTime from);

    /** 本空间 [from, to) 区间全员工时（分钟） */
    Integer sumBetweenByWorkspace(@Param("workspaceId") String workspaceId,
                                  @Param("from") LocalDateTime from,
                                  @Param("to") LocalDateTime to);

    /** 按成员分组统计本空间工时（下钻用，user_id 回填在 TimeAgg.userId） */
    List<TimeAgg> sumByWorkspaceGroupByUser(@Param("workspaceId") String workspaceId);
}
