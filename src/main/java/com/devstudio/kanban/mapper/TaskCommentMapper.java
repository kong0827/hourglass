package com.devstudio.kanban.mapper;

import com.devstudio.kanban.entity.TaskComment;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface TaskCommentMapper {

    List<TaskComment> selectByTaskId(@Param("workspaceId") String workspaceId, @Param("taskId") String taskId);

    /** 备份导出：空间内全部评论（含回收站任务上的评论） */
    List<TaskComment> selectAllByWorkspace(@Param("workspaceId") String workspaceId);

    TaskComment selectById(@Param("id") Long id);

    int insert(TaskComment comment);

    int deleteById(@Param("id") Long id);

    int deleteByTaskId(@Param("workspaceId") String workspaceId, @Param("taskId") String taskId);

    int deleteAllByWorkspace(@Param("workspaceId") String workspaceId);
}
