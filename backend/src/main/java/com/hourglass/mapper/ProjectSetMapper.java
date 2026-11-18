package com.hourglass.mapper;

import com.hourglass.entity.ProjectSet;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface ProjectSetMapper {

    List<ProjectSet> selectAll(@Param("workspaceId") String workspaceId);

    ProjectSet selectById(@Param("workspaceId") String workspaceId, @Param("id") String id);

    int countByName(@Param("workspaceId") String workspaceId, @Param("name") String name,
                    @Param("excludeId") String excludeId);

    int selectMaxSortOrder(@Param("workspaceId") String workspaceId);

    int insert(ProjectSet set);

    int update(ProjectSet set);

    /** 手动排序：只改 sort_order，不动 updated_at */
    int updateSortOrder(@Param("workspaceId") String workspaceId, @Param("id") String id,
                        @Param("sortOrder") int sortOrder);

    /** 解绑：项目集删除后项目回到「未分组」，不删除任何项目或数据 */
    int unbindProjects(@Param("workspaceId") String workspaceId, @Param("setId") String setId);

    int deleteById(@Param("workspaceId") String workspaceId, @Param("id") String id);

    int deleteAllByWorkspace(@Param("workspaceId") String workspaceId);
}
