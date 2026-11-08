package com.hourglass.mapper;

import com.hourglass.dto.TestPlanView;
import com.hourglass.entity.TestPlan;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface TestPlanMapper {

    int insert(TestPlan plan);

    int update(TestPlan plan);

    TestPlan selectById(@Param("id") String id);

    /** 项目下计划列表（含圈选/执行汇总，一次聚合带回） */
    List<TestPlanView> selectViewByReq(@Param("workspaceId") String workspaceId,
                                       @Param("reqId") String reqId);

    TestPlanView selectViewById(@Param("id") String id);

    /** 计划状态流转（draft/running/done）：独立语句，避免与编辑信息互相覆盖 */
    int updateStatus(@Param("id") String id, @Param("status") String status);

    int deleteById(@Param("workspaceId") String workspaceId, @Param("id") String id);

    /** 项目删除级联 */
    int deleteByReq(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);
}
