package com.devstudio.kanban.mapper;

import com.devstudio.kanban.entity.DevBranch;
import com.devstudio.kanban.entity.DevBranchLog;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface DevBranchMapper {

    /** 空间下的分支列表（带关联任务数 / 已完成数）。reqId 非空时只返回该项目的分支。 */
    List<DevBranch> selectByWorkspace(@Param("workspaceId") String workspaceId,
                                      @Param("reqId") String reqId);

    /** 分支列表（任务数只统计查看人可见的项目，避免隐藏项目的任务量外泄）。reqId 非空时只返回该项目的分支。 */
    List<DevBranch> selectVisibleByWorkspace(@Param("workspaceId") String workspaceId,
                                             @Param("viewerId") String viewerId,
                                             @Param("reqId") String reqId);

    /**
     * 分支「影响版本」标签：task.branch_id × version_task 推导（无独立绑定）。
     * viewerId 非空时按项目可见性过滤（与 selectVisibleByWorkspace 同口径）。
     */
    List<com.devstudio.kanban.dto.BranchVersionTag> selectVersionTags(
            @Param("workspaceId") String workspaceId, @Param("viewerId") String viewerId);

    /**
     * 分支「归属项目」标签：task.branch_id × task.req_id 推导（无独立绑定）。
     * viewerId 非空时按项目可见性过滤（与 selectVisibleByWorkspace 同口径）。
     */
    List<com.devstudio.kanban.dto.BranchProjectTag> selectProjectTags(
            @Param("workspaceId") String workspaceId, @Param("viewerId") String viewerId);

    /** 分支简表（id/name/status），版本统计聚合分支进度用 */
    List<DevBranch> selectBriefsByWorkspace(@Param("workspaceId") String workspaceId);

    DevBranch selectById(@Param("id") String id);

    /**
     * 同名分支计数（excludeId 非空表示编辑时排除自己）。
     * reqId 维度：同一项目内分支名唯一；reqId 为空时只在空间级公共分支里判重。
     */
    int countByName(@Param("workspaceId") String workspaceId, @Param("name") String name,
                    @Param("reqId") String reqId, @Param("excludeId") String excludeId);

    /** 项目删除时把直接归属它的分支退回空间级公共分支 */
    int clearReqIdByReq(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);

    int insert(DevBranch branch);

    /** 只更新基础信息（名字/负责人/目标分支/备注），状态走 updateStatus */
    int update(DevBranch branch);

    /**
     * 改状态并盖上对应状态的时间点（只盖第一次：COALESCE 保留已有值）。
     * 用四个 boolean 而不是状态字符串拼列名 —— 避免任何形式的列名拼接。
     */
    int updateStatus(@Param("workspaceId") String workspaceId, @Param("id") String id,
                     @Param("status") String status,
                     @Param("dev") boolean dev, @Param("testing") boolean testing,
                     @Param("merging") boolean merging, @Param("released") boolean released);

    int deleteById(@Param("workspaceId") String workspaceId, @Param("id") String id);

    int deleteByWorkspace(@Param("workspaceId") String workspaceId);

    /* ---------------- 状态变更时间线 ---------------- */

    int insertLog(DevBranchLog log);

    /** 某分支的时间线（倒序） */
    List<DevBranchLog> selectLogs(@Param("branchId") String branchId);

    int deleteLogsByBranch(@Param("branchId") String branchId);

    int deleteLogsByWorkspace(@Param("workspaceId") String workspaceId);
}
