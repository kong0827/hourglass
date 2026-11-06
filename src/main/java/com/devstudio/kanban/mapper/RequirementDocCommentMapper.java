package com.devstudio.kanban.mapper;

import com.devstudio.kanban.entity.RequirementDocComment;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface RequirementDocCommentMapper {

    int insert(RequirementDocComment comment);

    RequirementDocComment selectById(@Param("id") String id);

    List<RequirementDocComment> selectByDoc(@Param("workspaceId") String workspaceId, @Param("docId") String docId);

    int delete(@Param("workspaceId") String workspaceId, @Param("id") String id);
}
