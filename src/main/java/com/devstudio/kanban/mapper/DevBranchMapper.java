package com.devstudio.kanban.mapper;

import com.devstudio.kanban.entity.DevBranch;
import com.devstudio.kanban.entity.DevBranchLog;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface DevBranchMapper {

    /** 空间下的分支列表（带关联任务数 / 已完成数） */
    List<DevBranch> selectByWorkspace(@Param("workspaceId") String workspaceId);

    /** 分支列表（任务数只统计查看人可见的项目，避免隐藏项目的任务量外泄） */
    List<DevBranch> selectVisibleByWorkspace(@Param("workspaceId") String workspaceId,
                                             @Param("viewerId") String viewerId);

    DevBranch selectById(@Param("id") String id);

    /** 同名分支计数（excludeId 非空表示编辑时排除自己） */
    int countByName(@Param("workspaceId") String workspaceId, @Param("name") String name,
                    @Param("excludeId") String excludeId);

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

    int deleteById(@Param("id") String id);

    int deleteByWorkspace(@Param("workspaceId") String workspaceId);

    /* ---------------- 状态变更时间线 ---------------- */

    int insertLog(DevBranchLog log);

    /** 某分支的时间线（倒序） */
    List<DevBranchLog> selectLogs(@Param("branchId") String branchId);

    int deleteLogsByBranch(@Param("branchId") String branchId);

    int deleteLogsByWorkspace(@Param("workspaceId") String workspaceId);
}
