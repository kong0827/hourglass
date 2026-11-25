package com.hourglass.mapper;

import com.hourglass.entity.SavedView;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface SavedViewMapper {

    List<SavedView> selectAll(@Param("userId") String userId, @Param("workspaceId") String workspaceId);

    SavedView selectById(String id);

    /** 同名覆盖只在同一 scope 内生效：任务视图与搜索视图可以同名并存 */
    SavedView selectByName(@Param("userId") String userId,
                           @Param("workspaceId") String workspaceId,
                           @Param("name") String name,
                           @Param("scope") String scope);

    int insert(SavedView view);

    int updateParams(@Param("id") String id,
                     @Param("userId") String userId,
                     @Param("workspaceId") String workspaceId,
                     @Param("params") String params);

    int deleteById(String id);

    int deleteAllByWorkspace(@Param("workspaceId") String workspaceId);

    int deleteAllByUser(@Param("userId") String userId);
}
