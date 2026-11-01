package com.devstudio.kanban.controller;

import com.devstudio.kanban.common.ApiResult;
import com.devstudio.kanban.common.CurrentUser;
import com.devstudio.kanban.dto.BoardQuery;
import com.devstudio.kanban.dto.BoardResponse;
import com.devstudio.kanban.dto.CalendarResponse;
import com.devstudio.kanban.dto.TaskBulkMoveRequest;
import com.devstudio.kanban.dto.TaskListResponse;
import com.devstudio.kanban.dto.TaskMoveRequest;
import com.devstudio.kanban.dto.TaskSaveRequest;
import com.devstudio.kanban.entity.Task;
import com.devstudio.kanban.entity.TaskLog;
import com.devstudio.kanban.entity.Workspace;
import com.devstudio.kanban.service.TaskService;
import com.devstudio.kanban.service.WorkspaceService;
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

@RestController
public class TaskController {

    private final TaskService taskService;
    private final WorkspaceService workspaceService;
    private final WorkspaceVersionService versionService;

    public TaskController(TaskService taskService, WorkspaceService workspaceService,
                          WorkspaceVersionService versionService) {
        this.taskService = taskService;
        this.workspaceService = workspaceService;
        this.versionService = versionService;
    }

    /** 看板聚合：列数据 + 列定义 + 提醒计数 + 筛选元数据 */
    @GetMapping("/api/board")
    public ResponseEntity<ApiResult<BoardResponse>> board(@RequestParam(required = false) String workspace,
                                          @RequestParam(required = false) String q,
                                          @RequestParam(required = false) String owners,
                                          @RequestParam(required = false) String pris,
                                          @RequestParam(required = false) String cats,
                                          @RequestParam(required = false) String reqs,
                                          @RequestParam(required = false) String tags,
                                          @RequestParam(required = false) String due,
                                          @RequestParam(required = false) Boolean focus,
                                          @RequestParam(required = false) Boolean blocked,
                                          @RequestParam(required = false) Boolean noDue,
                                          @RequestParam(required = false) String doneScope,
                                          @RequestParam(required = false) Integer doneLimit,
                                          @RequestHeader(value = HttpHeaders.IF_NONE_MATCH, required = false) String inm,
                                          HttpServletRequest request) {
        Workspace ws = workspaceService.resolve(CurrentUser.id(), workspace);
        String etag = versionService.etag(ws.getId(), request.getQueryString(), versionService.version(ws.getId()));
        if (etag.equals(inm)) {
            return ResponseEntity.status(304).header(HttpHeaders.ETAG, etag).build();
        }
        BoardQuery query = BoardQuery.from(q, owners, pris, cats, reqs, tags, due, focus, blocked, noDue,
                doneScope, doneLimit, null);
        return ResponseEntity.ok().header(HttpHeaders.ETAG, etag)
                .body(ApiResult.ok(taskService.board(ws.getId(), query)));
    }

    /** 已完成列分页（「加载更多」） */
    @GetMapping("/api/tasks/done")
    public ApiResult<BoardResponse.ColumnData> done(@RequestParam(required = false) String workspace,
                                                    @RequestParam(required = false) String q,
                                                    @RequestParam(required = false) String owners,
                                                    @RequestParam(required = false) String pris,
                                                    @RequestParam(required = false) String cats,
                                                    @RequestParam(required = false) String reqs,
                                                    @RequestParam(required = false) String tags,
                                                    @RequestParam(required = false) String due,
                                                    @RequestParam(required = false) Boolean focus,
                                                    @RequestParam(required = false) Boolean blocked,
                                                    @RequestParam(required = false) Boolean noDue,
                                                    @RequestParam(required = false) String doneScope,
                                                    @RequestParam(required = false) Integer doneLimit,
                                                    @RequestParam(required = false) Integer doneOffset) {
        Workspace ws = workspaceService.resolve(CurrentUser.id(), workspace);
        BoardQuery query = BoardQuery.from(q, owners, pris, cats, reqs, tags, due, focus, blocked, noDue,
                doneScope, doneLimit, doneOffset);
        return ApiResult.ok(taskService.donePage(ws.getId(), query));
    }

