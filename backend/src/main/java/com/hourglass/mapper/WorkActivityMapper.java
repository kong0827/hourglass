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
                                      @Param("limit") int limit);

    /** 空间级文档动态流（联出文档标题/项目/草稿可见性字段），供「最近动态」视图使用 */
    List<ReqDocActivityView> selectDocActivities(@Param("workspaceId") String workspaceId,
                                                 @Param("entityType") String entityType,
                                                 @Param("limit") int limit);

    int deleteByEntity(@Param("workspaceId") String workspaceId,
                       @Param("entityType") String entityType,
                       @Param("entityId") String entityId);

    int deleteAllByWorkspace(@Param("workspaceId") String workspaceId);
}
