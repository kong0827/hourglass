package com.devstudio.kanban.mapper;

import com.devstudio.kanban.entity.TaskLog;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface TaskLogMapper {

    int insert(TaskLog log);

    /** 查询/删除一律带空间条件：任务 ID 跨空间复用时防止误读误删 */
    List<TaskLog> selectByTaskId(@Param("workspaceId") String workspaceId, @Param("taskId") String taskId);

    /** 该任务最近一次“移入已完成列”之前所在的列；没有结构化日志时返回 null */
    String selectLastDoneFromColumn(@Param("workspaceId") String workspaceId, @Param("taskId") String taskId);

    /**
     * 空间级活动流（O-9）：倒序取 limit 条。
     * viewerId 非空时过滤隐藏项目；includeConfig 为 false 时连配置类哨兵事件（task_id = CFG）一并隐藏，
     * 避免成员从审计文案看到自己无权访问的项目名或成员变更。
     */
    List<TaskLog> selectByWorkspace(@Param("workspaceId") String workspaceId,
                                    @Param("viewerId") String viewerId,
                                    @Param("includeConfig") boolean includeConfig,
                                    @Param("limit") int limit);

    /**
     * 某个时间段内"有活动"的任务 ID（去重）。
     * 周回顾看历史周期时用它判断"那一周确实碰过哪些任务" —— 没有状态快照，
     * 只能靠日志近似还原，否则切到上周会把本周才开工的任务也列进去。
     */
    List<String> selectActiveTaskIds(@Param("workspaceId") String workspaceId,
                                     @Param("from") java.time.LocalDate from,
                                     @Param("to") java.time.LocalDate to);

    int deleteByTaskIds(@Param("workspaceId") String workspaceId, @Param("taskIds") List<String> taskIds);

    /** 删除项目时给仍挂在该项目下的任务（含回收站）批量补「解除关联」时间线，一条 INSERT ... SELECT */
    int insertUnlinkReqLogs(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                            @Param("actorId") String actorId, @Param("detail") String detail);

    int deleteAllByWorkspace(@Param("workspaceId") String workspaceId);
}
