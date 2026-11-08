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
    List<TestPlanCaseView> selectViewByPlan(@Param("planId") String planId);

    TestPlanCase selectByPlanAndCase(@Param("planId") String planId, @Param("caseId") String caseId);

    /** 批量执行结果回写（计划内口径） */
    int updateResult(@Param("planId") String planId, @Param("caseId") String caseId,
                     @Param("result") String result, @Param("note") String note,
                     @Param("by") String by, @Param("byUserId") String byUserId);

    int deleteByPlanAndCase(@Param("planId") String planId, @Param("caseId") String caseId);

    int deleteByPlan(@Param("planId") String planId);

    /** 用例被删除时解除计划圈选（保留计划本体） */
    int deleteByCase(@Param("caseId") String caseId);

    /** 项目删除级联：计划随项目走 */
    int deleteByReq(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);
}
