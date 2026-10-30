package com.devstudio.kanban.mapper;

import com.devstudio.kanban.entity.TaskDependency;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface TaskDependencyMapper {

    List<TaskDependency> selectByWorkspace(@Param("workspaceId") String workspaceId);

    TaskDependency selectById(@Param("id") String id);

    int countEdge(@Param("fromTaskId") String fromTaskId, @Param("toTaskId") String toTaskId);

    int insert(TaskDependency dep);

    int update(TaskDependency dep);

    int deleteById(@Param("id") String id, @Param("workspaceId") String workspaceId);

    /** 任务被彻底删除时清理相关依赖 */
    int deleteByTask(@Param("workspaceId") String workspaceId, @Param("taskId") String taskId);

    /** 空间被删除 / 清空时清理全部依赖 */
    int deleteByWorkspace(@Param("workspaceId") String workspaceId);

    int countByWorkspace(@Param("workspaceId") String workspaceId);
}
