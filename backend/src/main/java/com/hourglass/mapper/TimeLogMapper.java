package com.hourglass.mapper;

import com.hourglass.entity.TimeAgg;
import com.hourglass.entity.TimeLog;
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

    /** 备份导入：按批多值写入已完成的工时 */
    int insertCompletedBatch(@Param("list") List<TimeLog> list);

    /** 工时记录列表（任务抽屉展示：已结束的计时 + 手工补记，按时间倒序） */
    List<TimeLog> selectRecordsByTask(@Param("workspaceId") String workspaceId,
                                      @Param("taskId") String taskId,
                                      @Param("limit") int limit);

    TimeLog selectById(@Param("id") Long id);

    /** 删除单条工时记录（服务层保证只删已结束的记录） */
    int deleteById(@Param("id") Long id, @Param("workspaceId") String workspaceId);

    int deleteByTaskIds(@Param("workspaceId") String workspaceId, @Param("taskIds") List<String> taskIds);

    int deleteAllByWorkspace(@Param("workspaceId") String workspaceId);

    /** 某人在某空间的累计工时（统计报表用） */
    Integer sumByWorkspaceUser(@Param("workspaceId") String workspaceId, @Param("userId") String userId);

    /**
     * 某用户某一天已记录的工时（跨空间、按 started_at 归日）。
     * 用于「每人每天最多 8 小时」的额度计算。
     */
    Integer sumMinutesByUserOnDate(@Param("userId") String userId, @Param("date") java.time.LocalDate date);

    /** 某任务计时的时间边界（首次开始 / 最后结束），任务完成快照用 */
    com.hourglass.entity.TimeBounds selectBoundsByTask(@Param("workspaceId") String workspaceId,
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

    /** 本空间 [from, to) 区间按成员分组的工时（分钟）；viewerId 非空时排除不可见项目 */
    List<TimeAgg> sumBetweenByWorkspaceGroupByUser(@Param("workspaceId") String workspaceId,
                                                   @Param("from") LocalDateTime from,
                                                   @Param("to") LocalDateTime to,
                                                   @Param("viewerId") String viewerId);

    /** 本空间 [from, to) 区间的计时原始记录（甘特负载用，按 started_at 走索引） */
    List<com.hourglass.entity.TimeLog> selectByWorkspaceBetween(
            @Param("workspaceId") String workspaceId,
            @Param("from") LocalDateTime from,
            @Param("to") LocalDateTime to);

    /** 按成员分组统计本空间工时（下钻用，user_id 回填在 TimeAgg.userId） */
    List<TimeAgg> sumByWorkspaceGroupByUser(@Param("workspaceId") String workspaceId);

    /* ---- BE-Q-3：统计页 / 回顾页 / 甘特负载一次聚合 ---- */

    /**
     * 本空间工时合计：[from, to) 区间内 + 累计，全空间 + 我。
     * {@code to} 为空时不设上界（报表「近 N 周」的当周就是至今）。
     */
    com.hourglass.dto.WorkSumRow sumWork(@Param("workspaceId") String workspaceId,
                                                @Param("userId") String userId,
                                                @Param("from") LocalDateTime from,
                                                @Param("to") LocalDateTime to,
                                                @Param("viewerId") String viewerId);

    /** 甘特负载：限定任务集合，按时计人 + 周聚合实际工时（不再拉原始记录） */
    List<com.hourglass.dto.UserWeekRow> sumUserWeeklyMinutes(
            @Param("workspaceId") String workspaceId,
            @Param("from") LocalDateTime from, @Param("to") LocalDateTime to,
            @Param("taskIds") List<String> taskIds);

    /** M1 阶段统计：项目内工时按「计时人 × 自然日」聚合（归组由服务层按首版上线日完成） */
    List<com.hourglass.dto.UserDayRow> sumUserDayMinutesByReq(
            @Param("workspaceId") String workspaceId, @Param("reqId") String reqId);

    /**
     * 成员阶段工时下钻：按「任务 × 阶段」聚合该成员自己的计时，
     * 阶段按计时自然日 vs 首版上线日判定（与阶段卡 memberHours 同口径）。
     */
    List<com.hourglass.dto.PhaseMemberTask> sumMemberTaskPhaseByReq(
            @Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
            @Param("userId") String userId);
}
