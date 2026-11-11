package com.hourglass.mapper;

import com.hourglass.entity.ProjectMemberRole;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface ProjectMemberRoleMapper {

    List<ProjectMemberRole> selectByProject(@Param("workspaceId") String workspaceId,
                                            @Param("projectId") String projectId);

    ProjectMemberRole selectOne(@Param("workspaceId") String workspaceId,
                                @Param("projectId") String projectId,
                                @Param("userId") String userId);

    int upsert(ProjectMemberRole role);

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
