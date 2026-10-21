package com.devstudio.kanban.mapper;

import com.devstudio.kanban.entity.Tag;
import com.devstudio.kanban.entity.TagCount;
import com.devstudio.kanban.entity.TagTaskRow;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface TagMapper {

    List<TagCount> selectAllWithCount(@Param("workspaceId") String workspaceId);

    Tag selectByName(@Param("workspaceId") String workspaceId, @Param("name") String name);

    int insert(Tag tag);

    List<TagTaskRow> selectByTaskIds(@Param("workspaceId") String workspaceId, @Param("taskIds") List<String> taskIds);

    int insertTaskTag(@Param("taskId") String taskId, @Param("tagId") String tagId,
                      @Param("workspaceId") String workspaceId);

    int deleteTaskTags(@Param("workspaceId") String workspaceId, @Param("taskId") String taskId);

    int deleteAllTaskTagsByWorkspace(@Param("workspaceId") String workspaceId);

    int deleteTagsByWorkspace(@Param("workspaceId") String workspaceId);
}
