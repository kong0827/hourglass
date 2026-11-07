package com.hourglass.mapper;

import com.hourglass.entity.RequirementDocComment;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface RequirementDocCommentMapper {

    int insert(RequirementDocComment comment);

    RequirementDocComment selectById(@Param("id") String id);

    List<RequirementDocComment> selectByDoc(@Param("workspaceId") String workspaceId, @Param("docId") String docId);

    List<RequirementDocComment> selectByWorkspace(@Param("workspaceId") String workspaceId);

    int delete(@Param("workspaceId") String workspaceId, @Param("id") String id);

    int deleteByDoc(@Param("workspaceId") String workspaceId, @Param("docId") String docId);

    int deleteByReq(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);

    int deleteByWorkspace(@Param("workspaceId") String workspaceId);
}
