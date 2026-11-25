package com.hourglass.mapper;

import com.hourglass.dto.CatchupPlanRow;
import com.hourglass.dto.CatchupTaskRow;
import com.hourglass.dto.CatchupTimeCell;
import com.hourglass.dto.CatchupTimeSum;
import com.hourglass.entity.CatchupCarry;
import com.hourglass.entity.CatchupDecision;
import com.hourglass.entity.CatchupSession;
import com.hourglass.entity.CatchupTimeAlloc;
import com.hourglass.entity.CatchupWrite;
import com.hourglass.entity.TaskLog;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

/**
 * 周五补记的数据访问。
 *
 * <p>草稿线索全部来自已有事实：我负责/我计过时的工作项、本周计时、我执行的测试计划；
 * 补记本身只写「确认记录 + 工时归属」，不改工作项状态（风险解除阻塞除外，且可撤销）。
 */
@Mapper
public interface CatchupMapper {

    CatchupSession selectSession(@Param("workspaceId") String workspaceId,
                                 @Param("userId") String userId,
                                 @Param("weekStart") LocalDate weekStart);

    /** 提交/撤销前锁住会话行，重复点击时第二个请求会看到已变更的状态而不是重复写时间线。 */
    CatchupSession lockSession(@Param("workspaceId") String workspaceId,
                               @Param("userId") String userId,
                               @Param("weekStart") LocalDate weekStart);

    int insertSession(CatchupSession session);

    int updateSession(CatchupSession session);

    /** 本周与我有关的工作项：我负责、我计过时，且本周有完成/更新/创建。 */
    List<CatchupTaskRow> selectMyTasksForWeek(@Param("workspaceId") String workspaceId,
                                              @Param("userId") String userId,
                                              @Param("displayName") String displayName,
                                              @Param("from") LocalDateTime from,
                                              @Param("to") LocalDateTime to,
                                              @Param("viewerId") String viewerId);

    List<CatchupTimeSum> selectMyTimeByTask(@Param("workspaceId") String workspaceId,
                                            @Param("userId") String userId,
                                            @Param("from") LocalDateTime from,
                                            @Param("to") LocalDateTime to);

    List<CatchupTimeCell> selectMyTimeGrid(@Param("workspaceId") String workspaceId,
                                           @Param("userId") String userId,
                                           @Param("from") LocalDateTime from,
                                           @Param("to") LocalDateTime to,
                                           @Param("viewerId") String viewerId);

    int countMyTimeRecords(@Param("workspaceId") String workspaceId,
                           @Param("userId") String userId,
                           @Param("from") LocalDateTime from,
                           @Param("to") LocalDateTime to);

    List<CatchupPlanRow> selectMyDonePlans(@Param("workspaceId") String workspaceId,
                                           @Param("userId") String userId,
                                           @Param("from") LocalDateTime from,
                                           @Param("to") LocalDateTime to,
                                           @Param("viewerId") String viewerId);

    List<CatchupDecision> selectDecisions(@Param("sessionId") String sessionId);

    int upsertDecision(CatchupDecision decision);

    int deleteDecisions(@Param("sessionId") String sessionId);

    int deleteDecision(@Param("sessionId") String sessionId, @Param("draftKey") String draftKey);

    List<CatchupTimeAlloc> selectAllocs(@Param("sessionId") String sessionId);

    int deleteAllocs(@Param("sessionId") String sessionId);

    int insertAlloc(CatchupTimeAlloc alloc);

    /** 补记写入时间线；需要回填自增 ID 供撤销删除。 */
    int insertTaskLog(TaskLog log);

    int deleteTaskLog(@Param("workspaceId") String workspaceId, @Param("id") Long id);

    int updateTaskBlocked(@Param("workspaceId") String workspaceId,
                          @Param("taskId") String taskId,
                          @Param("blocked") boolean blocked,
                          @Param("reason") String reason);

    int insertWrite(CatchupWrite write);

    List<CatchupWrite> selectWrites(@Param("sessionId") String sessionId);

    int deleteWrites(@Param("sessionId") String sessionId);

    /** 工作项所属项目；用于补记写入前的项目级权限校验。 */
    String selectTaskReqId(@Param("workspaceId") String workspaceId, @Param("taskId") String taskId);

    /** 早先提交的本周会话承接过来的项。 */
    List<CatchupCarry> selectCarryForWeek(@Param("workspaceId") String workspaceId,
                                          @Param("userId") String userId,
                                          @Param("toWeekStart") LocalDate toWeekStart,
                                          @Param("viewerId") String viewerId);

    int insertCarry(CatchupCarry carry);

    int deleteCarryBySession(@Param("sessionId") String sessionId);

    /** 清理本人在该空间内更早周的承接记录。 */
    int deleteCarryBefore(@Param("workspaceId") String workspaceId,
                          @Param("userId") String userId,
                          @Param("beforeWeek") LocalDate beforeWeek);
}
