package com.devstudio.kanban.mapper;

import com.devstudio.kanban.dto.GanttQuery;
import com.devstudio.kanban.entity.Task;
import com.devstudio.kanban.entity.TaskFacetRow;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

@Mapper
public interface TaskMapper {

    List<Task> selectAll(@Param("workspaceId") String workspaceId);

    /** 只取某一列的任务（拖拽排序用，避免整空间 selectAll） */
    List<Task> selectColumnTasks(@Param("workspaceId") String workspaceId,
                                 @Param("column") String column);

    /* ---- 看板 / 列表 / 日历：筛选与分页下推（BE-Q-1） ---- */

    /** 看板未完成列（board_column <> done），走 idx_board */
    List<Task> selectOpenTasks(@Param("workspaceId") String workspaceId);

    /** 已完成列：全部条数（不受 doneScope / 筛选影响） */
    int countDoneAll(@Param("workspaceId") String workspaceId);

    /** 已完成列：当前 doneScope（仅本周 / 全部）内的条数 */
    int countDoneInScope(@Param("workspaceId") String workspaceId,
                         @Param("weekStart") LocalDate weekStart, @Param("weekEnd") LocalDate weekEnd);

    /** 已完成列：doneScope + 看板筛选后的条数（ganttWhere 与 TaskService.match 同口径） */
    int countDoneMatched(@Param("workspaceId") String workspaceId, @Param("query") GanttQuery query,
                         @Param("scopeAll") boolean scopeAll,
                         @Param("weekStart") LocalDate weekStart, @Param("weekEnd") LocalDate weekEnd);

    /** 已完成列分页：ORDER BY sort_order, id + LIMIT/OFFSET */
    List<Task> selectDonePage(@Param("workspaceId") String workspaceId, @Param("query") GanttQuery query,
                              @Param("scopeAll") boolean scopeAll,
                              @Param("weekStart") LocalDate weekStart, @Param("weekEnd") LocalDate weekEnd,
                              @Param("offset") int offset, @Param("limit") int limit);

    /** 列表视图筛选后的总数（可能大于 500） */
    int countTaskList(@Param("workspaceId") String workspaceId, @Param("query") GanttQuery query);

    /** 列表视图分页：筛选 + 排序 + LIMIT 都在 SQL 完成 */
    List<Task> selectTaskList(@Param("workspaceId") String workspaceId, @Param("query") GanttQuery query,
                              @Param("columnIds") List<String> columnIds, @Param("sort") String sort,
                              @Param("limit") int limit);

    /** 日历：与月份区间有交集的候选任务（due_date 收敛区间，精确判定仍在 Java） */
    List<Task> selectCalendar(@Param("workspaceId") String workspaceId,
                              @Param("first") LocalDate first, @Param("last") LocalDate last);

    /** 看板 meta 与到期计数用的窄列投影（顺序与 selectAll 一致） */
    List<TaskFacetRow> selectBoardFacets(@Param("workspaceId") String workspaceId);

    /* ---- 甘特图：SQL 区间过滤 + 稳定排序 + 分页 ---- */

    List<Task> selectGantt(@Param("workspaceId") String workspaceId, @Param("query") GanttQuery query,
                           @Param("offset") int offset, @Param("limit") int limit);

    int countGantt(@Param("workspaceId") String workspaceId, @Param("query") GanttQuery query);

    List<Task> selectGanttUnscheduled(@Param("workspaceId") String workspaceId,
                                      @Param("query") GanttQuery query, @Param("limit") int limit);

    int countGanttUnscheduled(@Param("workspaceId") String workspaceId, @Param("query") GanttQuery query);

    /** 本页任务的评论数（甘特图分页后按 id 批量查，避免全空间扫描） */
    List<com.devstudio.kanban.entity.TaskCountAgg> countCommentsByTaskIds(
            @Param("workspaceId") String workspaceId, @Param("taskIds") List<String> taskIds);

    List<Task> selectDeleted(@Param("workspaceId") String workspaceId);

