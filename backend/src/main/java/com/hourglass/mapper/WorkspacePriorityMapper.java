package com.hourglass.mapper;

import com.hourglass.entity.WorkspacePriority;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface WorkspacePriorityMapper {

    List<WorkspacePriority> selectByWorkspace(@Param("workspaceId") String workspaceId);

    WorkspacePriority selectByCode(@Param("workspaceId") String workspaceId, @Param("code") String code);

    int insert(WorkspacePriority priority);

    int update(WorkspacePriority priority);

    int deleteAllByWorkspace(@Param("workspaceId") String workspaceId);
}
