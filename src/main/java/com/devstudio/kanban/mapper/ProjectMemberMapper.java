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

    /** 覆盖导入后清理指向已不存在项目的项目级授权，避免项目 ID 复用时继承旧权限 */
    int deleteMissingProjects(@Param("workspaceId") String workspaceId);
}
