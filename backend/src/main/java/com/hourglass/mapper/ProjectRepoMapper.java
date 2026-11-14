package com.hourglass.mapper;

import com.hourglass.entity.ProjectRepo;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.time.LocalDateTime;
import java.util.List;

@Mapper
public interface ProjectRepoMapper {

    /** 空间下全部仓库绑定（空间主管理用） */
    List<ProjectRepo> selectByWorkspace(@Param("workspaceId") String workspaceId);

    /** 按项目可见性过滤后的仓库列表（viewerId 非空时排除不可见项目） */
    List<ProjectRepo> selectVisible(@Param("workspaceId") String workspaceId,
                                    @Param("viewerId") String viewerId);

    ProjectRepo selectById(@Param("id") String id);

    ProjectRepo selectByWorkspaceAndUrl(@Param("workspaceId") String workspaceId,
                                        @Param("repoUrl") String repoUrl,
                                        @Param("projectRef") String projectRef);

    List<ProjectRepo> selectByReq(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);

    /** 定时任务：启用且超过轮询间隔（last_sync_at 为空或早于 before）的仓库 */
    List<ProjectRepo> selectDue(@Param("before") LocalDateTime before, @Param("limit") int limit);

    int insert(ProjectRepo repo);

    int update(ProjectRepo repo);

    int updateEnabled(@Param("workspaceId") String workspaceId, @Param("id") String id,
                      @Param("enabled") boolean enabled);

    int updateSyncResult(@Param("workspaceId") String workspaceId, @Param("id") String id,
                         @Param("status") String status, @Param("error") String error,
                         @Param("summary") String summary, @Param("at") LocalDateTime at);

    int clearToken(@Param("workspaceId") String workspaceId, @Param("id") String id);

    int deleteById(@Param("workspaceId") String workspaceId, @Param("id") String id);

    int deleteByReq(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);

    int deleteByWorkspace(@Param("workspaceId") String workspaceId);
}
