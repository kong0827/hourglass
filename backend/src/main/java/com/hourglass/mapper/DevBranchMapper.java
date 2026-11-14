package com.hourglass.mapper;

import com.hourglass.entity.DevBranch;
import com.hourglass.entity.DevBranchLog;
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

    /** 分页列表（带关联任务数 / 已完成数；筛选、排序、分页全部下推） */
    List<DevBranch> selectPage(@Param("q") com.hourglass.dto.BranchQuery q);

    /** 轻量下拉选项：只取 id/name/status 等字段，不带任务数与标签 */
    List<DevBranch> selectOptions(@Param("q") com.hourglass.dto.BranchQuery q);

    int countOptions(@Param("q") com.hourglass.dto.BranchQuery q);

    /** 各状态条数（忽略 q.status；与分页同一口径） */
    List<java.util.Map<String, Object>> countGroupByStatus(@Param("q") com.hourglass.dto.BranchQuery q);

    /** 各生命周期条数（忽略 q.outcome；与分页同一口径，供 chips 计数） */
    List<java.util.Map<String, Object>> countGroupByOutcome(@Param("q") com.hourglass.dto.BranchQuery q);

    /** 已发布分支的平均发布周期（天）；无样本返回 null */
    Double selectAvgCycleDays(@Param("q") com.hourglass.dto.BranchQuery q);

    /**
     * 分支「影响版本」标签：task.branch_id × version_task 推导（无独立绑定）。
     * viewerId 非空时按项目可见性过滤（与 selectVisibleByWorkspace 同口径）。
     * branchIds 非空时只查这些分支，避免分页时全表聚合。
     */
    List<com.hourglass.dto.BranchVersionTag> selectVersionTags(
            @Param("workspaceId") String workspaceId, @Param("viewerId") String viewerId,
            @Param("branchIds") List<String> branchIds);

    /** 版本筛选候选：当前项目/可见范围内分支命中的影响版本及分支数 */
    List<com.hourglass.dto.BranchVersionTag> selectVersionFacets(
            @Param("q") com.hourglass.dto.BranchQuery q);

    /**
     * 分支「归属项目」标签：task.branch_id × task.req_id 推导（无独立绑定）。
     * viewerId 非空时按项目可见性过滤（与 selectVisibleByWorkspace 同口径）。
     * branchIds 非空时只查这些分支。
     */
    List<com.hourglass.dto.BranchProjectTag> selectProjectTags(
            @Param("workspaceId") String workspaceId, @Param("viewerId") String viewerId,
            @Param("branchIds") List<String> branchIds);

    /** 分支简表（id/name/status），版本统计聚合分支进度用 */
    List<DevBranch> selectBriefsByWorkspace(@Param("workspaceId") String workspaceId);

    DevBranch selectById(@Param("id") String id);

    /**
     * 单条分支的关联工作项计数（口径同列表：viewerId 非空时排除其无权查看项目下的任务）。
     * 返回 DevBranch 仅填 taskCount / doneCount。
     */
    DevBranch selectTaskStats(@Param("workspaceId") String workspaceId, @Param("viewerId") String viewerId,
                              @Param("branchId") String branchId);

    /** 账号删除后清理分支负责人引用 */
    int clearOwnerUser(@Param("userId") String userId);

    /**
     * 同名分支计数（excludeId 非空表示编辑时排除自己）。
     * reqId 维度：同一项目内分支名唯一；reqId 为空时只在空间级公共分支里判重。
     */
    int countByName(@Param("workspaceId") String workspaceId, @Param("name") String name,
                    @Param("reqId") String reqId, @Param("excludeId") String excludeId);

    /** 项目删除时把直接归属它的分支退回空间级公共分支 */
    int clearReqIdByReq(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);

    /* ---------------- Git 只读同步 ---------------- */

    /** 某仓库下已跟踪的全部分支（同步对比远程列表用） */
    List<DevBranch> selectByRepo(@Param("workspaceId") String workspaceId, @Param("repoId") String repoId);

    /** 仓库内按分支名取已跟踪分支（不存在返回 null） */
    DevBranch selectByRepoAndName(@Param("workspaceId") String workspaceId, @Param("repoId") String repoId,
                                  @Param("name") String name);

    /** 同项目内的手工分支（repo_id 为空），用于导入时收养 */
    DevBranch selectManualByName(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                                 @Param("name") String name);

    /** 项目删除前：项目分支 + 空间级手工分支（同名冲突检测） */
    List<DevBranch> selectManualNamespace(@Param("workspaceId") String workspaceId,
                                          @Param("reqId") String reqId);

    /** 待确认队列：筛选口径与看板 chips 一致（不含状态/outcome），按仓库分组由服务层完成 */
    List<DevBranch> selectPending(@Param("q") com.hourglass.dto.BranchQuery q);

    int updateRemoteFacts(@Param("workspaceId") String workspaceId, @Param("id") String id,
                          @Param("remoteState") String remoteState, @Param("headSha") String headSha,
                          @Param("headAt") java.time.LocalDateTime headAt, @Param("headAuthor") String headAuthor,
                          @Param("lastSeenAt") java.time.LocalDateTime lastSeenAt,
                          @Param("lastSeenSha") String lastSeenSha);

    /** 远程列表成功但不含该分支：标记 deleted（绝不物理删除）；last_seen_at 保持最后一次真正看到的时间 */
    int markRemoteDeleted(@Param("workspaceId") String workspaceId, @Param("id") String id);

    int updateMerge(@Param("workspaceId") String workspaceId, @Param("id") String id,
                    @Param("mergedInto") String mergedInto, @Param("mergedAt") java.time.LocalDateTime mergedAt,
                    @Param("evidence") String evidence);

    int updateOutcome(@Param("workspaceId") String workspaceId, @Param("id") String id,
                      @Param("outcome") String outcome, @Param("pendingReason") String pendingReason);

    int applyDecision(@Param("workspaceId") String workspaceId, @Param("id") String id,
                      @Param("decision") String decision, @Param("reason") String reason,
                      @Param("note") String note, @Param("userId") String userId,
                      @Param("decidedAt") java.time.LocalDateTime decidedAt);

    int clearDecision(@Param("workspaceId") String workspaceId, @Param("id") String id);

    int renameById(@Param("workspaceId") String workspaceId, @Param("id") String id,
                   @Param("name") String name);

    /** 新远程分支收养为已跟踪：补 repo/source/远程事实，保留负责人、状态与任务关联 */
    int adoptToRepo(@Param("workspaceId") String workspaceId, @Param("id") String id,
                    @Param("repoId") String repoId, @Param("headSha") String headSha,
                    @Param("headAt") java.time.LocalDateTime headAt, @Param("headAuthor") String headAuthor,
                    @Param("lastSeenAt") java.time.LocalDateTime lastSeenAt,
                    @Param("lastSeenSha") String lastSeenSha);

    /** 新导入远程分支（source=git，outcome=open） */
    int insertGitBranch(DevBranch branch);

    /** 单仓库同步状态回写（失败隔离：只写 sync_*，不改 remote_state/outcome） */
    int updateSyncState(@Param("workspaceId") String workspaceId, @Param("repoId") String repoId,
                        @Param("status") String status, @Param("error") String error);

    /** 项目删除：仓库绑定清除，分支转为人工墓碑 */
    int detachByReq(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);

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
    List<DevBranchLog> selectLogs(@Param("branchId") String branchId,
                                  @Param("offset") int offset, @Param("limit") int limit);

    int countLogs(@Param("branchId") String branchId);

    int deleteLogsByBranch(@Param("branchId") String branchId);

    int deleteLogsByWorkspace(@Param("workspaceId") String workspaceId);
}
