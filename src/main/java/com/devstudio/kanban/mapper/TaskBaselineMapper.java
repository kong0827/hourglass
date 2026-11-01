package com.devstudio.kanban.mapper;

import com.devstudio.kanban.entity.TaskBaseline;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.time.LocalDateTime;
import java.util.List;

@Mapper
public interface TaskBaselineMapper {

    List<TaskBaseline> selectByWorkspace(@Param("workspaceId") String workspaceId);

    /** 最近一次快照时间；没有基线时返回 null */
    LocalDateTime selectCapturedAt(@Param("workspaceId") String workspaceId);

    int deleteByWorkspace(@Param("workspaceId") String workspaceId);

    int deleteByTaskIds(@Param("workspaceId") String workspaceId, @Param("taskIds") List<String> taskIds);

    int insertBatch(@Param("list") List<TaskBaseline> list);
}
