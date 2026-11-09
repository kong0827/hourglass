package com.hourglass.mapper;

import com.hourglass.entity.TaskComment;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface TaskCommentMapper {

    List<TaskComment> selectByTaskId(@Param("workspaceId") String workspaceId, @Param("taskId") String taskId,
                                     @Param("offset") int offset, @Param("limit") int limit);

    int countByTaskId(@Param("workspaceId") String workspaceId, @Param("taskId") String taskId);

    /** 备份导出：空间内全部评论（含回收站任务上的评论） */
    List<TaskComment> selectAllByWorkspace(@Param("workspaceId") String workspaceId);

    TaskComment selectById(@Param("id") Long id);

    int insert(TaskComment comment);

    /** 备份导入：按批多值写入 */
    int insertBatch(@Param("list") List<TaskComment> list);

    int deleteById(@Param("id") Long id);

    int deleteByTaskIds(@Param("workspaceId") String workspaceId, @Param("taskIds") List<String> taskIds);

    int deleteAllByWorkspace(@Param("workspaceId") String workspaceId);
}
