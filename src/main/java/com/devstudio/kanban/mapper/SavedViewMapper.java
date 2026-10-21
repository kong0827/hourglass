package com.devstudio.kanban.mapper;

import com.devstudio.kanban.entity.SavedView;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface SavedViewMapper {

    List<SavedView> selectAll(@Param("userId") String userId, @Param("workspaceId") String workspaceId);

    SavedView selectById(String id);

    int insert(SavedView view);

    int deleteById(String id);

    int deleteAllByWorkspace(@Param("workspaceId") String workspaceId);
}
