package com.devstudio.kanban.mapper;

import com.devstudio.kanban.entity.Category;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface CategoryMapper {

    List<Category> selectByWorkspace(@Param("workspaceId") String workspaceId);

    Category selectById(@Param("workspaceId") String workspaceId, @Param("id") String id);

    Category selectByName(@Param("workspaceId") String workspaceId, @Param("name") String name);

    int insert(Category category);

    int update(Category category);

    int deleteById(@Param("workspaceId") String workspaceId, @Param("id") String id);

    Integer maxSortOrder(@Param("workspaceId") String workspaceId);

    int updateSortOrder(@Param("workspaceId") String workspaceId, @Param("id") String id,
                        @Param("sortOrder") int sortOrder);

    /** 改名/删除时同步任务里的分类名 */
    int renameInTasks(@Param("workspaceId") String workspaceId, @Param("oldName") String oldName,
                      @Param("newName") String newName);

    int countByWorkspace(@Param("workspaceId") String workspaceId);

    int deleteAllByWorkspace(@Param("workspaceId") String workspaceId);
}
