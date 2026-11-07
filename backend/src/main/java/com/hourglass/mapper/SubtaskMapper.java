package com.hourglass.mapper;

import com.hourglass.entity.Subtask;
import com.hourglass.entity.SubtaskAgg;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface SubtaskMapper {

    List<Subtask> selectByTaskId(@Param("workspaceId") String workspaceId, @Param("taskId") String taskId);

    List<Subtask> selectAll(@Param("workspaceId") String workspaceId);

    Subtask selectById(Long id);

    int insert(Subtask subtask);

    /** 备份导入：按批多值写入 */
    int insertBatch(@Param("list") List<Subtask> list);

    int update(Subtask subtask);

    int deleteById(Long id);

    int deleteByTaskIds(@Param("workspaceId") String workspaceId, @Param("taskIds") List<String> taskIds);

    int deleteAllByWorkspace(@Param("workspaceId") String workspaceId);

    List<SubtaskAgg> countByTask(@Param("workspaceId") String workspaceId);
    List<SubtaskAgg> countByTaskIds(@Param("workspaceId") String workspaceId, @Param("taskIds") List<String> taskIds);
}
