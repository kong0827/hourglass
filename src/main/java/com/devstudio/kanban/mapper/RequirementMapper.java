package com.devstudio.kanban.mapper;

import com.devstudio.kanban.entity.Requirement;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface RequirementMapper {

    List<Requirement> selectAll(@Param("workspaceId") String workspaceId);

    Requirement selectById(String id);

    /** 按 id 批量取项目名称（只取 id/name） */
    List<Requirement> selectNamesByIds(@Param("workspaceId") String workspaceId,
                                       @Param("ids") List<String> ids);

    int insert(Requirement requirement);

    int update(Requirement requirement);

    /** 只更新管理元数据：负责人/起止/优先级 */
    int updateMeta(Requirement requirement);

    /** 只更新健康覆盖字段 */
    int updateHealth(Requirement requirement);

    /** 角色变更/成员移除前检查：该用户是否仍是项目负责人 */
    int countByManager(@Param("workspaceId") String workspaceId, @Param("userId") String userId);

    int deleteById(String id);

    int deleteAllByWorkspace(@Param("workspaceId") String workspaceId);

    int countByWorkspace(@Param("workspaceId") String workspaceId);
}
