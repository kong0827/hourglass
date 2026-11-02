package com.devstudio.kanban.mapper;

import com.devstudio.kanban.dto.ManagementActivityRow;
import com.devstudio.kanban.dto.ManagementCompletionRow;
import com.devstudio.kanban.dto.ManagementPersonTimeRow;
import com.devstudio.kanban.dto.ManagementTimeRow;
import com.devstudio.kanban.dto.ManagementWeeklyRow;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.time.LocalDate;
import java.util.List;

/** 管理层驾驶舱聚合查询：固定条数，不逐项目 N+1。 */
@Mapper
public interface ManagementMapper {

    List<ManagementTimeRow> timeByProject(@Param("workspaceId") String workspaceId);

    List<ManagementPersonTimeRow> timeByProjectUser(@Param("workspaceId") String workspaceId,
                                                    @Param("reqId") String reqId);

    List<ManagementActivityRow> lastActivity(@Param("workspaceId") String workspaceId);

    java.time.LocalDate earliestCompletion(@Param("workspaceId") String workspaceId);

    List<ManagementCompletionRow> lastCompletionByProject(@Param("workspaceId") String workspaceId);

    int workMinutesRange(@Param("workspaceId") String workspaceId,
                         @Param("from") java.time.LocalDateTime from,
                         @Param("to") java.time.LocalDateTime to);

    List<ManagementWeeklyRow> completedWeeklyByProject(@Param("workspaceId") String workspaceId,
                                                       @Param("reqId") String reqId,
                                                       @Param("from") LocalDate from,
                                                       @Param("to") LocalDate to);

    List<ManagementWeeklyRow> completedWeekly(@Param("workspaceId") String workspaceId,
                                              @Param("from") LocalDate from,
                                              @Param("to") LocalDate to);

    List<ManagementWeeklyRow> createdWeekly(@Param("workspaceId") String workspaceId,
                                            @Param("from") LocalDate from,
                                            @Param("to") LocalDate to);
}
