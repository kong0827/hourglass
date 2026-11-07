package com.hourglass.mapper;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface TaskWatchMapper {

    int insertIgnore(@Param("workspaceId") String workspaceId, @Param("taskId") String taskId,
                     @Param("userId") String userId);

    int delete(@Param("workspaceId") String workspaceId, @Param("taskId") String taskId,
               @Param("userId") String userId);

    int countByTask(@Param("workspaceId") String workspaceId, @Param("taskId") String taskId);

    int countMine(@Param("workspaceId") String workspaceId, @Param("taskId") String taskId,
                  @Param("userId") String userId);

    List<String> selectUserIdsByTask(@Param("workspaceId") String workspaceId,
                                     @Param("taskId") String taskId);

    int deleteByTaskIds(@Param("workspaceId") String workspaceId, @Param("taskIds") List<String> taskIds);

    int deleteAllByWorkspace(@Param("workspaceId") String workspaceId);

    int deleteByWorkspaceUser(@Param("workspaceId") String workspaceId, @Param("userId") String userId);

    int deleteAllByUser(@Param("userId") String userId);
}
