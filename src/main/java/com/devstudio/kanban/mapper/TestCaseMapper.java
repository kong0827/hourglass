package com.devstudio.kanban.mapper;

import com.devstudio.kanban.dto.TestCaseView;
import com.devstudio.kanban.entity.TestCase;
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

    /** 项目用例概览：latest_status 计数（未执行不在此列，由调用方按总数反推） */
    List<Map<String, Object>> countGroupByStatus(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);

    int insert(TestCase testCase);

    int update(TestCase testCase);

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

    int delete(@Param("workspaceId") String workspaceId, @Param("id") String id);

    /** 项目删除级联：用例数（确认提示用）与整项目用例清理 */
    int countByReq(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);

    int deleteByReq(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);

    /** 空间级清理：删除/清空空间与覆盖导入共用 */
    int deleteByWorkspace(@Param("workspaceId") String workspaceId);
}
