package com.hourglass.mapper;

import com.hourglass.dto.DemandWatcherView;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface DemandWatchMapper {

    int insertIgnore(@Param("workspaceId") String workspaceId, @Param("demandId") String demandId,
                     @Param("userId") String userId, @Param("addedBy") String addedBy);

    int delete(@Param("workspaceId") String workspaceId, @Param("demandId") String demandId,
               @Param("userId") String userId);

    int countMine(@Param("workspaceId") String workspaceId, @Param("demandId") String demandId,
                  @Param("userId") String userId);

    List<DemandWatcherView> selectViewers(@Param("workspaceId") String workspaceId,
                                          @Param("demandId") String demandId);

    List<String> selectUserIdsByDemand(@Param("workspaceId") String workspaceId,
                                       @Param("demandId") String demandId);

    int deleteByDemand(@Param("workspaceId") String workspaceId, @Param("demandId") String demandId);

    /** 项目删除时按项目清理：关注行随需求强归属项目，表上没有 req_id，需关联 demand 定位 */
    int deleteByWorkspaceReq(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);

    int deleteByWorkspace(@Param("workspaceId") String workspaceId);

    int deleteByWorkspaceUser(@Param("workspaceId") String workspaceId, @Param("userId") String userId);

    int deleteAllByUser(@Param("userId") String userId);
}
