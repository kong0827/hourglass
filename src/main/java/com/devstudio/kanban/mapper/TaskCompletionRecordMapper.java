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

    /** 该 ID 是否还有历史完成快照（彻底删除后快照会保留，ID 不可复用） */
    int countByTaskId(@Param("workspaceId") String workspaceId, @Param("taskId") String taskId);

    /** 清空空间时连完成归档一起清（否则清空任务后「任务清单」仍显示旧记录） */
    int deleteAllByWorkspace(@Param("workspaceId") String workspaceId);

    /** 按月查（completed_at 在 [from, to) 区间内），按完成日倒序 */
    List<TaskCompletionRecord> selectByRange(@Param("workspaceId") String workspaceId,
                                            @Param("from") LocalDate from,
                                            @Param("to") LocalDate to);
}
