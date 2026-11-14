package com.hourglass.controller;

import com.hourglass.common.ApiResult;
import com.hourglass.common.BoardFilter;
import com.hourglass.common.CurrentUser;
import com.hourglass.common.CurrentWorkspace;
import com.hourglass.common.RequireRole;
import com.hourglass.config.WorkspaceCtx;
import com.hourglass.dto.BoardQuery;
import com.hourglass.dto.BoardResponse;
import com.hourglass.dto.CalendarResponse;
import com.hourglass.dto.PageResult;
import com.hourglass.dto.TaskBulkMoveRequest;
import com.hourglass.dto.TaskListResponse;
import com.hourglass.dto.TaskMoveRequest;
import com.hourglass.dto.TaskReopenRequest;
import com.hourglass.dto.TaskSaveRequest;
import com.hourglass.entity.Task;
import com.hourglass.entity.TaskLog;
import com.hourglass.service.TaskCommandService;
import com.hourglass.service.TaskQueryService;
import com.hourglass.service.TaskTrashService;
import com.hourglass.service.TaskWatchService;
import com.hourglass.service.TaskWorkflowService;
import com.hourglass.service.WorkspaceVersionService;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import javax.servlet.http.HttpServletRequest;
import javax.validation.Valid;
import java.util.List;
import java.util.Map;

/**
 * 任务看板接口。
 * BE-ARCH-2：空间解析与筛选参数改由参数解析器统一处理（@CurrentWorkspace / @BoardFilter），
 * 方法体只保留业务调用；HTTP 契约（路径 / 参数 / 返回）不变。
 */
@RestController
public class TaskController {

    /* BE-ARCH-1：查询 / 新建编辑 / 流程 / 回收站四个服务各管一段，避免再回到一个 1400 行的上帝类 */
    private final TaskQueryService queryService;
    private final TaskCommandService commandService;
    private final TaskWorkflowService workflowService;
    private final TaskTrashService trashService;
    private final WorkspaceVersionService versionService;
    private final TaskWatchService watchService;

    public TaskController(TaskQueryService queryService, TaskCommandService commandService,
                          TaskWorkflowService workflowService, TaskTrashService trashService,
                          WorkspaceVersionService versionService, TaskWatchService watchService) {
        this.queryService = queryService;
        this.commandService = commandService;
        this.workflowService = workflowService;
        this.trashService = trashService;
        this.versionService = versionService;
        this.watchService = watchService;
    }

    /** 看板聚合：列数据 + 列定义 + 提醒计数 + 筛选元数据 */
    @GetMapping("/api/board")
    public ResponseEntity<ApiResult<BoardResponse>> board(@CurrentWorkspace WorkspaceCtx ctx,
                                          @BoardFilter BoardQuery query,
                                          @RequestHeader(value = HttpHeaders.IF_NONE_MATCH, required = false) String inm,
                                          HttpServletRequest request) {
        String wsId = ctx.getWsId();
        String etag = versionService.etag(wsId, ctx.getUserId(), request.getQueryString(), versionService.version(wsId));
        if (etag.equals(inm)) {
            return ResponseEntity.status(304).header(HttpHeaders.ETAG, etag)
                    .header(HttpHeaders.CACHE_CONTROL, "private, no-cache").build();
        }
        return ResponseEntity.ok().header(HttpHeaders.ETAG, etag)
                .header(HttpHeaders.CACHE_CONTROL, "private, no-cache")
                .body(ApiResult.ok(queryService.board(wsId, ctx.getUserId(), query)));
    }

    /** 已完成列分页（「加载更多」） */
    @GetMapping("/api/tasks/done")
    public ApiResult<BoardResponse.ColumnData> done(@CurrentWorkspace WorkspaceCtx ctx,
                                                    @BoardFilter BoardQuery query) {
        return ApiResult.ok(queryService.donePage(ctx.getWsId(), ctx.getUserId(), query));
    }

    /** 未完成列分页（「加载更多」）：col 为看板列 id */
    @GetMapping("/api/tasks/column")
    public ApiResult<BoardResponse.ColumnData> column(@CurrentWorkspace WorkspaceCtx ctx,
                                                      @BoardFilter BoardQuery query,
                                                      @RequestParam String col,
                                                      @RequestParam(required = false) Integer offset,
                                                      @RequestParam(required = false) Integer limit) {
        return ApiResult.ok(queryService.columnPage(ctx.getWsId(), ctx.getUserId(), query, col,
                offset == null ? 0 : offset, limit == null ? 0 : limit));
    }

