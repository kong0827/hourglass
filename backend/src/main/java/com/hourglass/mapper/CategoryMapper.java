package com.hourglass.mapper;

import com.hourglass.entity.Category;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface CategoryMapper {

    /** 空间内全部项目模块（缓存全量口径；展示解析/跨项目筛选共用） */
    List<Category> selectByWorkspace(@Param("workspaceId") String workspaceId);

    Category selectById(@Param("workspaceId") String workspaceId, @Param("id") String id);

    Category selectByName(@Param("workspaceId") String workspaceId, @Param("projectId") String projectId,
                          @Param("name") String name);

    int insert(Category category);

    int update(Category category);

    int deleteById(@Param("workspaceId") String workspaceId, @Param("id") String id);

    Integer maxSortOrder(@Param("workspaceId") String workspaceId, @Param("projectId") String projectId);

    int updateSortOrder(@Param("workspaceId") String workspaceId, @Param("id") String id,
                        @Param("sortOrder") int sortOrder);

    /** 删除项目模块时：该项目下任务迁到目标模块（按 ID 关联，无需扫名称） */
    int moveTasksToCategory(@Param("workspaceId") String workspaceId, @Param("projectId") String projectId,
                            @Param("fromId") String fromId, @Param("toId") String toId);

    /** 删除模块前取受影响任务 ID（含回收站），用于批量补时间线；与 moveTasksToCategory 同口径 */
    List<String> selectTaskIdsForCascade(@Param("workspaceId") String workspaceId,
                                         @Param("projectId") String projectId,
                                         @Param("categoryId") String categoryId);

    /** 删除项目模块时：该项目下需求迁到目标模块 */
    int moveDemandsToCategory(@Param("workspaceId") String workspaceId, @Param("projectId") String projectId,
                              @Param("fromId") String fromId, @Param("toId") String toId);

    /** 项目删除时：其下任务即将解除项目关联，模块引用先一并清空（未挂项目恒为「未指定」） */
    int clearTasksCategory(@Param("workspaceId") String workspaceId, @Param("projectId") String projectId);

    /** 项目删除时：模块清单随项目一并清理 */
    int deleteByProject(@Param("workspaceId") String workspaceId, @Param("projectId") String projectId);

    int deleteAllByWorkspace(@Param("workspaceId") String workspaceId);
}
