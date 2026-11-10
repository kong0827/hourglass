package com.hourglass.mapper;

import com.hourglass.entity.ProjectVersion;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface ProjectVersionMapper {

    List<ProjectVersion> selectByReq(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);

    /** 备份导出：整空间版本（含已发布） */
    List<ProjectVersion> selectByWorkspace(@Param("workspaceId") String workspaceId);

    ProjectVersion selectById(String id);

    /** Current reads used only after acquiring the project delivery mutex. */
    ProjectVersion selectByIdForUpdate(@Param("workspaceId") String workspaceId, @Param("id") String id);

    List<ProjectVersion> selectByReqForUpdate(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);

    List<ProjectVersion> selectByNameForUpdate(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                                             @Param("name") String name, @Param("excludeId") String excludeId);

    int countByName(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                    @Param("name") String name, @Param("excludeId") String excludeId);

    /** 项目列表用：一次 GROUP BY 取全部项目的版本数 */
    List<java.util.Map<String, Object>> countGroupByReq(@Param("workspaceId") String workspaceId);

    int insert(ProjectVersion version);

    int update(ProjectVersion version);

    /** 成员关系在任务侧变化时推进 revision（版本侧表单据此识别过期快照） */
    int touchRevision(@Param("workspaceId") String workspaceId, @Param("id") String id);

    int deleteById(@Param("workspaceId") String workspaceId, @Param("id") String id);

    int deleteByReq(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);

    int deleteByWorkspace(@Param("workspaceId") String workspaceId);

    /** 版本删除时解除测试计划对它的关联（计划保留，回到「不关联版本」） */
    int clearTestPlanVersion(@Param("workspaceId") String workspaceId, @Param("versionId") String versionId);
}
