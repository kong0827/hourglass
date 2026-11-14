package com.hourglass.mapper;

import com.hourglass.dto.TestPlanCaseView;
import com.hourglass.entity.TestPlanCase;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface TestPlanCaseMapper {

    int insert(TestPlanCase row);

    /** 已在计划内的用例 ID（圈选去重用） */
    List<String> selectCaseIds(@Param("planId") String planId);

    /** 计划详情的用例行（本体信息 + 计划内结果） */
    List<TestPlanCaseView> selectViewByPlan(@Param("planId") String planId,
                                            @Param("offset") int offset, @Param("limit") int limit);

    int countByPlan(@Param("planId") String planId);

    /** 发布检查：按版本汇总其测试计划内的用例（同一用例多计划出现时由服务层取最差结果） */
    List<com.hourglass.dto.ReleaseCheckCase> selectEvidenceCasesByVersion(@Param("workspaceId") String workspaceId,
                                                                         @Param("versionId") String versionId);

    TestPlanCase selectByPlanAndCase(@Param("planId") String planId, @Param("caseId") String caseId);

    /** 批量执行结果回写（计划内口径） */
    int updateResult(@Param("planId") String planId, @Param("caseId") String caseId,
                     @Param("result") String result, @Param("note") String note,
                     @Param("by") String by, @Param("byUserId") String byUserId);

    /** 发布必测标记（逐条切换） */
    int updateRequired(@Param("planId") String planId, @Param("caseId") String caseId,
                       @Param("required") boolean required);

    int deleteByPlanAndCase(@Param("planId") String planId, @Param("caseId") String caseId);

    int deleteByPlan(@Param("planId") String planId);

    /** 用例被删除时解除计划圈选（保留计划本体） */
    int deleteByCase(@Param("caseId") String caseId);

    /** 包含该用例的未完成计划名（draft / running），用于阻止用例被改到其他项目 */
    List<String> selectOpenPlanNamesByCase(@Param("workspaceId") String workspaceId, @Param("caseId") String caseId);

    /** 项目删除级联：计划随项目走 */
    int deleteByReq(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);
}
