package com.hourglass.mapper;

import com.hourglass.dto.TestCaseView;
import com.hourglass.entity.TestCase;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;
import java.util.Map;

@Mapper
public interface TestCaseMapper {

    TestCase selectById(@Param("id") String id);

    /** 备份导出：空间下全部用例 */
    List<TestCase> selectByWorkspace(@Param("workspaceId") String workspaceId);

    /** 项目下用例列表：带转出缺陷任务标题，按创建时间倒序（新的在前） */
    List<TestCaseView> selectViewByReq(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);

    /** 分页列表（筛选 + LIMIT 下推） */
    List<TestCaseView> selectViewByQuery(@Param("q") com.hourglass.dto.CaseQuery query);

    int countByQuery(@Param("q") com.hourglass.dto.CaseQuery query);

    /** 筛选下拉候选值（不受当前筛选影响） */
    List<String> selectModules(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);

    /** 项目内已有用例标题（AI 生成时去重，避免同一功能重复建用例） */
    List<String> selectTitlesByReq(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);

    List<String> selectOwners(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);

    /** 筛选项计数（不受当前筛选影响）：模块 / 优先级 / 执行人 */
    List<Map<String, Object>> countFacetsByModule(@Param("workspaceId") String workspaceId,
                                                  @Param("reqId") String reqId);

    List<Map<String, Object>> countFacetsByPriority(@Param("workspaceId") String workspaceId,
                                                    @Param("reqId") String reqId);

    List<Map<String, Object>> countFacetsByOwner(@Param("workspaceId") String workspaceId,
                                                 @Param("reqId") String reqId);

    /** 项目用例概览：latest_status 计数（未执行不在此列，由调用方按总数反推） */
    List<Map<String, Object>> countGroupByStatus(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);

    int insert(TestCase testCase);


    int update(TestCase testCase);

    /** 批量改模块 / 优先级；moduleSet / prioritySet 为 false 时对应列不动 */
    int batchUpdate(@Param("workspaceId") String workspaceId,
                    @Param("ids") List<String> ids,
                    @Param("moduleSet") boolean moduleSet, @Param("module") String module,
                    @Param("prioritySet") boolean prioritySet, @Param("priority") String priority);

    int updateLatest(@Param("workspaceId") String workspaceId, @Param("id") String id,
                     @Param("status") String status, @Param("note") String note,
                     @Param("by") String by, @Param("byUserId") String byUserId);

    int updateLatestBug(@Param("workspaceId") String workspaceId, @Param("id") String id,
                        @Param("bugTaskId") String bugTaskId);

    /** 缺陷任务被彻底删除时解除引用，避免列表显示失效缺陷 */
    int clearBugTaskRefs(@Param("workspaceId") String workspaceId,
                         @Param("taskIds") List<String> taskIds);

    /** 空间内任务整体清空时解除全部缺陷引用（旧备份保留用例时也不会留下悬空缺陷） */
    int clearAllBugTaskRefs(@Param("workspaceId") String workspaceId);

    /** 需求删除级联：解除用例上的关联需求引用 */
    int clearDemandRefs(@Param("workspaceId") String workspaceId, @Param("demandId") String demandId);

    /** 更换需求所属项目前检查：该需求是否已关联用例 */
    int countByDemandRef(@Param("workspaceId") String workspaceId, @Param("demandId") String demandId);

    int delete(@Param("workspaceId") String workspaceId, @Param("id") String id);

    /** 项目删除级联：用例数（确认提示用）与整项目用例清理 */
    int countByReq(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);

    /** 覆盖矩阵：按需求池需求聚合用例结果（含零用例的需求） */
    List<com.hourglass.dto.CaseCoverageRow> selectCoverageByDemand(@Param("workspaceId") String workspaceId,
                                                                   @Param("reqId") String reqId);

    /** 覆盖矩阵：未关联任何需求的用例单独成行 */
    com.hourglass.dto.CaseCoverageRow selectUnlinkedCoverage(@Param("workspaceId") String workspaceId,
                                                             @Param("reqId") String reqId);

    /** 全局搜索：跨项目匹配标题/模块/前置条件/编号，viewerId 非空时排除无权限项目 */
    List<com.hourglass.dto.SearchHit> searchVisible(@Param("workspaceId") String workspaceId,
                                                    @Param("viewerId") String viewerId,
                                                    @Param("q") String q,
                                                    @Param("caseNo") Integer caseNo,
                                                    @Param("limit") int limit);

    int deleteByReq(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);

    /** 空间级清理：删除/清空空间与覆盖导入共用 */
    int deleteByWorkspace(@Param("workspaceId") String workspaceId);

    /** 整空间删除专用：测试计划圈选行 / 测试计划 / 用例模块（备份不含这三类，导入覆盖时不清） */
    int deletePlanCasesByWorkspace(@Param("workspaceId") String workspaceId);

    int deletePlansByWorkspace(@Param("workspaceId") String workspaceId);

    int deleteModulesByWorkspace(@Param("workspaceId") String workspaceId);
}
