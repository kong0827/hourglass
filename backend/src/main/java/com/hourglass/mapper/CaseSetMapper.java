package com.hourglass.mapper;

import com.hourglass.entity.CaseSet;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface CaseSetMapper {

    /** 项目下当前用户可见的分组（团队共享 + 指定成员名单 + 自己的个人分组），带成员数 */
    List<com.hourglass.dto.CaseSetView> selectVisibleWithCounts(@Param("workspaceId") String workspaceId,
                                                                @Param("reqId") String reqId,
                                                                @Param("viewerId") String viewerId);

    CaseSet selectById(@Param("id") String id);

    /** 项目下全部动态分组（自愈刷新用，不过可见性） */
    List<CaseSet> selectDynamicByReq(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);

    /** visibility=members 的可见成员名单 */
    List<String> selectMemberIds(@Param("setId") String setId);

    /** 规则引用了该目录节点的动态分组名（目录删除守卫） */
    List<String> selectDynamicNamesByModule(@Param("workspaceId") String workspaceId,
                                            @Param("reqId") String reqId, @Param("moduleId") String moduleId);

    int insertMembers(@Param("workspaceId") String workspaceId, @Param("setId") String setId,
                      @Param("userIds") List<String> userIds);

    int deleteMembersBySet(@Param("setId") String setId);

    int deleteMembersByReq(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);

    int deleteMembersByWorkspace(@Param("workspaceId") String workspaceId);

    /** 团队分组成员按最近一轮结果分布（发布检查 / 交付说明证据口径） */
    List<java.util.Map<String, Object>> countTeamSetResults(@Param("workspaceId") String workspaceId,
                                                            @Param("reqId") String reqId);

    int insert(CaseSet set);

    int update(CaseSet set);

    int delete(@Param("workspaceId") String workspaceId, @Param("id") String id);

    /** 已在分组内的用例 ID（加入去重用） */
    List<String> selectCaseIds(@Param("setId") String setId);

    /** 批量加入：INSERT IGNORE 去重，返回实际新增行数 */
    int insertItems(@Param("workspaceId") String workspaceId, @Param("setId") String setId,
                    @Param("caseIds") List<String> caseIds, @Param("userId") String userId);

    int deleteItems(@Param("setId") String setId, @Param("caseIds") List<String> caseIds);

    int deleteItemsBySet(@Param("setId") String setId);

    /** 用例删除级联：摘掉它在所有分组里的引用 */
    int deleteItemsByCase(@Param("caseId") String caseId);

    int deleteByReq(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);

    /** 项目删除级联：先摘掉该项目下所有分组的成员引用 */
    int deleteItemsByReq(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);

    int deleteItemsByWorkspace(@Param("workspaceId") String workspaceId);

    int deleteByWorkspace(@Param("workspaceId") String workspaceId);
}