package com.devstudio.kanban.mapper;

import com.devstudio.kanban.entity.GanttShare;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface GanttShareMapper {

    GanttShare selectByWorkspace(@Param("workspaceId") String workspaceId);

    GanttShare selectByToken(@Param("token") String token);

    int upsert(GanttShare share);

    int deleteByWorkspace(@Param("workspaceId") String workspaceId);
}
