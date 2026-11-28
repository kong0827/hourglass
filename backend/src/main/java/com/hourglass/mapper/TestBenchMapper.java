package com.hourglass.mapper;

import com.hourglass.dto.MyTestPlanRow;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;
import java.util.Map;

/**
 * 测试工作台汇总：跨项目聚合只看当前用户可见的项目（req_id IN 可见集）。
 * 全部是只读统计 SQL，不新增表。
 */
@Mapper
public interface TestBenchMapper {

    /** 可见项目内的用例总量与最近结果分布（未执行 = latest_status IS NULL） */
    Map<String, Object> caseCounts(@Param("workspaceId") String workspaceId,
                                   @Param("reqIds") List<String> reqIds);

    /** 可见项目内的计划总量与状态分布（draft/running/done） */
    Map<String, Object> planCounts(@Param("workspaceId") String workspaceId,
                                   @Param("reqIds") List<String> reqIds);

    /** 进行中计划（draft/running）按最近更新排序，带执行汇总，供流程条与列表卡 */
    List<MyTestPlanRow> selectActivePlans(@Param("workspaceId") String workspaceId,
                                          @Param("reqIds") List<String> reqIds,
                                          @Param("limit") int limit);

    /** 最近完成的计划：作为「最近报告」锚点（报告从完成轮次进入） */
    List<MyTestPlanRow> selectDonePlans(@Param("workspaceId") String workspaceId,
                                        @Param("reqIds") List<String> reqIds,
                                        @Param("limit") int limit);

    /** 可见项目内的缺陷总量（bug 任务），供新手任务「把一个失败转缺陷」的完成态推导 */
    int countBugs(@Param("workspaceId") String workspaceId,
                  @Param("reqIds") List<String> reqIds);
}
