package com.hourglass.mapper;

import com.hourglass.dto.ReviewTeamAggRow;
import com.hourglass.dto.ReviewTeamCompletionRow;
import com.hourglass.dto.ReviewTeamDetailRow;
import com.hourglass.dto.ReviewTeamDueRow;
import com.hourglass.dto.ReviewTeamPlanRow;
import com.hourglass.dto.ReviewTeamReleaseRow;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

/**
 * 团队周回顾的聚合查询。全部为只读查询，不改表。
 *
 * <p>周界统一用 [from, before) 左闭右开；项目范围 reqId 为空表示整个空间。</p>
 */
@Mapper
public interface ReviewTeamMapper {

    int countDemandCreated(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                           @Param("from") LocalDateTime from, @Param("before") LocalDateTime before);

    List<ReviewTeamAggRow> demandActionCounts(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                                              @Param("from") LocalDateTime from, @Param("before") LocalDateTime before);

    int countDemandClosed(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                          @Param("from") LocalDateTime from, @Param("before") LocalDateTime before);

    int countDemandCancelled(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                             @Param("from") LocalDateTime from, @Param("before") LocalDateTime before);

    int countReleaseDemands(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                            @Param("from") LocalDateTime from, @Param("before") LocalDateTime before);

    int countReleases(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                      @Param("from") LocalDateTime from, @Param("before") LocalDateTime before);

    List<ReviewTeamAggRow> taskCreatedByType(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                                             @Param("from") LocalDateTime from, @Param("before") LocalDateTime before);

    List<ReviewTeamAggRow> taskDoneByType(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                                          @Param("from") LocalDateTime from, @Param("before") LocalDateTime before);

    int countTaskCancelled(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                           @Param("from") LocalDateTime from, @Param("before") LocalDateTime before);

    List<ReviewTeamAggRow> transitionCounts(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                                            @Param("from") LocalDateTime from, @Param("before") LocalDateTime before);

    int countTransitionItems(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                             @Param("from") LocalDateTime from, @Param("before") LocalDateTime before);

    List<ReviewTeamAggRow> testRunCounts(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                                         @Param("from") LocalDateTime from, @Param("before") LocalDateTime before);

    int countNewCases(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                      @Param("from") LocalDateTime from, @Param("before") LocalDateTime before);

    int countNewDefects(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                        @Param("from") LocalDateTime from, @Param("before") LocalDateTime before);

    int countPendingRetest(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);

    int countDocsCreated(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                         @Param("from") LocalDateTime from, @Param("before") LocalDateTime before);

    int countDocUpdates(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                        @Param("from") LocalDateTime from, @Param("before") LocalDateTime before);

    int countDocsPublished(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                           @Param("from") LocalDateTime from, @Param("before") LocalDateTime before);

    int countDraftBacklog(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                          @Param("before") LocalDateTime before);

    LocalDateTime oldestDraft(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                              @Param("before") LocalDateTime before);

    List<ReviewTeamAggRow> docsByType(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                                      @Param("from") LocalDateTime from, @Param("before") LocalDateTime before);

    List<ReviewTeamAggRow> demandsByStatus(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);

    List<ReviewTeamAggRow> tasksByColumn(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);

    List<ReviewTeamAggRow> dailyCompleted(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                                          @Param("from") LocalDateTime from, @Param("before") LocalDateTime before);

    ReviewTeamAggRow completionTiming(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                                      @Param("from") LocalDateTime from, @Param("before") LocalDateTime before);

    int countCompletedReleased(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                               @Param("from") LocalDateTime from, @Param("before") LocalDateTime before);

    int countRollbackReleases(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                              @Param("from") LocalDateTime from, @Param("before") LocalDateTime before);

    List<ReviewTeamAggRow> testPlanStatusCounts(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                                                @Param("from") LocalDate from, @Param("to") LocalDate to);

    int countTestParticipants(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                              @Param("from") LocalDateTime from, @Param("before") LocalDateTime before);

    int countPendingReleaseTasks(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);

    List<ReviewTeamAggRow> releaseOverdueByProject(@Param("workspaceId") String workspaceId,
                                                   @Param("now") LocalDateTime now);

    List<ReviewTeamAggRow> demandOpenByProject(@Param("workspaceId") String workspaceId);

    int sumWeekMinutes(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                       @Param("from") LocalDateTime from, @Param("before") LocalDateTime before);

    int countTomorrowDue(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                         @Param("from") LocalDate from, @Param("to") LocalDate to);

    ReviewTeamDueRow dueOutcome(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                                @Param("from") LocalDate from, @Param("to") LocalDate to);

