package com.devstudio.kanban.mapper;

import com.devstudio.kanban.entity.WorkspaceMember;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface WorkspaceMemberMapper {

    List<WorkspaceMember> selectByWorkspace(@Param("workspaceId") String workspaceId);

    /** 备份导入：一次取回成员 user_id 集合，替代逐个 selectMember */
    List<String> selectUserIds(@Param("workspaceId") String workspaceId);

    WorkspaceMember selectMember(@Param("workspaceId") String workspaceId, @Param("userId") String userId);

    int insert(WorkspaceMember member);

    int delete(@Param("workspaceId") String workspaceId, @Param("userId") String userId);

    int deleteAllByWorkspace(@Param("workspaceId") String workspaceId);

    int deleteAllByUser(@Param("userId") String userId);
}
