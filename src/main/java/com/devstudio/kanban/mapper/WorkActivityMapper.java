package com.devstudio.kanban.mapper;

import com.devstudio.kanban.entity.WorkActivity;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface WorkActivityMapper {

    int insert(WorkActivity activity);

    List<WorkActivity> selectByEntity(@Param("workspaceId") String workspaceId,
                                      @Param("entityType") String entityType,
                                      @Param("entityId") String entityId,
                                      @Param("limit") int limit);
}
