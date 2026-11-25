package com.hourglass.mapper;

import com.hourglass.entity.ReportSubscription;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.time.LocalDateTime;
import java.util.List;

@Mapper
public interface ReportSubscriptionMapper {

    List<ReportSubscription> selectByUser(@Param("workspaceId") String workspaceId,
                                          @Param("userId") String userId);

    ReportSubscription selectOne(@Param("workspaceId") String workspaceId,
                                 @Param("userId") String userId,
                                 @Param("reportType") String reportType);

    /** 周报调度：一次取回全部启用订阅，由服务层按星期/小时过滤。 */
    List<ReportSubscription> selectEnabledByType(@Param("reportType") String reportType);

    List<ReportSubscription> selectEnabledForWorkspace(@Param("workspaceId") String workspaceId,
                                                       @Param("reportType") String reportType);

    int upsert(ReportSubscription subscription);

    int touchLastSent(@Param("id") String id, @Param("sentAt") LocalDateTime sentAt);

    int deleteByWorkspace(@Param("workspaceId") String workspaceId);

    int deleteByWorkspaceUser(@Param("workspaceId") String workspaceId, @Param("userId") String userId);
}