    Task selectById(String id);

    int insert(Task task);

    /** 备份导入：按批多值写入（含回收站的 deleted_at） */
    int insertBatch(@Param("list") List<Task> list);

    /** 备份导入前预判 ID：本空间数据已清空，只有其它空间的同 ID 才需要重映射 */
    List<String> selectIdsInOtherWorkspaces(@Param("workspaceId") String workspaceId,
                                            @Param("ids") List<String> ids);

    int update(Task task);

    int deleteById(String id);

    /** 回收站批量彻底删除 */
    int deleteByIds(@Param("ids") List<String> ids);

    int deleteAllByWorkspace(@Param("workspaceId") String workspaceId);

    int softDelete(String id);

    int restore(String id);

    List<Task> selectPurgeable(@Param("cutoff") LocalDateTime cutoff);

    /** 全库到期未提醒的任务（跨空间一次取回，调用方按 workspace_id 分组） */
    List<Task> selectRemindDueAll(@Param("now") LocalDateTime now,
                                  @Param("windowStart") LocalDateTime windowStart);

    /** 提醒时间已错过重试窗口的任务（标记为已处理，避免永久静默挂起） */
    List<Task> selectRemindExpiredAll(@Param("before") LocalDateTime before);

    int markRemindSent(String id);

    /** 只更新循环派生关联（仅当尚无关联时生效）：并发完成时后到的更新影响 0 行，调用方据此回删刚插入的任务 */
    int setRecurNext(@Param("id") String id, @Param("recurNextId") String recurNextId);

    /** 清除所有指向这些任务的循环派生关联（彻底删除时调用，防止 ID 复用后误认） */
    int clearRecurNextByTaskIds(@Param("taskIds") List<String> taskIds);

    int updateSortOrder(@Param("id") String id, @Param("sortOrder") int sortOrder);

    Integer maxSortOrder(@Param("workspaceId") String workspaceId, @Param("boardColumn") String boardColumn);

    int clearReq(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);

    /** 分支被删除时，把挂在它上面的任务解绑（任务本身保留） */
    int clearBranchRef(@Param("workspaceId") String workspaceId, @Param("branchId") String branchId);

    /** 分支详情：挂在某条分支上的未删除任务（未完成的排前面） */
    List<com.devstudio.kanban.entity.Task> selectByBranch(@Param("workspaceId") String workspaceId,
                                                          @Param("branchId") String branchId);

    int countByWorkspace(@Param("workspaceId") String workspaceId);

    /** 该空间内仍引用指定任务ID的子记录数（附件/日志/子任务/工时/标签）：导入保留子记录后 ID 视作占用 */
    int countChildRefs(@Param("workspaceId") String workspaceId, @Param("taskId") String taskId);

    /** 用户改名后同步任务负责人（限其参与的空间；回收站任务一并更新） */
    int renameOwner(@Param("userId") String userId, @Param("oldName") String oldName, @Param("newName") String newName);

    /* ==================== 2026-10-16 评估报告改造新增 ==================== */

    /** 任务深链（O-3）：只在「我参与的空间」内查找，避免越权与存在性泄露 */
    Task selectByIdInMyWorkspaces(@Param("id") String id, @Param("userId") String userId);

    /**
     * 跨空间「我的任务」（N-3）：按账号ID匹配，历史数据（owner_user_id 为空）回落显示名文本，
     * 因此不做数据回填也能立即生效。
     */
    List<Task> selectMyTasks(@Param("userId") String userId,
                             @Param("displayName") String displayName,
                             @Param("openOnly") boolean openOnly,
                             @Param("q") String q,
                             @Param("pris") java.util.List<String> pris,
                             @Param("cats") java.util.List<String> cats,
                             @Param("reqs") java.util.List<String> reqs,
                             @Param("tags") java.util.List<String> tags,
                             @Param("blocked") boolean blocked);

