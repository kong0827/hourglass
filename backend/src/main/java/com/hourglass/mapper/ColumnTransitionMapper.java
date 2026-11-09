package com.hourglass.mapper;

import com.hourglass.entity.ColumnTransition;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface ColumnTransitionMapper {

    List<ColumnTransition> selectByWorkspace(@Param("workspaceId") String workspaceId);

    int upsert(ColumnTransition transition);

    int deleteByColumn(@Param("workspaceId") String workspaceId, @Param("columnId") String columnId);

    int deleteAllByWorkspace(@Param("workspaceId") String workspaceId);
}
