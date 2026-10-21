package com.devstudio.kanban.mapper;

import com.devstudio.kanban.entity.TaskCompletionRecord;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.time.LocalDate;
import java.util.List;

@Mapper
public interface TaskCompletionRecordMapper {

    /**
     * 写入 / 覆盖一条完成快照。
     * 同一任务反复"完成 → 取消完成 → 再完成"时只保留最后一次，靠 (workspace_id, task_id) 唯一键。
     */
    int upsert(TaskCompletionRecord record);

    int deleteByTaskId(@Param("workspaceId") String workspaceId, @Param("taskId") String taskId);

    /** 按月查（completed_at 在 [from, to) 区间内），按完成日倒序 */
    List<TaskCompletionRecord> selectByRange(@Param("workspaceId") String workspaceId,
                                            @Param("from") LocalDate from,
                                            @Param("to") LocalDate to);
}
