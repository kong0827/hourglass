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

    /** 项目列表需求计数：只返回聚合结果，不加载需求明细 */
    List<Map<String, Object>> countGroupByReq(@Param("workspaceId") String workspaceId);

    int countByStatus(@Param("workspaceId") String workspaceId, @Param("status") String status,
                      @Param("viewerId") String viewerId);

    Demand selectById(String id);

    List<Demand> selectByVersion(@Param("workspaceId") String workspaceId, @Param("versionId") String versionId);

    int insert(Demand demand);

    int update(Demand demand);

    int deleteById(@Param("workspaceId") String workspaceId, @Param("id") String id);

    int deleteByReq(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);

    int deleteByWorkspace(@Param("workspaceId") String workspaceId);

    int deleteLogsByWorkspace(@Param("workspaceId") String workspaceId);

    /** 单条需求被删除时清掉它的流转日志，避免留下指向已删记录的孤儿行 */
    int deleteLogsByDemand(@Param("workspaceId") String workspaceId, @Param("demandId") String demandId);

    /** 甘特批量：每条需求最后一次通过/拒绝/排期时间 */
    List<Map<String, Object>> selectLogTimeline(@Param("workspaceId") String workspaceId,
                                                @Param("ids") List<String> ids);

    /** 甘特批量：关联文档首建/最晚发布与发布数（可见范围与文档列表一致） */
    List<Map<String, Object>> selectDocTimeline(@Param("workspaceId") String workspaceId,
                                                @Param("ids") List<String> ids,
                                                @Param("viewerId") String viewerId,
                                                @Param("userId") String userId,
                                                @Param("seeAllDrafts") boolean seeAllDrafts);

    /** 甘特批量：关联工作项起止与完成数 */
    List<Map<String, Object>> selectTaskTimeline(@Param("workspaceId") String workspaceId,
                                                 @Param("ids") List<String> ids);

    /** 甘特批量：用例执行起止与最近一次未通过数 */
    List<Map<String, Object>> selectTestTimeline(@Param("workspaceId") String workspaceId,
                                                 @Param("ids") List<String> ids);

    /** 甘特批量：目标版本实际发布时间 */
    List<Map<String, Object>> selectVersionTimeline(@Param("workspaceId") String workspaceId,
                                                    @Param("ids") List<String> ids);

    int insertLog(@Param("workspaceId") String workspaceId, @Param("demandId") String demandId,
                  @Param("action") String action, @Param("note") String note, @Param("operator") String operator);

    List<Map<String, Object>> selectLogs(@Param("workspaceId") String workspaceId, @Param("demandId") String demandId,
                                         @Param("offset") int offset, @Param("limit") int limit);

    int countLogs(@Param("workspaceId") String workspaceId, @Param("demandId") String demandId);

    int deleteLogsByReq(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);

    /** 版本被覆盖重建、需求池未随备份恢复时：清掉指向旧版本ID的目标版本 */
    int clearVersionRefsByWorkspace(@Param("workspaceId") String workspaceId);

    /** 删除版本时：需求池中指向该版本的目标版本置空，避免排期指向不存在的版本 */
    int clearVersionRefsByVersion(@Param("workspaceId") String workspaceId, @Param("versionId") String versionId);
}
