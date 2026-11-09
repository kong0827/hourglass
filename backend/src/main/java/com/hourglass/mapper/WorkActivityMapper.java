package com.hourglass.mapper;

import com.hourglass.dto.ReqDocActivityView;
import com.hourglass.entity.WorkActivity;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface WorkActivityMapper {

    int insert(WorkActivity activity);

    List<WorkActivity> selectByEntity(@Param("workspaceId") String workspaceId,
                                      @Param("entityType") String entityType,
                                      @Param("entityId") String entityId,
                                      @Param("offset") int offset,
                                      @Param("limit") int limit);

    int countByEntity(@Param("workspaceId") String workspaceId,
                      @Param("entityType") String entityType,
                      @Param("entityId") String entityId);

    /** 空间级文档动态流：项目可见性与草稿条件同主文档列表 */
    List<ReqDocActivityView> selectDocActivities(@Param("workspaceId") String workspaceId,
                                                 @Param("entityType") String entityType,
                                                 @Param("viewerId") String viewerId,
                                                 @Param("userId") String userId,
                                                 @Param("seeAllDrafts") boolean seeAllDrafts,
                                                 @Param("offset") int offset,
                                                 @Param("limit") int limit);

    int countDocActivities(@Param("workspaceId") String workspaceId,
                           @Param("entityType") String entityType,
                           @Param("viewerId") String viewerId,
                           @Param("userId") String userId,
                           @Param("seeAllDrafts") boolean seeAllDrafts);

    int deleteByEntity(@Param("workspaceId") String workspaceId,
                       @Param("entityType") String entityType,
                       @Param("entityId") String entityId);

    int deleteAllByWorkspace(@Param("workspaceId") String workspaceId);
}
