package com.hourglass.mapper;

import com.hourglass.dto.CaseTaskLink;
import com.hourglass.dto.TaskCoverageRow;
import com.hourglass.entity.TestCaseTask;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface TestCaseTaskMapper {

    int insert(TestCaseTask row);

    /** 用例保存时整体替换：先清后插，顺序由调用方在同一事务内保证 */
    int deleteByCase(@Param("caseId") String caseId);

    int deleteByCaseIds(@Param("workspaceId") String workspaceId,
                        @Param("caseIds") List<String> caseIds);

    /** 工作项被彻底删除：解除关联，用例本体保留 */
    int deleteByTaskIds(@Param("workspaceId") String workspaceId,
                        @Param("taskIds") List<String> taskIds);

    /** 需求被删除：该需求下工作项的关联一并解除（用例主需求也会被清空） */
    int deleteByDemand(@Param("workspaceId") String workspaceId,
                       @Param("demandId") String demandId);

    /** 项目删除：用例与工作项都随项目走，关联行先清 */
    int deleteByReq(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);

    int deleteByWorkspace(@Param("workspaceId") String workspaceId);

    /** 备份导出：空间内全部关联行 */
    List<TestCaseTask> selectAllByWorkspace(@Param("workspaceId") String workspaceId);

    /** 批量读取用例关联的工作项（列表页一次取完，避免逐行查询） */
    List<CaseTaskLink> selectByCaseIds(@Param("workspaceId") String workspaceId,
                                       @Param("caseIds") List<String> caseIds);

    /**
     * 用例编辑器的候选工作项：限定项目与主需求，排除回收站。
     * q 按标题模糊匹配；itemNo 为数字时按编号精确匹配（分开传参，避免 varchar 与 int 隐式转换）。
     */
    List<CaseTaskLink> selectOptions(@Param("workspaceId") String workspaceId,
                                     @Param("reqId") String reqId,
                                     @Param("demandId") String demandId,
                                     @Param("q") String q,
                                     @Param("itemNo") Integer itemNo,
                                     @Param("limit") int limit);

    /** 需求详情：按工作项汇总验证用例的结果分布 */
    List<TaskCoverageRow> selectCoverageByDemand(@Param("workspaceId") String workspaceId,
                                                 @Param("demandId") String demandId);

    /** 发布检查：项目内全部工作项（含未覆盖）的验证用例分布 */
    List<TaskCoverageRow> selectCoverageByProject(@Param("workspaceId") String workspaceId,
                                                  @Param("reqId") String reqId);

    /** 用例是否与给定工作项已关联（保存时校验，避免重复插入） */
    List<String> selectTaskIdsByCase(@Param("caseId") String caseId);
}
