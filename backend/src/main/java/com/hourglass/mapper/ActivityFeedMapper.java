package com.hourglass.mapper;

import com.hourglass.dto.ActivityFeedItem;
import com.hourglass.dto.ActivityTypeCount;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

/** 空间活动聚合：task_log / work_activity / demand_log / dev_branch_log / version_log 统一取流。 */
@Mapper
public interface ActivityFeedMapper {

    List<ActivityFeedItem> selectFeed(@Param("workspaceId") String workspaceId,
                                      @Param("viewerId") String viewerId,
                                      @Param("userId") String userId,
                                      @Param("seeAllDrafts") boolean seeAllDrafts,
                                      @Param("includeConfig") boolean includeConfig,
                                      @Param("type") String type,
                                      @Param("actionFilter") String actionFilter,
                                      @Param("actorFilter") String actorFilter,
                                      @Param("fromDate") String fromDate,
                                      @Param("toDate") String toDate,
                                      @Param("keyword") String keyword,
                                      @Param("offset") int offset,
                                      @Param("limit") int limit);

    List<ActivityTypeCount> countByType(@Param("workspaceId") String workspaceId,
                                        @Param("viewerId") String viewerId,
                                        @Param("userId") String userId,
                                        @Param("seeAllDrafts") boolean seeAllDrafts,
                                        @Param("includeConfig") boolean includeConfig,
                                        @Param("actionFilter") String actionFilter,
                                        @Param("actorFilter") String actorFilter,
                                        @Param("fromDate") String fromDate,
                                        @Param("toDate") String toDate,
                                        @Param("keyword") String keyword);
}