    List<ReviewTeamDetailRow> dueItems(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                                       @Param("from") LocalDate from, @Param("to") LocalDate to,
                                       @Param("state") String state, @Param("limit") int limit);

    List<ReviewTeamDetailRow> nextDueItems(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                                           @Param("from") LocalDate from, @Param("to") LocalDate to,
                                           @Param("limit") int limit);

    int countNextMilestones(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                            @Param("from") LocalDate from, @Param("to") LocalDate to);

    int countOverdueTasks(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                          @Param("today") LocalDate today);

    int countBlockedTasks(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);

    int countP0Open(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);

    int countReleaseOverdue(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                            @Param("now") LocalDateTime now);

    int countTestPlanOverdue(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                             @Param("today") LocalDate today);

    int countStale(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                   @Param("staleBefore") LocalDate staleBefore);

    List<ReviewTeamReleaseRow> releasesInWeek(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                                              @Param("from") LocalDateTime from, @Param("before") LocalDateTime before);

    List<ReviewTeamPlanRow> releasePlansInWeek(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                                               @Param("from") LocalDateTime from, @Param("before") LocalDateTime before);

    List<ReviewTeamPlanRow> testPlansInWeek(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                                            @Param("from") LocalDate from, @Param("to") LocalDate to);

    List<ReviewTeamCompletionRow> completionRows(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                                                 @Param("from") LocalDateTime from, @Param("before") LocalDateTime before,
                                                 @Param("limit") int limit);

    /* ---------------- 成员维度 ---------------- */

    List<ReviewTeamAggRow> taskCreatedByActor(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                                              @Param("from") LocalDateTime from, @Param("before") LocalDateTime before);

    List<ReviewTeamAggRow> taskStartedByOwner(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                                              @Param("from") LocalDateTime from, @Param("before") LocalDateTime before);

    List<ReviewTeamAggRow> taskDoneByOwner(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                                           @Param("from") LocalDateTime from, @Param("before") LocalDateTime before);

    List<ReviewTeamAggRow> taskOpenByOwner(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);

    List<ReviewTeamAggRow> overdueByOwner(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                                          @Param("today") LocalDate today);

    List<ReviewTeamAggRow> blockedByOwner(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);

    List<ReviewTeamAggRow> minutesByUser(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                                         @Param("from") LocalDateTime from, @Param("before") LocalDateTime before);

    List<ReviewTeamAggRow> minutesByUserProject(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                                                @Param("from") LocalDateTime from, @Param("before") LocalDateTime before);

    List<ReviewTeamAggRow> docsCreatedByUser(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                                             @Param("from") LocalDateTime from, @Param("before") LocalDateTime before);

    List<ReviewTeamAggRow> docUpdatesByUser(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                                            @Param("from") LocalDateTime from, @Param("before") LocalDateTime before);

    List<ReviewTeamAggRow> testRunsByUser(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                                          @Param("from") LocalDateTime from, @Param("before") LocalDateTime before);

    List<ReviewTeamAggRow> testPassedByUser(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                                            @Param("from") LocalDateTime from, @Param("before") LocalDateTime before);

    List<ReviewTeamAggRow> newCasesByUser(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                                          @Param("from") LocalDateTime from, @Param("before") LocalDateTime before);

    List<ReviewTeamAggRow> defectsByUser(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                                         @Param("from") LocalDateTime from, @Param("before") LocalDateTime before);

    List<ReviewTeamAggRow> defectsByPriority(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                                             @Param("from") LocalDateTime from, @Param("before") LocalDateTime before);

    int sumTestMinutes(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                       @Param("from") LocalDateTime from, @Param("before") LocalDateTime before);

    List<ReviewTeamAggRow> demandActionsByOperator(@Param("workspaceId") String workspaceId,
                                                   @Param("reqId") String reqId,
                                                   @Param("from") LocalDateTime from,
                                                   @Param("before") LocalDateTime before);

    List<ReviewTeamAggRow> taskCommentsByAuthor(@Param("workspaceId") String workspaceId,
                                                @Param("reqId") String reqId,
                                                @Param("from") LocalDateTime from,
                                                @Param("before") LocalDateTime before);

    List<ReviewTeamAggRow> demandCommentsByAuthor(@Param("workspaceId") String workspaceId,
                                                  @Param("reqId") String reqId,
                                                  @Param("from") LocalDateTime from,
                                                  @Param("before") LocalDateTime before);

    List<ReviewTeamAggRow> releaseExecutionsByUser(@Param("workspaceId") String workspaceId,
                                                   @Param("reqId") String reqId,
                                                   @Param("from") LocalDateTime from,
                                                   @Param("before") LocalDateTime before);

