package com.devstudio.kanban.mapper;

import com.devstudio.kanban.entity.TaskDependency;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface TaskDependencyMapper {

    List<TaskDependency> selectByWorkspace(@Param("workspaceId") String workspaceId);

    /** 甘特读接口：viewerId 非空时跳过任一端位于隐藏项目的依赖 */
    List<TaskDependency> selectVisibleByWorkspace(@Param("workspaceId") String workspaceId,
                                                  @Param("viewerId") String viewerId);

    TaskDependency selectById(@Param("id") String id);

    int countEdge(@Param("fromTaskId") String fromTaskId, @Param("toTaskId") String toTaskId);

    int insert(TaskDependency dep);

    /** 备份导入：多行 INSERT IGNORE（uk_edge 冲突跳过） */
    int insertBatch(@Param("list") List<TaskDependency> list);

    int update(TaskDependency dep);

    int deleteById(@Param("id") String id, @Param("workspaceId") String workspaceId);

    /** 批量彻底删除：删除任一端的任务都要清掉这条边 */
    int deleteByTaskIds(@Param("workspaceId") String workspaceId, @Param("taskIds") List<String> taskIds);

    /** 空间被删除 / 清空时清理全部依赖 */
    int deleteByWorkspace(@Param("workspaceId") String workspaceId);

    int countByWorkspace(@Param("workspaceId") String workspaceId);
}
