package com.hourglass.mapper;

import com.hourglass.entity.ProjectMember;
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

    /**
     * 为 assigned 成员补齐缺失项目的 none 种子行（不覆盖已有 write/read/none）。
     * 幂等：只插入 project_member 中还没有记录的成员×项目组合。
     */
    int seedAssignedNone(@Param("workspaceId") String workspaceId);

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
