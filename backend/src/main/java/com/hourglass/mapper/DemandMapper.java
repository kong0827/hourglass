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

    int insertLog(@Param("workspaceId") String workspaceId, @Param("demandId") String demandId,
                  @Param("action") String action, @Param("note") String note, @Param("operator") String operator);

    List<Map<String, Object>> selectLogs(@Param("workspaceId") String workspaceId, @Param("demandId") String demandId);

    int deleteLogsByReq(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);

    /** 版本被覆盖重建、需求池未随备份恢复时：清掉指向旧版本ID的目标版本 */
    int clearVersionRefsByWorkspace(@Param("workspaceId") String workspaceId);

    /** 删除版本时：需求池中指向该版本的目标版本置空，避免排期指向不存在的版本 */
    int clearVersionRefsByVersion(@Param("workspaceId") String workspaceId, @Param("versionId") String versionId);
}
