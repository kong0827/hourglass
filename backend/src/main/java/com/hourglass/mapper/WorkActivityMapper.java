package com.hourglass.mapper;

import com.hourglass.entity.WorkActivity;
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

    int deleteByEntity(@Param("workspaceId") String workspaceId,
                       @Param("entityType") String entityType,
                       @Param("entityId") String entityId);

    int deleteAllByWorkspace(@Param("workspaceId") String workspaceId);
}
