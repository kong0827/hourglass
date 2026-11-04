package com.devstudio.kanban.controller;

import com.devstudio.kanban.common.ApiResult;
import com.devstudio.kanban.common.BoardFilter;
import com.devstudio.kanban.common.CurrentWorkspace;
import com.devstudio.kanban.common.RequireRole;
import com.devstudio.kanban.config.WorkspaceCtx;
import com.devstudio.kanban.dto.BoardQuery;
import com.devstudio.kanban.dto.GanttDepRequest;
import com.devstudio.kanban.dto.GanttLoadResponse;
import com.devstudio.kanban.dto.GanttResponse;
import com.devstudio.kanban.dto.GanttShareResponse;
import com.devstudio.kanban.entity.GanttShare;
import com.devstudio.kanban.entity.TaskDependency;
import com.devstudio.kanban.service.GanttService;
import com.devstudio.kanban.service.WorkspaceService;
import com.devstudio.kanban.service.WorkspaceVersionService;
import org.springframework.format.annotation.DateTimeFormat;
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
import java.time.LocalDate;
import java.util.List;

/**
 * 甘特图 V1.4 接口。
 *
 * 注意：/api/share/gantt 是唯一不需要登录的甘特接口，只读、按 token 取数。
 * 其余全部走登录态，并按工作空间隔离。
 * BE-ARCH-2：空间与筛选参数统一由解析器处理，HTTP 契约不变。
 */
@RestController
public class GanttController {

    private final GanttService ganttService;
    private final WorkspaceVersionService versionService;
    private final WorkspaceService workspaceService;

    public GanttController(GanttService ganttService, WorkspaceVersionService versionService,
                           WorkspaceService workspaceService) {
        this.ganttService = ganttService;
        this.versionService = versionService;
        this.workspaceService = workspaceService;
    }

    /** 任务分页 + 依赖 + 基线（依赖/基线只随第一页返回）；筛选参数与 /api/tasks/list 一致 */
    @GetMapping("/api/gantt")
    public ResponseEntity<ApiResult<GanttResponse>> gantt(@CurrentWorkspace WorkspaceCtx ctx,
                                          @BoardFilter BoardQuery query,
                                          @RequestParam(required = false) Boolean includeDone,
                                          @RequestParam(required = false)
                                          @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
                                          @RequestParam(required = false)
                                          @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
                                          @RequestParam(required = false) Integer offset,
                                          @RequestParam(required = false) Integer limit,
                                          @RequestHeader(value = HttpHeaders.IF_NONE_MATCH, required = false) String inm,
                                          HttpServletRequest request) {
        String wsId = ctx.getWsId();
        String etag = versionService.etag(wsId, request.getQueryString(), versionService.version(wsId));
        if (etag.equals(inm)) {
            return ResponseEntity.status(304).header(HttpHeaders.ETAG, etag).build();
        }
        GanttResponse resp = ganttService.gantt(wsId, ctx.getUserId(), query, from, to,
                includeDone == null || includeDone,
                offset == null ? 0 : offset, limit == null ? 0 : limit);
        /* includeDone 由服务端过滤；前端默认不传（true），切换「显示已完成」时本地过滤即可 */
        return ResponseEntity.ok().header(HttpHeaders.ETAG, etag).body(ApiResult.ok(resp));
    }

    @GetMapping("/api/gantt/deps")
    public ApiResult<List<TaskDependency>> deps(@CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(ganttService.deps(ctx.getWsId(), ctx.getUserId()));
    }

    @PostMapping("/api/gantt/deps")
    public ApiResult<TaskDependency> createDep(@CurrentWorkspace WorkspaceCtx ctx,
                                               @Valid @RequestBody GanttDepRequest req) {
        return ApiResult.ok(ganttService.createDep(ctx.getWsId(), ctx.getUserId(), req));
    }

    @PutMapping("/api/gantt/deps/{id}")
    public ApiResult<TaskDependency> updateDep(@PathVariable String id,
                                               @CurrentWorkspace WorkspaceCtx ctx,
                                               @Valid @RequestBody GanttDepRequest req) {
        return ApiResult.ok(ganttService.updateDep(ctx.getWsId(), ctx.getUserId(), id, req));
    }

    @DeleteMapping("/api/gantt/deps/{id}")
    public ApiResult<Void> deleteDep(@PathVariable String id, @CurrentWorkspace WorkspaceCtx ctx) {
        ganttService.deleteDep(ctx.getWsId(), ctx.getUserId(), id);
        return ApiResult.ok();
    }

    @GetMapping("/api/gantt/baseline")
    public ApiResult<GanttResponse.BaselinePointMapHolder> baseline(@CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(ganttService.baselineInfo(ctx.getWsId(), ctx.getUserId()));
    }

    /** 把当前计划起止拍成基线（覆盖旧基线）：基线是全空间共用口径，仅空间主/管理员可重拍 */
    @PostMapping("/api/gantt/baseline")
    public ApiResult<GanttResponse.BaselinePointMapHolder> captureBaseline(@CurrentWorkspace WorkspaceCtx ctx) {
        workspaceService.requireManager(ctx.getUserId(), ctx.getWsId());
        return ApiResult.ok(ganttService.captureBaseline(ctx.getWsId(), ctx.getUserId()));
    }

    /** 基线是团队共用的对照基准：拍摄成员可做，清除仅空间主 */
    @RequireRole
    @DeleteMapping("/api/gantt/baseline")
    public ApiResult<Void> clearBaseline(@CurrentWorkspace WorkspaceCtx ctx) {
        ganttService.clearBaseline(ctx.getWsId());
        return ApiResult.ok();
    }

    /** 按人 × 周汇总预估/实际工时 */
    @GetMapping("/api/gantt/load")
    public ApiResult<GanttLoadResponse> load(@CurrentWorkspace WorkspaceCtx ctx,
                                             @BoardFilter BoardQuery query,
                                             @RequestParam(required = false)
                                             @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
                                             @RequestParam(required = false)
                                             @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        return ApiResult.ok(ganttService.load(ctx.getWsId(), ctx.getUserId(), query, from, to));
    }

    /* ==================== 只读分享 ==================== */

    /** token 本身就是公开读权限，只给空间主看；成员拿到也能绕过“仅空间主可分享”的约束 */
    @RequireRole
    @GetMapping("/api/gantt/share")
    public ApiResult<GanttShare> shareInfo(@CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(ganttService.shareInfo(ctx.getWsId()));
    }

    /** 生成/重置分享链接（仅空间主） */
    @RequireRole
    @PostMapping("/api/gantt/share")
    public ApiResult<GanttShare> createShare(@CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(ganttService.createShare(ctx.getWsId()));
    }

    @RequireRole
    @DeleteMapping("/api/gantt/share")
    public ApiResult<Void> revokeShare(@CurrentWorkspace WorkspaceCtx ctx) {
        ganttService.revokeShare(ctx.getWsId());
        return ApiResult.ok();
    }

    /** 公开只读：不需要登录 */
    @GetMapping("/api/share/gantt")
    public ApiResult<GanttShareResponse> publicShare(@RequestParam(required = false) String token) {
        return ApiResult.ok(ganttService.publicShare(token));
    }

}
