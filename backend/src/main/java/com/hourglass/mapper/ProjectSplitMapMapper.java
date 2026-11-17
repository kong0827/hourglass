package com.hourglass.mapper;

import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

/**
 * 拆分映射只服务 sql/106 的一次性迁移与追溯；产品只在清空空间时清理，
 * 不提供任何读写接口，避免把迁移台账当成业务数据。
 */
@Mapper
public interface ProjectSplitMapMapper {

    @Delete("DELETE FROM project_split_map WHERE workspace_id = #{workspaceId}")
    int deleteAllByWorkspace(@Param("workspaceId") String workspaceId);
}
