package com.hourglass.mapper;

import com.hourglass.entity.DemandComment;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.time.LocalDateTime;
import java.util.List;

@Mapper
public interface DemandCommentMapper {

    int insert(DemandComment comment);

    DemandComment selectById(@Param("id") String id);

    List<DemandComment> selectTopByDemand(@Param("workspaceId") String workspaceId,
                                          @Param("demandId") String demandId,
                                          @Param("unresolvedOnly") boolean unresolvedOnly,
                                          @Param("offset") int offset, @Param("limit") int limit);

    List<DemandComment> selectRepliesByParents(@Param("workspaceId") String workspaceId,
                                               @Param("demandId") String demandId,
                                               @Param("parentIds") List<String> parentIds);

    int countByDemand(@Param("workspaceId") String workspaceId, @Param("demandId") String demandId);

    int countTopByDemand(@Param("workspaceId") String workspaceId, @Param("demandId") String demandId,
                         @Param("unresolvedOnly") boolean unresolvedOnly);

    int countUnresolvedByDemand(@Param("workspaceId") String workspaceId, @Param("demandId") String demandId);

    List<DemandComment> selectByWorkspace(@Param("workspaceId") String workspaceId);

    int updateResolve(@Param("workspaceId") String workspaceId, @Param("id") String id,
                      @Param("resolvedAt") LocalDateTime resolvedAt, @Param("resolvedBy") String resolvedBy);

    int updateTaskId(@Param("workspaceId") String workspaceId, @Param("id") String id,
                     @Param("taskId") String taskId);

    int clearTaskRefsByTaskIds(@Param("workspaceId") String workspaceId,
                               @Param("taskIds") List<String> taskIds);

    int delete(@Param("workspaceId") String workspaceId, @Param("id") String id);

    int deleteByParent(@Param("workspaceId") String workspaceId, @Param("demandId") String demandId,
                       @Param("parentId") String parentId);

    int deleteByDemand(@Param("workspaceId") String workspaceId, @Param("demandId") String demandId);

    /** 项目删除时按项目清理：评论强归属需求与项目 */
    int deleteByWorkspaceReq(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);

    int deleteByWorkspace(@Param("workspaceId") String workspaceId);
}
