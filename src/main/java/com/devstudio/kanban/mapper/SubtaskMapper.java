package com.devstudio.kanban.mapper;

import com.devstudio.kanban.entity.Subtask;
import com.devstudio.kanban.entity.SubtaskAgg;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface SubtaskMapper {

    List<Subtask> selectByTaskId(@Param("workspaceId") String workspaceId, @Param("taskId") String taskId);

    List<Subtask> selectAll(@Param("workspaceId") String workspaceId);

    Subtask selectById(Long id);

    int insert(Subtask subtask);

    int update(Subtask subtask);

    int deleteById(Long id);

    int deleteByTaskId(@Param("workspaceId") String workspaceId, @Param("taskId") String taskId);

    int deleteAllByWorkspace(@Param("workspaceId") String workspaceId);

    List<SubtaskAgg> countByTask(@Param("workspaceId") String workspaceId);
    List<SubtaskAgg> countByTaskIds(@Param("workspaceId") String workspaceId, @Param("taskIds") List<String> taskIds);
}
