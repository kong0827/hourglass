package com.devstudio.kanban.controller;

import com.devstudio.kanban.common.ApiResult;
import com.devstudio.kanban.common.BoardFilter;
import com.devstudio.kanban.common.CurrentUser;
import com.devstudio.kanban.common.CurrentWorkspace;
import com.devstudio.kanban.common.RequireRole;
import com.devstudio.kanban.config.WorkspaceCtx;
import com.devstudio.kanban.dto.BoardQuery;
import com.devstudio.kanban.dto.BoardResponse;
import com.devstudio.kanban.dto.CalendarResponse;
import com.devstudio.kanban.dto.TaskBulkMoveRequest;
import com.devstudio.kanban.dto.TaskListResponse;
import com.devstudio.kanban.dto.TaskMoveRequest;
import com.devstudio.kanban.dto.TaskSaveRequest;
import com.devstudio.kanban.entity.Task;
import com.devstudio.kanban.entity.TaskLog;
import com.devstudio.kanban.service.TaskService;
import com.devstudio.kanban.service.WorkspaceVersionService;
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

    private final TaskService taskService;
    private final WorkspaceVersionService versionService;

    public TaskController(TaskService taskService, WorkspaceVersionService versionService) {
        this.taskService = taskService;
        this.versionService = versionService;
    }

    /** 看板聚合：列数据 + 列定义 + 提醒计数 + 筛选元数据 */
    @GetMapping("/api/board")
    public ResponseEntity<ApiResult<BoardResponse>> board(@CurrentWorkspace WorkspaceCtx ctx,
                                          @BoardFilter BoardQuery query,
                                          @RequestHeader(value = HttpHeaders.IF_NONE_MATCH, required = false) String inm,
                                          HttpServletRequest request) {
        String wsId = ctx.getWsId();
        String etag = versionService.etag(wsId, request.getQueryString(), versionService.version(wsId));
        if (etag.equals(inm)) {
            return ResponseEntity.status(304).header(HttpHeaders.ETAG, etag).build();
        }
        return ResponseEntity.ok().header(HttpHeaders.ETAG, etag)
                .body(ApiResult.ok(taskService.board(wsId, query)));
    }

    /** 已完成列分页（「加载更多」） */
    @GetMapping("/api/tasks/done")
    public ApiResult<BoardResponse.ColumnData> done(@CurrentWorkspace WorkspaceCtx ctx,
                                                    @BoardFilter BoardQuery query) {
        return ApiResult.ok(taskService.donePage(ctx.getWsId(), query));
    }

    /** 列表视图：筛选后的全量任务（上限 500），sort: due/priority/updated/column */
    @GetMapping("/api/tasks/list")
    public ResponseEntity<ApiResult<TaskListResponse>> list(@CurrentWorkspace WorkspaceCtx ctx,
                                            @BoardFilter BoardQuery query,
                                            @RequestParam(required = false) String sort,
                                            @RequestHeader(value = HttpHeaders.IF_NONE_MATCH, required = false) String inm,
                                            HttpServletRequest request) {
        String wsId = ctx.getWsId();
        String etag = versionService.etag(wsId, request.getQueryString(), versionService.version(wsId));
        if (etag.equals(inm)) {
            return ResponseEntity.status(304).header(HttpHeaders.ETAG, etag).build();
        }
        return ResponseEntity.ok().header(HttpHeaders.ETAG, etag)
                .body(ApiResult.ok(taskService.list(wsId, query, sort)));
    }

    /**
     * 任务深链读取（O-3）。
     * 路径刻意用单数 /api/task/{id}：与 /api/tasks/list、/api/tasks/done 等字面量路径零歧义。
     * 只在「我参与的空间」内查找；不存在与无权限返回同样的 404（不泄露存在性）；
     * 回收站中的任务照常返回，由前端提示"已被删除，可在回收站查看"。
     */
    @GetMapping("/api/task/{id}")
    public ApiResult<Task> taskById(@PathVariable String id) {
        Task t = taskService.forDeepLink(CurrentUser.id(), id);
        if (t == null) {
            throw com.devstudio.kanban.common.AppException.notFound("任务不存在或你没有访问权限：" + id);
        }
        return ApiResult.ok(t);
    }

    /** 回收站 */
    @GetMapping("/api/trash")
    public ApiResult<List<Task>> trash(@CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(taskService.trash(ctx.getWsId()));
    }

    @PostMapping("/api/tasks/{id}/restore")
    public ApiResult<Void> restore(@PathVariable String id, @CurrentWorkspace WorkspaceCtx ctx) {
        taskService.restore(ctx.getUserId(), ctx.getWsId(), id);
        return ApiResult.ok();
    }

    /** 彻底删除不可恢复：仅空间主可执行（移到回收站仍是成员操作） */
    @RequireRole
    @DeleteMapping("/api/tasks/{id}/purge")
    public ApiResult<Void> purge(@PathVariable String id, @CurrentWorkspace WorkspaceCtx ctx) {
        taskService.purge(ctx.getWsId(), id);
        return ApiResult.ok();
    }

    @PostMapping("/api/tasks")
    public ApiResult<Task> create(@Valid @RequestBody TaskSaveRequest req,
                                  @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(taskService.create(ctx.getUserId(), ctx.getWsId(), req));
    }

    @PutMapping("/api/tasks/{id}")
    public ApiResult<Task> update(@PathVariable String id, @Valid @RequestBody TaskSaveRequest req,
                                  @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(taskService.update(ctx.getUserId(), ctx.getWsId(), id, req));
    }

    @PostMapping("/api/tasks/{id}/move")
    public ApiResult<Map<String, Object>> move(@PathVariable String id, @Valid @RequestBody TaskMoveRequest req,
                                               @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(taskService.move(ctx.getUserId(), ctx.getWsId(), id, req));
    }

    /** 列表页批量改列：统一走 move 语义 */
    @PostMapping("/api/tasks/bulk-move")
    public ApiResult<Map<String, Object>> bulkMove(@Valid @RequestBody TaskBulkMoveRequest req,
                                                   @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(taskService.bulkMove(ctx.getUserId(), ctx.getWsId(), req));
    }

    /** 取消完成：回到完成前所在列 */
    @PostMapping("/api/tasks/{id}/reopen")
    public ApiResult<Map<String, Object>> reopen(@PathVariable String id,
                                                 @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(taskService.reopen(ctx.getUserId(), ctx.getWsId(), id));
    }

    /** 软删除：进回收站（30 天自动清理），撤销走 restore */
    @DeleteMapping("/api/tasks/{id}")
    public ApiResult<Void> delete(@PathVariable String id, @CurrentWorkspace WorkspaceCtx ctx) {
        taskService.delete(ctx.getUserId(), ctx.getWsId(), id);
        return ApiResult.ok();
    }

    /** 任务操作时间线（含操作人） */
    @GetMapping("/api/tasks/{id}/logs")
    public ApiResult<List<TaskLog>> logs(@PathVariable String id, @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(taskService.logs(ctx.getWsId(), id));
    }

    /** 日历视图：按 [开始日, 实际结束日] 取整月任务（IA-4：接入与看板相同的筛选） */
    @GetMapping("/api/calendar")
    public ApiResult<CalendarResponse> calendar(@CurrentWorkspace WorkspaceCtx ctx,
                                                @BoardFilter BoardQuery query,
                                                @RequestParam(required = false) Integer year,
                                                @RequestParam(required = false) Integer month) {
        return ApiResult.ok(taskService.calendar(ctx.getWsId(), year, month, query));
    }
}