    /**
     * 列状态工作页：列 tab 计数 + 时间窗 + 服务端聚合指标 + 单页明细（≤100）。
     * range: week(默认) / month / quarter / all；sort: completed / due / priority / updated。
     */
    @GetMapping("/api/tasks/workpage")
    public ApiResult<com.hourglass.dto.TaskWorkpageResponse> workpage(@CurrentWorkspace WorkspaceCtx ctx,
                                                                     @BoardFilter BoardQuery query,
                                                                     @RequestParam String col,
                                                                     @RequestParam(required = false) String range,
                                                                     @RequestParam(required = false) String sort,
                                                                     @RequestParam(required = false) Integer offset,
                                                                     @RequestParam(required = false) Integer limit) {
        return ApiResult.ok(queryService.workpage(ctx.getWsId(), ctx.getUserId(), query, col, range, sort,
                offset == null ? 0 : offset, limit == null ? 0 : limit));
    }

    /** 列表视图：筛选后的分页任务，sort: due/priority/updated/column；open=true 只取未完成（团队成员下钻） */
    @GetMapping("/api/tasks/list")
    public ResponseEntity<ApiResult<TaskListResponse>> list(@CurrentWorkspace WorkspaceCtx ctx,
                                            @BoardFilter BoardQuery query,
                                            @RequestParam(required = false) String sort,
                                            @RequestParam(required = false) Integer offset,
                                            @RequestParam(required = false) Integer limit,
                                            @RequestParam(required = false) Boolean open,
                                            @RequestHeader(value = HttpHeaders.IF_NONE_MATCH, required = false) String inm,
                                            HttpServletRequest request) {
        String wsId = ctx.getWsId();
        String etag = versionService.etag(wsId, ctx.getUserId(), request.getQueryString(), versionService.version(wsId));
        if (etag.equals(inm)) {
            return ResponseEntity.status(304).header(HttpHeaders.ETAG, etag)
                    .header(HttpHeaders.CACHE_CONTROL, "private, no-cache").build();
        }
        return ResponseEntity.ok().header(HttpHeaders.ETAG, etag)
                .header(HttpHeaders.CACHE_CONTROL, "private, no-cache")
                .body(ApiResult.ok(queryService.list(wsId, ctx.getUserId(), query, sort,
                        offset == null ? 0 : offset, limit == null ? 0 : limit, !Boolean.TRUE.equals(open))));
    }

    /**
     * 任务深链读取（O-3）。
     * 路径刻意用单数 /api/task/{id}：与 /api/tasks/list、/api/tasks/done 等字面量路径零歧义。
     * 只在「我参与的空间」内查找；不存在与无权限返回同样的 404（不泄露存在性）；
     * 回收站中的任务照常返回，由前端提示"已被删除，可在回收站查看"。
     */
    @GetMapping("/api/task/{id}")
    public ApiResult<Task> taskById(@PathVariable String id) {
        Task t = queryService.forDeepLink(CurrentUser.id(), id);
        if (t == null) {
            throw com.hourglass.common.AppException.notFound("任务不存在或你没有访问权限：" + id);
        }
        return ApiResult.ok(t);
    }

    /** 回收站 */
    @GetMapping("/api/trash")
    public ApiResult<PageResult<Task>> trash(@CurrentWorkspace WorkspaceCtx ctx,
                                             @RequestParam(required = false) Integer offset,
                                             @RequestParam(required = false) Integer limit) {
        return ApiResult.ok(trashService.trash(ctx.getWsId(), ctx.getUserId(),
                offset == null ? 0 : offset, limit == null ? 100 : limit));
    }

    @PostMapping("/api/tasks/{id}/restore")
    public ApiResult<Void> restore(@PathVariable String id, @CurrentWorkspace WorkspaceCtx ctx) {
        trashService.restore(ctx.getUserId(), ctx.getWsId(), id);
        return ApiResult.ok();
    }

    /** 彻底删除不可恢复：仅空间主可执行（移到回收站仍是成员操作） */
    @RequireRole
    @DeleteMapping("/api/tasks/{id}/purge")
    public ApiResult<Void> purge(@PathVariable String id, @CurrentWorkspace WorkspaceCtx ctx) {
        trashService.purge(ctx.getUserId(), ctx.getWsId(), id);
        return ApiResult.ok();
    }

