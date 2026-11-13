package com.hourglass.mapper;

import com.hourglass.dto.DemandQuery;
import com.hourglass.entity.Demand;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;
import java.util.Map;

@Mapper
public interface DemandMapper {

    List<Demand> selectByReq(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);

    List<Demand> selectByWorkspace(@Param("workspaceId") String workspaceId);

    /** 分页：筛选/排序/LIMIT 全在 SQL 完成 */
    List<Demand> selectPage(@Param("q") DemandQuery query);

    /** 分页总数（与 selectPage 同一 WHERE） */
    int countPage(@Param("q") DemandQuery query);

    /** 各状态计数（status 条件由调用方置空，即忽略状态） */
    List<Map<String, Object>> countGroupByStatus(@Param("q") DemandQuery query);

    /** 看板筛选项计数：按 优先级 × 类型 × 模块 一次分组，由调用方聚合成三个维度 */
    List<Map<String, Object>> countGroupByFacets(@Param("q") DemandQuery query);

    /** 已排期交付阶段计数：使用与工作项、用例、发布明细相同的证据口径 */
    List<Map<String, Object>> countGroupByDeliveryStage(@Param("q") DemandQuery query);

    /** 工作页指标：只返回一行聚合结果，不加载需求明细 */
    Map<String, Object> workpageMetrics(@Param("q") DemandQuery query);

    /** 交付驾驶舱版本筛选项：按当前其他筛选条件聚合 */
    List<Map<String, Object>> selectWorkpageVersions(@Param("q") DemandQuery query);

    /** 项目列表需求计数：只返回聚合结果，不加载需求明细 */
    List<Map<String, Object>> countGroupByReq(@Param("workspaceId") String workspaceId);

    int countByStatus(@Param("workspaceId") String workspaceId, @Param("status") String status,
                      @Param("viewerId") String viewerId);

    Demand selectById(String id);

    /** 项目锁之后使用当前读，避免 REPEATABLE READ 的旧快照。 */
    Demand selectByIdForUpdate(@Param("workspaceId") String workspaceId, @Param("id") String id);

    com.hourglass.entity.ProjectVersion selectScheduleVersion(@Param("workspaceId") String workspaceId,
            @Param("reqId") String reqId, @Param("id") String id);

    List<Demand> selectByVersion(@Param("workspaceId") String workspaceId, @Param("versionId") String versionId);

    /** 需求详情关联任务：任务实际版本与发布时间，区别于需求目标版本。 */
    List<com.hourglass.entity.Task> selectDemandTasks(@Param("workspaceId") String workspaceId,
            @Param("demandId") String demandId, @Param("offset") int offset, @Param("limit") int limit);

    int insert(Demand demand);

    int update(Demand demand);

    int deleteById(@Param("workspaceId") String workspaceId, @Param("id") String id);

    int deleteByReq(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);

    int deleteByWorkspace(@Param("workspaceId") String workspaceId);

    int deleteLogsByWorkspace(@Param("workspaceId") String workspaceId);

    /** 单条需求被删除时清掉它的流转日志，避免留下指向已删记录的孤儿行 */
    int deleteLogsByDemand(@Param("workspaceId") String workspaceId, @Param("demandId") String demandId);

    /** 甘特批量：每条需求最后一次通过/拒绝/排期/调期/取消时间 */
    List<Map<String, Object>> selectLogTimeline(@Param("workspaceId") String workspaceId,
                                                @Param("ids") List<String> ids);

    /** 甘特批量：关联文档首建/最晚发布与发布数（可见范围与文档列表一致） */
    List<Map<String, Object>> selectDocTimeline(@Param("workspaceId") String workspaceId,
                                                @Param("ids") List<String> ids,
                                                @Param("viewerId") String viewerId,
                                                @Param("userId") String userId,
                                                @Param("seeAllDrafts") boolean seeAllDrafts);

    /** 甘特批量：关联工作项完成数与最晚完成日 */
    List<Map<String, Object>> selectTaskTimeline(@Param("workspaceId") String workspaceId,
                                                 @Param("ids") List<String> ids);

    /** 甘特批量：真实开工日（首次离开待处理 / 首次计时），不含计划开始日期 */
    List<Map<String, Object>> selectTaskStartTimeline(@Param("workspaceId") String workspaceId,
                                                      @Param("ids") List<String> ids);

    /** 甘特批量：用例执行起止与未执行 / 未通过数 */
    List<Map<String, Object>> selectTestTimeline(@Param("workspaceId") String workspaceId,
                                                 @Param("ids") List<String> ids);

    /** 甘特批量：需求快照中成功产品发布条目的最晚实际发布日期，不依赖当前目标或任务关联。 */
    List<Map<String, Object>> selectDemandReleaseTimeline(@Param("workspaceId") String workspaceId,
                                                         @Param("ids") List<String> ids);

    List<com.hourglass.entity.VersionRelease> selectActualRecords(@Param("workspaceId") String workspaceId,
                                                                 @Param("ids") List<String> ids);

    int insertLog(@Param("workspaceId") String workspaceId, @Param("demandId") String demandId,
                  @Param("action") String action, @Param("note") String note, @Param("operator") String operator);

    /** 保留文字日志，并追加结构化 before/after 快照（JSON 字符串） */
    int insertChangeLog(@Param("workspaceId") String workspaceId, @Param("demandId") String demandId,
                        @Param("action") String action, @Param("note") String note,
                        @Param("operator") String operator, @Param("changeData") String changeData);

    List<Map<String, Object>> selectLogs(@Param("workspaceId") String workspaceId, @Param("demandId") String demandId,
                                         @Param("offset") int offset, @Param("limit") int limit);

    int countLogs(@Param("workspaceId") String workspaceId, @Param("demandId") String demandId);

    int deleteLogsByReq(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);

    /** 版本被覆盖重建、需求池未随备份恢复时：清掉指向旧版本ID的目标版本 */
    default int clearVersionRefsByWorkspace(String workspaceId) {
        return clearVersionRefs(workspaceId, null);
    }

    /** 删除版本/恢复备份时，同样逐条使用旧 revision CAS，不能绕过需求并发保护。 */
    default int clearVersionRefsByVersion(String workspaceId, String versionId) {
        return clearVersionRefs(workspaceId, versionId);
    }

    default int clearVersionRefs(String workspaceId, String versionId) {
        int changed = 0;
        for (Demand demand : selectByWorkspace(workspaceId)) {
            if (demand.getVersionId() == null
                    || (versionId != null && !versionId.equals(demand.getVersionId()))) {
                continue;
            }
            demand.setVersionId(null);
            if (update(demand) != 1) {
                throw com.hourglass.common.AppException.conflict("需求已被其他人修改，请刷新后重试");
            }
            changed++;
        }
        return changed;
    }
}
