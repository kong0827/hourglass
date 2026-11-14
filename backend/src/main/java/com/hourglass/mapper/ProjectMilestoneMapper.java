package com.hourglass.mapper;

import com.hourglass.dto.MilestoneTaskLink;
import com.hourglass.entity.ProjectMilestone;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;

@Mapper
public interface ProjectMilestoneMapper {

    List<ProjectMilestone> selectByReq(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);

    ProjectMilestone selectById(@Param("workspaceId") String workspaceId, @Param("id") String id);

    ProjectMilestone selectByIdForUpdate(@Param("workspaceId") String workspaceId, @Param("id") String id);

    int countByVersion(@Param("workspaceId") String workspaceId, @Param("versionId") String versionId);

    int insert(ProjectMilestone milestone);

    int updateMeta(@Param("workspaceId") String workspaceId, @Param("id") String id,
                   @Param("name") String name, @Param("ownerUserId") String ownerUserId,
                   @Param("keyMilestone") Boolean keyMilestone, @Param("note") String note,
                   @Param("revision") Long revision);

    int reschedule(@Param("workspaceId") String workspaceId, @Param("id") String id,
                   @Param("targetDate") LocalDate targetDate, @Param("revision") Long revision);

    int cancel(@Param("workspaceId") String workspaceId, @Param("id") String id,
               @Param("reason") String reason, @Param("revision") Long revision);

    int achieveManual(@Param("workspaceId") String workspaceId, @Param("id") String id,
                      @Param("note") String note, @Param("userId") String userId,
                      @Param("revision") Long revision);

    int revokeManual(@Param("workspaceId") String workspaceId, @Param("id") String id,
                     @Param("revision") Long revision);

    List<MilestoneTaskLink> selectTaskLinksByReq(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);

    int insertTasks(@Param("workspaceId") String workspaceId, @Param("milestoneId") String milestoneId,
                    @Param("taskIds") List<String> taskIds);

    int deleteTasks(@Param("workspaceId") String workspaceId, @Param("milestoneId") String milestoneId);

    int verifyTasks(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                    @Param("taskIds") List<String> taskIds);

    int insertLog(@Param("workspaceId") String workspaceId, @Param("milestoneId") String milestoneId,
                  @Param("action") String action, @Param("detail") String detail,
                  @Param("operatorUserId") String operatorUserId);

    List<Map<String, Object>> selectLogs(@Param("workspaceId") String workspaceId,
                                         @Param("milestoneId") String milestoneId);

    int deleteByReq(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);

    int deleteByWorkspace(@Param("workspaceId") String workspaceId);

    int deleteTaskLinksByTaskIds(@Param("workspaceId") String workspaceId, @Param("taskIds") List<String> taskIds);

    int deleteTaskLinksByReq(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);

    int deleteTaskLinksByWorkspace(@Param("workspaceId") String workspaceId);

    int deleteLogsByReq(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);

    int deleteLogsByWorkspace(@Param("workspaceId") String workspaceId);
}