    /** 每任务评论数（看板角标） */
    List<com.devstudio.kanban.entity.TaskCountAgg> countCommentsByTask(@Param("workspaceId") String workspaceId);

    /** 可选回填脚本（sql/04）用：取出仍未绑定账号的负责人文本 */
    List<String> selectDistinctOwnerTexts();

    /** 可选回填脚本（sql/04）用：按显示名把某账号在本空间内的任务补上 owner_user_id（仅填空值） */
    int backfillOwnerUserId(@Param("userId") String userId, @Param("displayName") String displayName);

    /* ==================== 统计类服务 SQL 聚合（BE-Q-3） ==================== */

    /** 近 N 周新增 / 完成：一次扫描按周聚合（UNION ALL + GROUP BY） */
    List<com.devstudio.kanban.dto.WeekCountRow> countCreatedCompletedByWeek(
            @Param("workspaceId") String workspaceId,
            @Param("from") LocalDate from, @Param("before") LocalDate before);

    /** 区间内完成项按分类分布（顺序与旧 selectAll 首次出现一致） */
    List<com.devstudio.kanban.dto.NameCountRow> countCompletedByCategory(
            @Param("workspaceId") String workspaceId,
            @Param("from") LocalDate from, @Param("before") LocalDate before);

    /** 区间内完成项按负责人文本分布 */
    List<com.devstudio.kanban.dto.NameCountRow> countCompletedByOwner(
            @Param("workspaceId") String workspaceId,
            @Param("from") LocalDate from, @Param("before") LocalDate before);

    /** 当前各列计数与逾期（含自定义列） */
    com.devstudio.kanban.dto.TaskBucketRow countBuckets(@Param("workspaceId") String workspaceId,
                                                        @Param("today") LocalDate today);

    /** 最近一个完成日（周回顾 autoOffset 用；没有完成记录时为 null） */
    LocalDate selectLatestCompletedAt(@Param("workspaceId") String workspaceId);

    /** 指定周内的已完成任务（按完成时间倒序） */
    List<Task> selectCompletedBetween(@Param("workspaceId") String workspaceId,
                                      @Param("from") LocalDate from, @Param("before") LocalDate before);

    /** 进度 100% 但不在已完成列的任务 */
    List<Task> selectPendingDone(@Param("workspaceId") String workspaceId);

    /**
     * 周回顾「进行中」：非待处理 / 非已完成且进度 &lt; 100。
     * history=true 时再收敛到「该周有日志活动」且「周结束前已创建」。
     */
    List<Task> selectProgressTasks(@Param("workspaceId") String workspaceId,
                                   @Param("from") LocalDate from, @Param("before") LocalDate before,
                                   @Param("history") boolean history);

    /** 周回顾：未完成任务计数与到期分布 */
    com.devstudio.kanban.dto.ReviewCountRow countReviewStatus(@Param("workspaceId") String workspaceId,
                                                              @Param("today") LocalDate today);

    /** 未删除任务总数（估时统计的分母） */
    int countLive(@Param("workspaceId") String workspaceId);

    /** 估时统计：只取填了预估的任务及其累计工时 */
    List<Task> selectEstimateTasks(@Param("workspaceId") String workspaceId);

    /** AI 拆分 few-shot：同项目若干条已有标题（保持旧 selectAll 顺序） */
    List<String> selectTitlesByReq(@Param("workspaceId") String workspaceId,
                                   @Param("reqId") String reqId, @Param("limit") int limit);

    /** AI 体检：某需求下的任务（只取展示 / 判定所需列） */
    List<Task> selectByReqDoc(@Param("workspaceId") String workspaceId,
                              @Param("reqDocId") String reqDocId);

    /** AI 落库去重：空间内已有任务标题 */
    List<String> selectTitles(@Param("workspaceId") String workspaceId);

    /** 项目进度：一次 GROUP BY 汇总各项目的任务数 / 完成数 / 进度和 */
    List<com.devstudio.kanban.dto.ReqTaskAggRow> countByReq(@Param("workspaceId") String workspaceId);
}
