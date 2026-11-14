package com.hourglass.mapper;

import com.hourglass.entity.Task;
import com.hourglass.dto.TaskVersionBinding;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import java.util.List;
import java.util.ArrayList;
import java.util.Map;
import java.util.HashMap;

@Mapper
public interface VersionTaskMapper {
    List<Task> selectOptionsByReq(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);
    List<com.hourglass.entity.VersionRelease> selectReleaseRecordsByReq(@Param("workspaceId") String workspaceId,
                                                                        @Param("reqId") String reqId);
    List<Task> selectStatsByReq(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);

    /** 承诺基线快照来源：版本当前绑定的工作项与预估 */
    List<Task> selectCommitmentTasks(@Param("workspaceId") String workspaceId, @Param("versionId") String versionId);
    List<String> selectVersionIdsByTask(@Param("workspaceId") String workspaceId, @Param("taskId") String taskId);
    List<TaskVersionBinding> selectVersionRowsByTaskIds(@Param("workspaceId") String workspaceId,
                                                       @Param("taskIds") List<String> taskIds);
    List<TaskVersionBinding> selectBindingsByWorkspace(@Param("workspaceId") String workspaceId);
    int deleteByTaskId(@Param("workspaceId") String workspaceId, @Param("taskId") String taskId);
    int deleteBinding(@Param("workspaceId") String workspaceId, @Param("taskId") String taskId,
                      @Param("versionId") String versionId);
    int insertBatch(@Param("workspaceId") String workspaceId, @Param("versionId") String versionId,
                    @Param("taskIds") List<String> taskIds);
    int deleteByVersion(@Param("workspaceId") String workspaceId, @Param("versionId") String versionId);
    int deleteByTaskIds(@Param("workspaceId") String workspaceId, @Param("taskIds") List<String> taskIds);
    int deleteByReq(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);
    int deleteByWorkspace(@Param("workspaceId") String workspaceId);

    /** One relation query per batch, preserving task cardinality and deterministic aligned arrays. */
    default void enrichTasks(String workspaceId, List<Task> tasks) {
        if (tasks == null || tasks.isEmpty()) return;
        Map<String, List<Task>> byId = new HashMap<String, List<Task>>();
        for (Task task : tasks) {
            task.setVersionIds(new ArrayList<String>());
            task.setVersionNames(new ArrayList<String>());
            byId.computeIfAbsent(task.getId(), key -> new ArrayList<Task>()).add(task);
        }
        List<String> ids = new ArrayList<String>(byId.keySet());
        java.util.Collections.sort(ids);
        for (int from = 0; from < ids.size(); from += 500) {
            for (TaskVersionBinding row : selectVersionRowsByTaskIds(workspaceId,
                    ids.subList(from, Math.min(from + 500, ids.size())))) {
                for (Task task : byId.get(row.getTaskId())) {
                    if (!task.getVersionIds().contains(row.getVersionId())) {
                        task.getVersionIds().add(row.getVersionId());
                        task.getVersionNames().add(row.getVersionName());
                    }
                }
            }
        }
    }
}
