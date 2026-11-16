package com.hourglass.mapper;

import com.hourglass.entity.TaskPublicationJudgement;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface TaskPublicationJudgementMapper {

    /** 当前生效标记；无生效记录返回 null */
    TaskPublicationJudgement selectActive(@Param("workspaceId") String workspaceId,
                                          @Param("taskId") String taskId);

    /** 批量读当前生效标记（列表投影用），只返回 task_id 与关键字段 */
    List<TaskPublicationJudgement> selectActiveByTasks(@Param("workspaceId") String workspaceId,
                                                       @Param("taskIds") List<String> taskIds);

    List<TaskPublicationJudgement> selectHistory(@Param("workspaceId") String workspaceId,
                                                 @Param("taskId") String taskId,
                                                 @Param("offset") int offset, @Param("limit") int limit);

    int countHistory(@Param("workspaceId") String workspaceId, @Param("taskId") String taskId);

    int insert(TaskPublicationJudgement judgement);

    /** 只撤销当前生效记录；返回 0 表示已被其他操作撤销 */
    int revoke(@Param("id") Long id, @Param("revokedByUserId") String revokedByUserId,
               @Param("revokedByName") String revokedByName, @Param("revokeReason") String revokeReason);

    int deleteByTasks(@Param("workspaceId") String workspaceId, @Param("taskIds") List<String> taskIds);

    int deleteByWorkspace(@Param("workspaceId") String workspaceId);
}