    @PostMapping("/api/tasks")
    public ApiResult<Task> create(@Valid @RequestBody TaskSaveRequest req,
                                  @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(commandService.create(ctx.getUserId(), ctx.getWsId(), req));
    }

    @PutMapping("/api/tasks/{id}")
    public ApiResult<Task> update(@PathVariable String id, @Valid @RequestBody TaskSaveRequest req,
                                  @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(commandService.update(ctx.getUserId(), ctx.getWsId(), id, req));
    }

    @PostMapping("/api/tasks/{id}/move")
    public ApiResult<Map<String, Object>> move(@PathVariable String id, @Valid @RequestBody TaskMoveRequest req,
                                               @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(workflowService.move(ctx.getUserId(), ctx.getWsId(), id, req));
    }

    /** 认领测试负责人：批量移入「测试中」后仍待领取的工作项 */
    @PostMapping("/api/tasks/{id}/test-claim")
    public ApiResult<Map<String, Object>> claimTest(@PathVariable String id, @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(workflowService.claimTest(ctx.getUserId(), ctx.getWsId(), id));
    }

    /** 列表页批量改列：统一走 move 语义 */
    @PostMapping("/api/tasks/bulk-move")
    public ApiResult<Map<String, Object>> bulkMove(@Valid @RequestBody TaskBulkMoveRequest req,
                                                   @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(workflowService.bulkMove(ctx.getUserId(), ctx.getWsId(), req));
    }

    /** 取消完成：回到完成前所在列 */
    @PostMapping("/api/tasks/{id}/reopen")
    public ApiResult<Map<String, Object>> reopen(@PathVariable String id,
                                                 @RequestBody(required = false) TaskReopenRequest body,
                                                 @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(workflowService.reopen(ctx.getUserId(), ctx.getWsId(), id, body));
    }

    /** 软删除：进回收站（30 天自动清理），撤销走 restore */
    @DeleteMapping("/api/tasks/{id}")
    public ApiResult<Void> delete(@PathVariable String id, @CurrentWorkspace WorkspaceCtx ctx) {
        trashService.delete(ctx.getUserId(), ctx.getWsId(), id);
        return ApiResult.ok();
    }

    /** 任务关注状态（任何能查看该任务的人都可以关注） */
    @GetMapping("/api/tasks/{id}/watch")
    public ApiResult<Map<String, Object>> watchStatus(@CurrentWorkspace WorkspaceCtx ctx,
                                                      @PathVariable String id) {
        return ApiResult.ok(watchService.status(ctx.getUserId(), ctx.getWsId(), id));
    }

    @PostMapping("/api/tasks/{id}/watch")
    public ApiResult<Map<String, Object>> watch(@CurrentWorkspace WorkspaceCtx ctx,
                                                @PathVariable String id) {
        return ApiResult.ok(watchService.watch(ctx.getUserId(), ctx.getWsId(), id));
    }

    @DeleteMapping("/api/tasks/{id}/watch")
    public ApiResult<Map<String, Object>> unwatch(@CurrentWorkspace WorkspaceCtx ctx,
                                                  @PathVariable String id) {
        return ApiResult.ok(watchService.unwatch(ctx.getUserId(), ctx.getWsId(), id));
    }

    /** 任务操作时间线（含操作人） */
    @GetMapping("/api/tasks/{id}/logs")
    public ApiResult<com.hourglass.dto.PageResult<TaskLog>> logs(
            @PathVariable String id, @CurrentWorkspace WorkspaceCtx ctx,
            @RequestParam(required = false) Integer offset,
            @RequestParam(required = false) Integer limit) {
        return ApiResult.ok(queryService.logs(ctx.getWsId(), ctx.getUserId(), id,
                offset == null ? 0 : offset, limit == null ? 100 : limit));
    }

    /** 日历视图：按 [开始日, 实际结束日] 取整月任务（IA-4：接入与看板相同的筛选） */
    @GetMapping("/api/calendar")
    public ApiResult<CalendarResponse> calendar(@CurrentWorkspace WorkspaceCtx ctx,
                                                @BoardFilter BoardQuery query,
                                                @RequestParam(required = false) Integer year,
                                                @RequestParam(required = false) Integer month) {
        return ApiResult.ok(queryService.calendar(ctx.getWsId(), ctx.getUserId(), year, month, query));
    }
}
