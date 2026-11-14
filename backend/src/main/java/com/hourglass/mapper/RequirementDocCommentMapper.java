package com.hourglass.mapper;

import com.hourglass.entity.RequirementDocComment;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.time.LocalDateTime;
import java.util.List;

@Mapper
public interface RequirementDocCommentMapper {

    int insert(RequirementDocComment comment);

    RequirementDocComment selectById(@Param("id") String id);

    List<RequirementDocComment> selectByDoc(@Param("workspaceId") String workspaceId, @Param("docId") String docId,
                                            @Param("offset") int offset, @Param("limit") int limit);

    List<RequirementDocComment> selectTopByDoc(@Param("workspaceId") String workspaceId, @Param("docId") String docId,
                                               @Param("unresolvedOnly") boolean unresolvedOnly,
                                               @Param("offset") int offset, @Param("limit") int limit);

    List<RequirementDocComment> selectRepliesByParents(@Param("workspaceId") String workspaceId,
                                                       @Param("docId") String docId,
                                                       @Param("parentIds") List<String> parentIds);

    int countByDoc(@Param("workspaceId") String workspaceId, @Param("docId") String docId);

    int countTopByDoc(@Param("workspaceId") String workspaceId, @Param("docId") String docId,
                      @Param("unresolvedOnly") boolean unresolvedOnly);

    int countUnresolvedByDoc(@Param("workspaceId") String workspaceId, @Param("docId") String docId);

    List<RequirementDocComment> selectByWorkspace(@Param("workspaceId") String workspaceId);

    int updateResolve(@Param("workspaceId") String workspaceId, @Param("id") String id,
                      @Param("resolvedAt") LocalDateTime resolvedAt, @Param("resolvedBy") String resolvedBy);

    int updateTaskId(@Param("workspaceId") String workspaceId, @Param("id") String id,
                     @Param("taskId") String taskId);

    int clearTaskRefsByTaskIds(@Param("workspaceId") String workspaceId,
                               @Param("taskIds") List<String> taskIds);

    int delete(@Param("workspaceId") String workspaceId, @Param("id") String id);

    int deleteByParent(@Param("workspaceId") String workspaceId, @Param("docId") String docId,
                       @Param("parentId") String parentId);

    int deleteByDoc(@Param("workspaceId") String workspaceId, @Param("docId") String docId);

    int deleteByReq(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);

    int deleteByWorkspace(@Param("workspaceId") String workspaceId);
}
