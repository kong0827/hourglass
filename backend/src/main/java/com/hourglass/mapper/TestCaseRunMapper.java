package com.hourglass.mapper;

import com.hourglass.entity.TestCaseRun;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface TestCaseRunMapper {

    int insert(TestCaseRun run);

    /** 备份导出：空间下全部执行流水 */
    List<TestCaseRun> selectByWorkspace(@Param("workspaceId") String workspaceId);

    TestCaseRun selectLatestByCase(@Param("caseId") String caseId);

    /** 单条执行记录（失败证据附件按 run id 挂载，校验归属用） */
    TestCaseRun selectById(@Param("id") String id);

    /** 用例执行历史：最近在前，报告与详情共用 */
    List<TestCaseRun> selectByCase(@Param("workspaceId") String workspaceId,
                                   @Param("caseId") String caseId,
                                   @Param("limit") int limit);

    /** 最近失败转出缺陷时回填该轮流水（仅当该轮为 failed 时由服务层判断） */
    int updateBugTask(@Param("id") String id, @Param("bugTaskId") String bugTaskId);

    /** 缺陷任务被彻底删除时解除引用 */
    int clearBugTaskRefs(@Param("workspaceId") String workspaceId,
                         @Param("taskIds") List<String> taskIds);

    /** 空间内任务整体清空时解除全部缺陷引用 */
    int clearAllBugTaskRefs(@Param("workspaceId") String workspaceId);

    int deleteByCase(@Param("workspaceId") String workspaceId, @Param("caseId") String caseId);

    /** 项目删除级联：按所属项目清流水 */
    int deleteByReq(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);

    /** 空间级清理：删除/清空空间与覆盖导入共用 */
    int deleteByWorkspace(@Param("workspaceId") String workspaceId);
}
