package com.devstudio.kanban.mapper;

import com.devstudio.kanban.entity.Requirement;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface RequirementMapper {

    List<Requirement> selectAll(@Param("workspaceId") String workspaceId);

    Requirement selectById(String id);

    int insert(Requirement requirement);

    int update(Requirement requirement);

    int deleteById(String id);

    int deleteAllByWorkspace(@Param("workspaceId") String workspaceId);

    int countByWorkspace(@Param("workspaceId") String workspaceId);
}