    /** 列表视图：筛选后的全量任务（上限 500），sort: due/priority/updated/column */
    @GetMapping("/api/tasks/list")
    public ResponseEntity<ApiResult<TaskListResponse>> list(@RequestParam(required = false) String workspace,
                                            @RequestParam(required = false) String q,
                                            @RequestParam(required = false) String owners,
                                            @RequestParam(required = false) String pris,
                                            @RequestParam(required = false) String cats,
                                            @RequestParam(required = false) String reqs,
                                            @RequestParam(required = false) String tags,
                                            @RequestParam(required = false) String due,
                                            @RequestParam(required = false) Boolean focus,
                                            @RequestParam(required = false) Boolean blocked,
                                            @RequestParam(required = false) Boolean noDue,
                                            @RequestParam(required = false) String sort,
                                            @RequestHeader(value = HttpHeaders.IF_NONE_MATCH, required = false) String inm,
                                            HttpServletRequest request) {
        Workspace ws = workspaceService.resolve(CurrentUser.id(), workspace);
        String etag = versionService.etag(ws.getId(), request.getQueryString(), versionService.version(ws.getId()));
        if (etag.equals(inm)) {
            return ResponseEntity.status(304).header(HttpHeaders.ETAG, etag).build();
        }
        BoardQuery query = BoardQuery.from(q, owners, pris, cats, reqs, tags, due, focus, blocked, noDue,
                "all", null, null);
        return ResponseEntity.ok().header(HttpHeaders.ETAG, etag)
                .body(ApiResult.ok(taskService.list(ws.getId(), query, sort)));
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
    public ApiResult<List<Task>> trash(@RequestParam(required = false) String workspace) {
        Workspace ws = workspaceService.resolve(CurrentUser.id(), workspace);
        return ApiResult.ok(taskService.trash(ws.getId()));
    }

    @PostMapping("/api/tasks/{id}/restore")
    public ApiResult<Void> restore(@PathVariable String id, @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        taskService.restore(userId, ws.getId(), id);
        return ApiResult.ok();
    }

    @DeleteMapping("/api/tasks/{id}/purge")
    public ApiResult<Void> purge(@PathVariable String id, @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        /* 彻底删除不可恢复：仅空间主可执行（移到回收站仍是成员操作） */
        workspaceService.requireOwner(userId, ws.getId());
        taskService.purge(ws.getId(), id);
        return ApiResult.ok();
    }

    @PostMapping("/api/tasks")
    public ApiResult<Task> create(@Valid @RequestBody TaskSaveRequest req,
                                  @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(taskService.create(userId, ws.getId(), req));
    }

    @PutMapping("/api/tasks/{id}")
    public ApiResult<Task> update(@PathVariable String id, @Valid @RequestBody TaskSaveRequest req,
                                  @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(taskService.update(userId, ws.getId(), id, req));
    }

    @PostMapping("/api/tasks/{id}/move")
    public ApiResult<Map<String, Object>> move(@PathVariable String id, @Valid @RequestBody TaskMoveRequest req,
                                               @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(taskService.move(userId, ws.getId(), id, req));
    }

    /** 列表页批量改列：统一走 move 语义 */
    @PostMapping("/api/tasks/bulk-move")
    public ApiResult<Map<String, Object>> bulkMove(@Valid @RequestBody TaskBulkMoveRequest req,
                                                   @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(taskService.bulkMove(userId, ws.getId(), req));
    }

    /** 取消完成：回到完成前所在列 */
    @PostMapping("/api/tasks/{id}/reopen")
    public ApiResult<Map<String, Object>> reopen(@PathVariable String id,
                                                 @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(taskService.reopen(userId, ws.getId(), id));
    }

    /** 软删除：进回收站（30 天自动清理），撤销走 restore */
    @DeleteMapping("/api/tasks/{id}")
    public ApiResult<Void> delete(@PathVariable String id, @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        taskService.delete(userId, ws.getId(), id);
        return ApiResult.ok();
    }

    /** 任务操作时间线（含操作人） */
    @GetMapping("/api/tasks/{id}/logs")
    public ApiResult<List<TaskLog>> logs(@PathVariable String id, @RequestParam(required = false) String workspace) {
        Workspace ws = workspaceService.resolve(CurrentUser.id(), workspace);
        return ApiResult.ok(taskService.logs(ws.getId(), id));
    }

    /** 日历视图：按 [开始日, 实际结束日] 取整月任务（IA-4：接入与看板相同的筛选） */
    @GetMapping("/api/calendar")
    public ApiResult<CalendarResponse> calendar(@RequestParam(required = false) String workspace,
                                                @RequestParam(required = false) Integer year,
                                                @RequestParam(required = false) Integer month,
                                                @RequestParam(required = false) String q,
                                                @RequestParam(required = false) String owners,
                                                @RequestParam(required = false) String pris,
                                                @RequestParam(required = false) String cats,
                                                @RequestParam(required = false) String reqs,
                                                @RequestParam(required = false) String tags,
                                                @RequestParam(required = false) String due,
                                                @RequestParam(required = false) Boolean focus,
                                                @RequestParam(required = false) Boolean blocked) {
        Workspace ws = workspaceService.resolve(CurrentUser.id(), workspace);
        BoardQuery query = BoardQuery.from(q, owners, pris, cats, reqs, tags, due, focus, blocked, null,
                null, null, null);
        return ApiResult.ok(taskService.calendar(ws.getId(), year, month, query));
    }
}
