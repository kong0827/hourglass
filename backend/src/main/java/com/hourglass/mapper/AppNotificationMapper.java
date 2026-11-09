package com.hourglass.mapper;

import com.hourglass.entity.AppNotification;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface AppNotificationMapper {

    List<AppNotification> selectByUser(@Param("userId") String userId,
                                       @Param("workspaceId") String workspaceId,
                                       @Param("filter") String filter,
                                       @Param("offset") int offset,
                                       @Param("limit") int limit);

    int countByUser(@Param("userId") String userId, @Param("workspaceId") String workspaceId,
                    @Param("filter") String filter);

    int countUnread(@Param("userId") String userId, @Param("workspaceId") String workspaceId);

    int countAll(@Param("userId") String userId, @Param("workspaceId") String workspaceId);

    /** 未读的 @ 提及数（read_at IS NULL），供通知筛选页签计数；「提及」视图本身仍含已读 */
    int countMentions(@Param("userId") String userId, @Param("workspaceId") String workspaceId);

    int insert(AppNotification n);

    /** 标记单条已读（限本人） */
    int markRead(@Param("id") Long id, @Param("userId") String userId);

    int markAllRead(@Param("userId") String userId, @Param("workspaceId") String workspaceId);

    /** 去重：同一收件人 + 同一任务 + 同一类型 在窗口内是否已存在（防止提醒风暴） */
    int countRecent(@Param("userId") String userId, @Param("refTaskId") String refTaskId,
                    @Param("type") String type, @Param("since") java.time.LocalDateTime since);

    /** 无关联任务的站内信（如每日汇总）按 workspace+user+type+时间窗去重 */
    int countRecentNoRef(@Param("workspaceId") String workspaceId, @Param("userId") String userId,
                         @Param("type") String type, @Param("since") java.time.LocalDateTime since);

    int deleteByTaskIds(@Param("workspaceId") String workspaceId, @Param("taskIds") List<String> taskIds);

    int deleteAllByWorkspace(@Param("workspaceId") String workspaceId);

    int deleteAllByUser(@Param("userId") String userId);

    /** 清理窗口外的历史通知，避免 app_notification 无限增长 */
    int deleteOlderThan(@Param("cutoff") java.time.LocalDateTime cutoff);
}
