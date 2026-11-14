package com.hourglass.mapper;

import com.hourglass.dto.PlanVersionRow;
import com.hourglass.dto.ReleasePlanOptionRow;
import com.hourglass.dto.TaskVersionBinding;
import com.hourglass.entity.Demand;
import com.hourglass.entity.Requirement;
import com.hourglass.entity.Task;
import com.hourglass.entity.VersionRelease;
import com.hourglass.entity.VersionReleaseItem;
import com.hourglass.entity.VersionReleasePlan;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;

@Mapper
public interface ReleaseMapper {
    String lockProject(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);
    Task selectTaskForUpdate(@Param("workspaceId") String workspaceId, @Param("taskId") String taskId);
    List<Task> selectScope(@Param("workspaceId") String workspaceId, @Param("versionId") String versionId);
    List<Task> selectScopeForVersions(@Param("workspaceId") String workspaceId, @Param("versionIds") List<String> versionIds);
    List<PlanVersionRow> selectPlanVersions(@Param("workspaceId") String workspaceId, @Param("planId") String planId);
    List<ReleasePlanOptionRow> selectPlanVersionOptions(@Param("workspaceId") String workspaceId);
    int insertPlanVersion(@Param("workspaceId") String workspaceId, @Param("planId") String planId,
                          @Param("versionId") String versionId, @Param("reqId") String reqId);
    int deletePlanVersions(@Param("workspaceId") String workspaceId, @Param("planId") String planId);
    int countPlanVersions(@Param("workspaceId") String workspaceId, @Param("planId") String planId);
    int countPlanVersionsReleased(@Param("workspaceId") String workspaceId, @Param("planId") String planId);
    List<TaskVersionBinding> selectTaskVersionRowsForUpdate(@Param("workspaceId") String workspaceId,
                                                          @Param("taskIds") List<String> taskIds);
    /** Project-scoped current reads; the all-tasks guard deliberately includes trash and unbound tasks. */
    List<Task> selectActiveTasksByProjectForUpdate(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);
    List<Task> selectAllTasksByProjectForUpdate(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);
    List<VersionRelease> selectRecordsByProjectForUpdate(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);
    List<VersionRelease> selectRecordsForUpdate(@Param("workspaceId") String workspaceId, @Param("versionId") String versionId);
    Requirement selectProjectForUpdate(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);
    List<Demand> selectDemandsByProjectForUpdate(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);
    List<VersionReleasePlan> selectPlans(@Param("workspaceId") String workspaceId, @Param("versionId") String versionId);
    List<com.hourglass.dto.ReleasePlanRow> selectPlanSchedule(@Param("workspaceId") String workspaceId,
                                                             @Param("from") LocalDate from,
                                                             @Param("to") LocalDate to,
                                                             @Param("reqId") String reqId,
                                                             @Param("environment") String environment,
                                                             @Param("statuses") List<String> statuses,
                                                             @Param("viewerId") String viewerId,
                                                             @Param("limit") int limit);
    VersionReleasePlan selectPlanForUpdate(@Param("workspaceId") String workspaceId, @Param("planId") String planId);
    List<String> selectPlannedTaskIds(@Param("workspaceId") String workspaceId, @Param("planId") String planId);
    List<String> selectPlannedTaskIdsForUpdate(@Param("workspaceId") String workspaceId, @Param("planId") String planId);
    int deletePlanTasks(@Param("workspaceId") String workspaceId, @Param("planId") String planId);
    int insertPlanTask(@Param("workspaceId") String workspaceId, @Param("planId") String planId, @Param("taskId") String taskId);
    VersionRelease selectRecordForUpdate(@Param("workspaceId") String workspaceId, @Param("releaseId") String releaseId);
    List<VersionRelease> selectDemandRecords(@Param("workspaceId") String workspaceId, @Param("demandId") String demandId);
    List<VersionRelease> selectPublicationRecords(@Param("workspaceId") String workspaceId, @Param("taskIds") List<String> taskIds);
    VersionRelease selectByKeyForUpdate(@Param("workspaceId") String workspaceId, @Param("versionId") String versionId,
                                       @Param("key") String key);
    List<VersionReleaseItem> selectItemsForUpdate(@Param("workspaceId") String workspaceId, @Param("releaseId") String releaseId);
    int insertPlan(VersionReleasePlan plan);
    int updatePlan(VersionReleasePlan plan);
    int completePlan(@Param("workspaceId") String workspaceId, @Param("id") String id, @Param("revision") Long revision);
    VersionRelease selectByKey(@Param("workspaceId") String workspaceId, @Param("versionId") String versionId,
                              @Param("key") String key);
    VersionRelease selectSuccess(@Param("workspaceId") String workspaceId, @Param("versionId") String versionId);
    List<VersionRelease> selectRecords(@Param("workspaceId") String workspaceId, @Param("versionId") String versionId);
    List<VersionRelease> selectTaskRecords(@Param("workspaceId") String workspaceId, @Param("taskId") String taskId);
    int insertRecord(VersionRelease record);
    /** 项目内下一个发布记录编号（sql/82）；并发撞 uk_release_no 时由调用方重算重试 */
    int selectNextReleaseNo(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);
    /** 按 ID 取编号：回滚关联的事件可能属于别的版本，不在本版本记录列表里 */
    Integer selectReleaseNo(@Param("workspaceId") String workspaceId, @Param("releaseId") String releaseId);
    int insertItem(VersionReleaseItem item);
    List<VersionReleaseItem> selectItems(@Param("workspaceId") String workspaceId, @Param("releaseId") String releaseId);
    /** JSON target identity lists; explicit mapping avoids global List type-handler side effects. */
    class StringListTypeHandler extends org.apache.ibatis.type.BaseTypeHandler<List<String>> {
        private static final com.fasterxml.jackson.databind.ObjectMapper JSON = new com.fasterxml.jackson.databind.ObjectMapper();
        @Override
        public void setNonNullParameter(java.sql.PreparedStatement ps, int i, List<String> value,
                                        org.apache.ibatis.type.JdbcType jdbcType) throws java.sql.SQLException {
            try { ps.setString(i, JSON.writeValueAsString(value)); }
            catch (java.io.IOException e) { throw new java.sql.SQLException("Invalid target identities", e); }
        }
        private List<String> parse(String value) throws java.sql.SQLException {
            if (value == null) return new java.util.ArrayList<String>();
            try { return JSON.readValue(value, new com.fasterxml.jackson.core.type.TypeReference<List<String>>() {}); }
            catch (java.io.IOException e) { throw new java.sql.SQLException("Invalid target identities", e); }
        }
        @Override public List<String> getNullableResult(java.sql.ResultSet rs, String name) throws java.sql.SQLException { return parse(rs.getString(name)); }
        @Override public List<String> getNullableResult(java.sql.ResultSet rs, int i) throws java.sql.SQLException { return parse(rs.getString(i)); }
        @Override public List<String> getNullableResult(java.sql.CallableStatement cs, int i) throws java.sql.SQLException { return parse(cs.getString(i)); }
    }
    int insertLog(@Param("workspaceId") String workspaceId, @Param("versionId") String versionId,
                  @Param("action") String action, @Param("actorId") String actorId,
                  @Param("reason") String reason, @Param("changeData") String changeData);
    int insertTaskChangeLog(@Param("workspaceId") String workspaceId, @Param("taskId") String taskId,
                            @Param("actorId") String actorId, @Param("detail") String detail,
                            @Param("changeData") String changeData);
    List<Map<String, Object>> selectLogs(@Param("workspaceId") String workspaceId, @Param("versionId") String versionId);
    int countRecordsByProject(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);
    int countSuccessByProject(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);
    int countSuccessByWorkspace(@Param("workspaceId") String workspaceId);
    int countSuccessByTask(@Param("workspaceId") String workspaceId, @Param("taskId") String taskId);
    int deletePlansByVersion(@Param("workspaceId") String workspaceId, @Param("versionId") String versionId);
}
