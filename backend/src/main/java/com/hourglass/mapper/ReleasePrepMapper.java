package com.hourglass.mapper;

import com.hourglass.dto.ReleasePlanWatchRow;
import com.hourglass.dto.ReleasePrepTaskRow;
import com.hourglass.entity.ReleasePlanPush;
import com.hourglass.entity.ReleasePlanTaskCheck;
import com.hourglass.entity.VersionReleasePlan;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/** 发布准备、发布计划关注与里程碑：推送批次、收件人、逐项确认、关注列表。 */
@Mapper
public interface ReleasePrepMapper {

    VersionReleasePlan selectPlan(@Param("workspaceId") String workspaceId, @Param("planId") String planId);

    /** 串行化同一计划的推送去重检查，避免并发点击各写一批。 */
    String lockPlan(@Param("workspaceId") String workspaceId, @Param("planId") String planId);

    List<ReleasePrepTaskRow> selectPlanTaskRows(@Param("workspaceId") String workspaceId,
                                                @Param("planId") String planId);

    List<ReleasePlanTaskCheck> selectChecks(@Param("workspaceId") String workspaceId,
                                            @Param("planId") String planId);

    int upsertCheck(ReleasePlanTaskCheck check);

    int deleteCheck(@Param("workspaceId") String workspaceId, @Param("planId") String planId,
                    @Param("taskId") String taskId, @Param("userId") String userId);

    int insertPush(ReleasePlanPush push);

    int updatePushGroupResult(@Param("pushId") String pushId, @Param("groupSent") Boolean groupSent,
                              @Param("groupError") String groupError);

    int insertPushRecipient(@Param("pushId") String pushId, @Param("workspaceId") String workspaceId,
                            @Param("userId") String userId);

    int markRecipientInApp(@Param("pushId") String pushId, @Param("userId") String userId);

    int markRecipientEmail(@Param("pushId") String pushId, @Param("userId") String userId);

    int markRecipientWecom(@Param("pushId") String pushId, @Param("userId") String userId);

    int ackPushRecipient(@Param("workspaceId") String workspaceId, @Param("planId") String planId,
                         @Param("userId") String userId);

    Map<String, Object> selectMyReceipt(@Param("workspaceId") String workspaceId,
                                        @Param("planId") String planId,
                                        @Param("userId") String userId);

    ReleasePlanPush selectLatestPush(@Param("workspaceId") String workspaceId,
                                     @Param("planId") String planId);

    List<ReleasePlanPush> selectPushes(@Param("workspaceId") String workspaceId,
                                       @Param("planId") String planId,
                                       @Param("limit") int limit);

    ReleasePlanPush selectPushById(@Param("workspaceId") String workspaceId,
                                   @Param("planId") String planId,
                                   @Param("pushId") String pushId);

    /** 推送记录的收件人明细：是否站内 / 邮件送达、是否回执。 */
    List<Map<String, Object>> selectPushRecipientRows(@Param("pushId") String pushId);

    List<String> selectPushRecipients(@Param("pushId") String pushId);

    int countWatchers(@Param("workspaceId") String workspaceId, @Param("planId") String planId);

    int countMyWatch(@Param("workspaceId") String workspaceId, @Param("planId") String planId,
                     @Param("userId") String userId);

    int insertWatchIgnore(@Param("workspaceId") String workspaceId, @Param("planId") String planId,
                          @Param("userId") String userId);

    int deleteWatch(@Param("workspaceId") String workspaceId, @Param("planId") String planId,
                    @Param("userId") String userId);

    List<String> selectWatcherIds(@Param("workspaceId") String workspaceId, @Param("planId") String planId);

    int countMyWatchedPlans(@Param("workspaceId") String workspaceId, @Param("userId") String userId,
                            @Param("viewerId") String viewerId);

    List<ReleasePlanWatchRow> selectMyWatchedPlans(@Param("workspaceId") String workspaceId,
                                                   @Param("userId") String userId,
                                                   @Param("viewerId") String viewerId,
                                                   @Param("offset") int offset,
                                                   @Param("limit") int limit);

    /** 里程碑扫描：状态 ready、计划日期落在指定自然日区间。 */
    List<Map<String, Object>> selectPlansForMilestone(@Param("dateFrom") LocalDateTime dateFrom,
                                                       @Param("dateTo") LocalDateTime dateTo);

    int insertMilestoneIgnore(@Param("workspaceId") String workspaceId, @Param("planId") String planId,
                              @Param("userId") String userId, @Param("milestone") String milestone);

    /** 发送失败时撤回占位，避免把未送达的里程碑永久记为已发送。 */
    int deleteMilestone(@Param("workspaceId") String workspaceId, @Param("planId") String planId,
                        @Param("userId") String userId, @Param("milestone") String milestone);

    /** 计划改期后清空发送记录，让新日期上的里程碑重新计算。 */
    int deleteMilestones(@Param("workspaceId") String workspaceId, @Param("planId") String planId);

    int countTaskOwnerUnconfirmed(@Param("workspaceId") String workspaceId, @Param("planId") String planId,
                                  @Param("userId") String userId, @Param("scopeToken") String scopeToken,
                                  @Param("plannedAt") LocalDateTime plannedAt);
}
