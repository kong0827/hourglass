package com.devstudio.kanban.mapper;

import com.devstudio.kanban.entity.TestCaseRun;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface TestCaseRunMapper {

    int insert(TestCaseRun run);

    /** 备份导出：空间下全部执行流水 */
    List<TestCaseRun> selectByWorkspace(@Param("workspaceId") String workspaceId);

    TestCaseRun selectLatestByCase(@Param("caseId") String caseId);

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
