package com.devstudio.kanban.mapper;

import com.devstudio.kanban.entity.TaskComment;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface TaskCommentMapper {

    /** 倒序取最近一页评论；beforeId 用于加载更早一页（按自增 id 倒序，游标分页） */
    List<TaskComment> selectByTaskId(@Param("workspaceId") String workspaceId, @Param("taskId") String taskId,
                                     @Param("beforeId") Long beforeId, @Param("limit") int limit);

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
