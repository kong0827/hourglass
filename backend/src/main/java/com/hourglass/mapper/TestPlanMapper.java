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
                                       @Param("reqId") String reqId,
                                       @Param("offset") int offset, @Param("limit") int limit);

    int countByReq(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);

    /** 关联到某版本的测试计划数：发布检查据此区分「版本未关联计划」与「计划没有用例」 */
    int countByVersion(@Param("workspaceId") String workspaceId, @Param("versionId") String versionId);

    /** 已进入执行的计划数（running/done）：草稿计划不参与发布证据核对 */
    int countActiveByVersion(@Param("workspaceId") String workspaceId, @Param("versionId") String versionId);

    TestPlanView selectViewById(@Param("id") String id);

    /** 计划状态流转（draft/running/done）：独立语句，避免与编辑信息互相覆盖 */
    int updateStatus(@Param("id") String id, @Param("status") String status);

    int deleteById(@Param("workspaceId") String workspaceId, @Param("id") String id);

    /** 项目删除级联 */
    int deleteByReq(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);
}