    /* ---------------- 项目维度 ---------------- */

    List<ReviewTeamAggRow> demandActionsByProject(@Param("workspaceId") String workspaceId,
                                                  @Param("from") LocalDateTime from, @Param("before") LocalDateTime before);

    List<ReviewTeamAggRow> demandCreatedByProject(@Param("workspaceId") String workspaceId,
                                                  @Param("from") LocalDateTime from, @Param("before") LocalDateTime before);

    List<ReviewTeamAggRow> releasedDemandsByProject(@Param("workspaceId") String workspaceId,
                                                    @Param("from") LocalDateTime from, @Param("before") LocalDateTime before);

    List<ReviewTeamAggRow> tasksCreatedByProject(@Param("workspaceId") String workspaceId,
                                                 @Param("from") LocalDateTime from, @Param("before") LocalDateTime before);

    List<ReviewTeamAggRow> tasksDoneByProject(@Param("workspaceId") String workspaceId,
                                              @Param("from") LocalDateTime from, @Param("before") LocalDateTime before);

    List<ReviewTeamAggRow> minutesByProject(@Param("workspaceId") String workspaceId,
                                            @Param("from") LocalDateTime from, @Param("before") LocalDateTime before);

    List<ReviewTeamAggRow> projectNames(@Param("workspaceId") String workspaceId);

    /* ---------------- 风险样本 ---------------- */

    List<ReviewTeamDetailRow> overdueSamples(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                                             @Param("today") LocalDate today, @Param("limit") int limit);

    List<ReviewTeamDetailRow> blockedSamples(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                                             @Param("limit") int limit);

    /* ---------------- 明细下钻 ---------------- */

    List<ReviewTeamDetailRow> demandCreatedItems(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                                                 @Param("from") LocalDateTime from, @Param("before") LocalDateTime before,
                                                 @Param("limit") int limit);

    List<ReviewTeamDetailRow> demandLogItems(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                                             @Param("from") LocalDateTime from, @Param("before") LocalDateTime before,
                                             @Param("action") String action, @Param("limit") int limit);

    List<ReviewTeamDetailRow> demandClosedItems(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                                                @Param("from") LocalDateTime from, @Param("before") LocalDateTime before,
                                                @Param("limit") int limit);

    List<ReviewTeamDetailRow> demandCancelledItems(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                                                   @Param("from") LocalDateTime from, @Param("before") LocalDateTime before,
                                                   @Param("limit") int limit);

    List<ReviewTeamDetailRow> demandReleasedItems(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                                                  @Param("from") LocalDateTime from, @Param("before") LocalDateTime before,
                                                  @Param("limit") int limit);

    List<ReviewTeamDetailRow> taskCreatedItems(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                                               @Param("from") LocalDateTime from, @Param("before") LocalDateTime before,
                                               @Param("limit") int limit);

    List<ReviewTeamDetailRow> taskTransitionItems(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                                                  @Param("from") LocalDateTime from, @Param("before") LocalDateTime before,
                                                  @Param("toColumn") String toColumn, @Param("limit") int limit);

    List<ReviewTeamDetailRow> taskCompletedItems(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                                                 @Param("from") LocalDateTime from, @Param("before") LocalDateTime before,
                                                 @Param("itemType") String itemType, @Param("limit") int limit);

    List<ReviewTeamDetailRow> taskCancelledItems(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                                                 @Param("from") LocalDateTime from, @Param("before") LocalDateTime before,
                                                 @Param("limit") int limit);

    List<ReviewTeamDetailRow> caseCreatedItems(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                                               @Param("from") LocalDateTime from, @Param("before") LocalDateTime before,
                                               @Param("limit") int limit);

    List<ReviewTeamDetailRow> caseRunItems(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                                           @Param("from") LocalDateTime from, @Param("before") LocalDateTime before,
                                           @Param("status") String status, @Param("limit") int limit);

    List<ReviewTeamDetailRow> pendingRetestItems(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                                                 @Param("limit") int limit);

    List<ReviewTeamDetailRow> docCreatedItems(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                                              @Param("from") LocalDateTime from, @Param("before") LocalDateTime before,
                                              @Param("limit") int limit);

    List<ReviewTeamDetailRow> docUpdatedItems(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                                              @Param("from") LocalDateTime from, @Param("before") LocalDateTime before,
                                              @Param("limit") int limit);

    List<ReviewTeamDetailRow> docPublishedItems(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                                                @Param("from") LocalDateTime from, @Param("before") LocalDateTime before,
                                                @Param("limit") int limit);

    List<ReviewTeamDetailRow> draftItems(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                                         @Param("before") LocalDateTime before, @Param("limit") int limit);
}
