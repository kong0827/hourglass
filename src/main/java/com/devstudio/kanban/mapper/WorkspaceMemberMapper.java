package com.devstudio.kanban.mapper;

import com.devstudio.kanban.entity.WorkspaceMember;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface WorkspaceMemberMapper {

    List<WorkspaceMember> selectByWorkspace(@Param("workspaceId") String workspaceId);

    WorkspaceMember selectMember(@Param("workspaceId") String workspaceId, @Param("userId") String userId);

    int insert(WorkspaceMember member);

    int delete(@Param("workspaceId") String workspaceId, @Param("userId") String userId);

    int deleteAllByWorkspace(@Param("workspaceId") String workspaceId);

    int deleteAllByUser(@Param("userId") String userId);
}
