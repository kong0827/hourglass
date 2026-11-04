package com.devstudio.kanban.mapper;

import com.devstudio.kanban.entity.Task;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface VersionTaskMapper {

    List<Task> selectOptionsByReq(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);

    /** M1 版本阶段统计：项目全部任务（含绑定版本、累计工时、完成/截止日期、工作项类型） */
    List<Task> selectStatsByReq(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);

    /** 任务当前绑定的版本ID（未绑定返回 null） */
    String selectVersionIdByTask(@Param("workspaceId") String workspaceId, @Param("taskId") String taskId);

    /** 批量取任务绑定版本ID与名称（列表视图「影响版本」列） */
    List<Task> selectVersionRowsByTaskIds(@Param("workspaceId") String workspaceId,
                                          @Param("taskIds") List<String> taskIds);

    /** 备份导出：整空间任务→版本绑定（id 回填 taskId，versionId 回填版本） */
    List<Task> selectBindingsByWorkspace(@Param("workspaceId") String workspaceId);

    int deleteByTaskId(@Param("workspaceId") String workspaceId, @Param("taskId") String taskId);

    int insertBatch(@Param("workspaceId") String workspaceId, @Param("versionId") String versionId,
                    @Param("taskIds") List<String> taskIds);

    int deleteByVersion(@Param("workspaceId") String workspaceId, @Param("versionId") String versionId);

    int deleteByTaskIds(@Param("workspaceId") String workspaceId, @Param("taskIds") List<String> taskIds);

    int deleteByReq(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);

    int deleteByWorkspace(@Param("workspaceId") String workspaceId);
}
