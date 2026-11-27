package com.hourglass.mapper;

import com.hourglass.dto.ReqDocView;
import com.hourglass.entity.DemandDocLink;
import com.hourglass.entity.RequirementDoc;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface RequirementDocMapper {

    /** 空间下的需求列表（带项目名、关联任务数、正文片段）；keyword 非空时按标题/正文模糊匹配 */
    List<ReqDocView> selectViewByWorkspace(@Param("workspaceId") String workspaceId,
                                           @Param("reqId") String reqId,
                                           @Param("categoryId") String categoryId,
                                           @Param("spaceOnly") boolean spaceOnly,
                                           @Param("keyword") String keyword,
                                           @Param("viewerId") String viewerId,
                                           @Param("userId") String userId,
                                           @Param("seeAllDrafts") boolean seeAllDrafts,
                                           @Param("offset") int offset, @Param("limit") int limit);

    int countVisible(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                     @Param("categoryId") String categoryId, @Param("spaceOnly") boolean spaceOnly,
                     @Param("keyword") String keyword,
                     @Param("viewerId") String viewerId, @Param("userId") String userId,
                     @Param("seeAllDrafts") boolean seeAllDrafts);

    RequirementDoc selectById(@Param("id") String id);

    /** 读取已删除或正常的文档（回收站恢复 / 彻底删除用），不做 deleted_at 过滤 */
    RequirementDoc selectByIdAny(@Param("id") String id);

    /**
     * 全局搜索：与列表共用 keywordWhere 谓词（≥2 字走全文索引，单字 LIKE 兜底，覆盖标题/摘要/正文）。
     * 草稿可见口径与列表一致：仅作者本人与空间 owner/admin 能命中，
     * seeAllDrafts 为 true 时（特权角色）不做该过滤。
     */
    List<com.hourglass.dto.SearchHit> searchVisible(@Param("workspaceId") String workspaceId,
                                                    @Param("viewerId") String viewerId,
                                                    @Param("userId") String userId,
                                                    @Param("seeAllDrafts") boolean seeAllDrafts,
                                                    @Param("keyword") String keyword,
                                                    @Param("limit") int limit);

    /**
     * 全局搜索（带范围）：在 searchVisible 的可见口径上叠加项目 / 状态 / 负责人 / 更新日期区间。
     * keyword 为空时只按范围返回，日期按 updated_at 的自然日比较。
     */
    List<com.hourglass.dto.SearchHit> searchFiltered(@Param("workspaceId") String workspaceId,
                                                     @Param("viewerId") String viewerId,
                                                     @Param("userId") String userId,
                                                     @Param("seeAllDrafts") boolean seeAllDrafts,
                                                     @Param("keyword") String keyword,
                                                     @Param("reqId") String reqId,
                                                     @Param("status") String status,
                                                     @Param("owner") String owner,
                                                     @Param("from") String from,
                                                     @Param("to") String to,
                                                     @Param("limit") int limit);

    /** 账号删除后清理文档负责人引用 */
    int clearOwnerUser(@Param("userId") String userId);

    int insert(RequirementDoc doc);

    /**
     * 整篇更新；oldUpdatedAt 非空时作为乐观锁条件（WHERE updated_at = ?），
     * 返回 0 表示版本已被他人改变，调用方转 409
     */
    int update(@Param("doc") RequirementDoc doc,
               @Param("oldUpdatedAt") java.time.LocalDateTime oldUpdatedAt);

    /** 发布/收回草稿：只动 published_at，不触碰正文与乐观锁 */
    int updatePublished(@Param("id") String id,
                        @Param("publishedAt") java.time.LocalDateTime publishedAt);

    /** 只改可见范围：不推进 updated_at，避免打开中的编辑器被误判并发冲突 */
    int updateVisibility(@Param("workspaceId") String workspaceId, @Param("id") String id,
                         @Param("visibility") String visibility,
                         @Param("owner") String owner, @Param("ownerUserId") String ownerUserId);

    /** 看板拖拽状态流转：只动 status，不触碰正文与乐观锁 */
    int updateStatus(@Param("workspaceId") String workspaceId,
                     @Param("id") String id,
                     @Param("status") String status);

    /** 行内重命名：只动 title，不触碰正文与乐观锁 */
    int updateTitle(@Param("workspaceId") String workspaceId,
                    @Param("id") String id,
                    @Param("title") String title);

    /** 阅读/树拖拽排序：只动 sort_order / parent_id / category_id，不触碰正文与乐观锁；categorySet=false 时不动分类 */
    int updateSortOrder(@Param("workspaceId") String workspaceId,
                        @Param("id") String id,
                        @Param("sortOrder") Integer sortOrder,
                        @Param("parentId") String parentId,
                        @Param("categoryId") String categoryId,
                        @Param("categorySet") boolean categorySet);

    int delete(@Param("id") String id);

    /** 移入回收站：软删除，保留正文、评论、历史与附件 */
    int softDelete(@Param("workspaceId") String workspaceId, @Param("id") String id,
                   @Param("userId") String userId);

    /** 从回收站恢复 */
    int restoreFromTrash(@Param("workspaceId") String workspaceId, @Param("id") String id);

    /** 回收站列表：seeAll=false 时只看自己删除或自己负责的文档 */
    List<RequirementDoc> selectTrash(@Param("workspaceId") String workspaceId,
                                     @Param("viewerId") String viewerId,
                                     @Param("userId") String userId,
                                     @Param("seeAll") boolean seeAll,
                                     @Param("offset") int offset, @Param("limit") int limit);

    int countTrash(@Param("workspaceId") String workspaceId,
                   @Param("viewerId") String viewerId,
                   @Param("userId") String userId,
                   @Param("seeAll") boolean seeAll);

    /** 定时清理：取超过保留期的回收站文档（只含必要列） */
    List<RequirementDoc> selectExpiredTrash(@Param("cutoff") java.time.LocalDateTime cutoff,
                                            @Param("limit") int limit);

    /** 某项目下的需求数（删除项目前拦一下） */
    int countByReq(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);

    /** 项目列表一次性取各项目的需求数，避免逐项目 COUNT；按查看人可见性过滤 */
    java.util.List<java.util.Map<String, Object>> countGroupByReq(@Param("workspaceId") String workspaceId,
                                                                 @Param("userId") String userId,
                                                                 @Param("seeAllDrafts") boolean seeAllDrafts);

    /** 需求删除时，把关联到它的任务解绑（任务本身保留） */
    int clearTaskRef(@Param("workspaceId") String workspaceId, @Param("reqDocId") String reqDocId);

    /** 需求换项目：只解绑仍挂在其它项目下的任务引用 */
    int clearTaskRefExceptReq(@Param("workspaceId") String workspaceId,
                              @Param("reqDocId") String reqDocId,
                              @Param("reqId") String reqId);

    /** 项目删除时，连带清掉它下面的所有需求（返回被清掉的需求 ID，便于再清任务引用） */
    List<String> selectIdsByReq(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);

    int deleteByReq(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);

    /** 删除空间时清空该空间的全部需求文档（含正文） */
    int deleteAllByWorkspace(@Param("workspaceId") String workspaceId);

    /** 备份导出：读取全部需求（含正文） */
    List<RequirementDoc> selectAllByWorkspace(@Param("workspaceId") String workspaceId);

    /** 需求池需求关联的文档（带项目名、任务数、摘要） */
    List<ReqDocView> selectByDemand(@Param("workspaceId") String workspaceId, @Param("demandId") String demandId,
                                    @Param("viewerId") String viewerId, @Param("userId") String userId,
                                    @Param("seeAllDrafts") boolean seeAllDrafts,
                                    @Param("offset") int offset, @Param("limit") int limit);

    int countByDemand(@Param("workspaceId") String workspaceId, @Param("demandId") String demandId,
                      @Param("viewerId") String viewerId, @Param("userId") String userId,
                      @Param("seeAllDrafts") boolean seeAllDrafts);

    /** 更换需求所属项目前检查：该需求是否已关联文档（不区分草稿可见性） */
    int countLinksByDemand(@Param("workspaceId") String workspaceId, @Param("demandId") String demandId);

    /** 文档关联的需求池需求（id / title / status / priority） */
    List<java.util.Map<String, Object>> selectDemandsByDoc(@Param("workspaceId") String workspaceId,
                                                          @Param("docId") String docId,
                                                          @Param("offset") int offset, @Param("limit") int limit);

    int countDemandsByDoc(@Param("workspaceId") String workspaceId, @Param("docId") String docId);

    int linkDemand(@Param("workspaceId") String workspaceId, @Param("demandId") String demandId,
                   @Param("docId") String docId, @Param("userId") String userId);

    List<DemandDocLink> selectAllDemandLinks(@Param("workspaceId") String workspaceId);

    int unlinkDemand(@Param("workspaceId") String workspaceId, @Param("demandId") String demandId,
                     @Param("docId") String docId);

    int deleteDemandLinksByDoc(@Param("workspaceId") String workspaceId, @Param("docId") String docId);

    int deleteDemandLinksByDemand(@Param("workspaceId") String workspaceId, @Param("demandId") String demandId);

    int deleteDemandLinksByReq(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);

    int deleteDemandLinksByWorkspace(@Param("workspaceId") String workspaceId);

    /** 删除文档时把子文档提升到它的父级 */
    int reparentChildren(@Param("workspaceId") String workspaceId, @Param("id") String id,
                         @Param("parentId") String parentId);

    /** 备份恢复：补齐父文档引用 */
    int updateParent(@Param("workspaceId") String workspaceId, @Param("id") String id,
                     @Param("parentId") String parentId);

    /* ---------------- 文档可见成员 ---------------- */

    List<String> selectVisibilityMemberIds(@Param("docId") String docId);

    int countVisibilityMember(@Param("docId") String docId, @Param("userId") String userId);

    int insertVisibilityMembers(@Param("workspaceId") String workspaceId, @Param("docId") String docId,
                                @Param("userIds") List<String> userIds);

    int deleteVisibilityMembersByDoc(@Param("workspaceId") String workspaceId, @Param("docId") String docId);

    int deleteVisibilityMembersByReq(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);

    int deleteVisibilityMembersByWorkspace(@Param("workspaceId") String workspaceId);

    /** 备份导出：一次取全空间的成员名单（docId / userId） */
    List<java.util.Map<String, Object>> selectVisibilityMembersByWorkspace(@Param("workspaceId") String workspaceId);

    /* ---------------- 文档收藏 ---------------- */

    int insertFavorite(@Param("workspaceId") String workspaceId, @Param("userId") String userId,
                       @Param("docId") String docId);

    int deleteFavorite(@Param("workspaceId") String workspaceId, @Param("userId") String userId,
                       @Param("docId") String docId);

    int countFavorite(@Param("workspaceId") String workspaceId, @Param("userId") String userId,
                      @Param("docId") String docId);

    /** 我的收藏列表：字段与 selectViewByWorkspace 一致，可见口径走 listWhere，按收藏时间倒序 */
    List<ReqDocView> selectFavoriteViews(@Param("workspaceId") String workspaceId,
                                         @Param("reqId") String reqId,
                                         @Param("categoryId") String categoryId,
                                         @Param("spaceOnly") boolean spaceOnly,
                                         @Param("keyword") String keyword,
                                         @Param("viewerId") String viewerId,
                                         @Param("userId") String userId,
                                         @Param("seeAllDrafts") boolean seeAllDrafts,
                                         @Param("offset") int offset, @Param("limit") int limit);

    int countFavoriteVisible(@Param("workspaceId") String workspaceId,
                             @Param("reqId") String reqId,
                             @Param("categoryId") String categoryId,
                             @Param("spaceOnly") boolean spaceOnly,
                             @Param("keyword") String keyword,
                             @Param("viewerId") String viewerId,
                             @Param("userId") String userId,
                             @Param("seeAllDrafts") boolean seeAllDrafts);

    /** 文档删除 / 移入回收站时解除全部收藏引用 */
    int deleteFavoritesByDoc(@Param("workspaceId") String workspaceId, @Param("docId") String docId);

    /** 项目删除时连带清理收藏 */
    int deleteFavoritesByReq(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);

    /** 空间删除时连带清理收藏 */
    int deleteFavoritesByWorkspace(@Param("workspaceId") String workspaceId);
}
