package com.devstudio.kanban.mapper;

import com.devstudio.kanban.entity.ProjectMember;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface ProjectMemberMapper {

    List<ProjectMember> selectByWorkspace(@Param("workspaceId") String workspaceId);

    List<ProjectMember> selectByUser(@Param("workspaceId") String workspaceId,
                                     @Param("userId") String userId);

    ProjectMember selectOne(@Param("workspaceId") String workspaceId,
                            @Param("projectId") String projectId,
                            @Param("userId") String userId);

    int upsert(ProjectMember member);

    int deleteOne(@Param("workspaceId") String workspaceId,
                  @Param("projectId") String projectId,
                  @Param("userId") String userId);

    int deleteByProject(@Param("workspaceId") String workspaceId,
                        @Param("projectId") String projectId);

    int deleteByUser(@Param("workspaceId") String workspaceId,
                     @Param("userId") String userId);

    int deleteAllByWorkspace(@Param("workspaceId") String workspaceId);

    int deleteAllByUser(@Param("userId") String userId);
}
