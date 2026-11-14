package com.hourglass.mapper;

import com.hourglass.entity.Requirement;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface RequirementMapper {

    List<Requirement> selectAll(@Param("workspaceId") String workspaceId);

    List<Requirement> selectPage(@Param("workspaceId") String workspaceId,
                                 @Param("viewerId") String viewerId,
                                 @Param("offset") int offset, @Param("limit") int limit);

    int countVisible(@Param("workspaceId") String workspaceId, @Param("viewerId") String viewerId);

    Requirement selectById(String id);

    /** 按 id 批量取项目名称（只取 id/name） */
    List<Requirement> selectNamesByIds(@Param("workspaceId") String workspaceId,
                                       @Param("ids") List<String> ids);

    int insert(Requirement requirement);

    /** 空间内最大排序号；空空间返回 -1，新项目取 +1 排到末尾 */
    int selectMaxSortOrder(@Param("workspaceId") String workspaceId);

    int updateSortOrder(@Param("workspaceId") String workspaceId, @Param("id") String id,
                        @Param("sortOrder") int sortOrder);

    int update(Requirement requirement);

    /** 发布前测试检查策略：strict / standard / loose */
    int updateReleasePolicy(@Param("workspaceId") String workspaceId, @Param("id") String id,
                            @Param("policy") String policy);

    int setArchived(@Param("workspaceId") String workspaceId, @Param("id") String id,
                    @Param("archived") boolean archived);

    /** 标记首版上线日（阶段归组口径，见 sql/23） */
    int markFirstReleased(@Param("workspaceId") String workspaceId, @Param("id") String id,
                          @Param("date") java.time.LocalDate date);

    int deleteById(String id);

    int deleteAllByWorkspace(@Param("workspaceId") String workspaceId);

    int countByWorkspace(@Param("workspaceId") String workspaceId);
}
