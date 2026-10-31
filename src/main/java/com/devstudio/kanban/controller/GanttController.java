package com.devstudio.kanban.controller;

import com.devstudio.kanban.common.ApiResult;
import com.devstudio.kanban.common.CurrentUser;
import com.devstudio.kanban.dto.BoardQuery;
import com.devstudio.kanban.dto.GanttDepRequest;
import com.devstudio.kanban.dto.GanttLoadResponse;
import com.devstudio.kanban.dto.GanttResponse;
import com.devstudio.kanban.dto.GanttShareResponse;
import com.devstudio.kanban.entity.GanttShare;
import com.devstudio.kanban.entity.TaskDependency;
import com.devstudio.kanban.entity.Workspace;
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
 */
@RestController
public class GanttController {

    private final GanttService ganttService;
    private final WorkspaceService workspaceService;
    private final WorkspaceVersionService versionService;

    public GanttController(GanttService ganttService, WorkspaceService workspaceService,
                       WorkspaceVersionService versionService) {
        this.ganttService = ganttService;
        this.workspaceService = workspaceService;
        this.versionService = versionService;
    }

    /** 任务分页 + 依赖 + 基线（依赖/基线只随第一页返回）；筛选参数与 /api/tasks/list 一致 */
    @GetMapping("/api/gantt")
    public ResponseEntity<ApiResult<GanttResponse>> gantt(@RequestParam(required = false) String workspace,
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
                                          @RequestParam(required = false) Boolean includeDone,
                                          @RequestParam(required = false)
                                          @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
                                          @RequestParam(required = false)
                                          @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
                                          @RequestParam(required = false) Integer offset,
                                          @RequestParam(required = false) Integer limit,
                                          @RequestHeader(value = HttpHeaders.IF_NONE_MATCH, required = false) String inm,
                                          HttpServletRequest request) {
        Workspace ws = workspaceService.resolve(CurrentUser.id(), workspace);
        String etag = versionService.etag(ws.getId(), request.getQueryString(), versionService.version(ws.getId()));
        if (etag.equals(inm)) {
            return ResponseEntity.status(304).header(HttpHeaders.ETAG, etag).build();
        }
        BoardQuery query = BoardQuery.from(q, owners, pris, cats, reqs, tags, due, focus, blocked, noDue,
                "all", null, null);
        GanttResponse resp = ganttService.gantt(ws.getId(), query, from, to,
                includeDone == null || includeDone,
                offset == null ? 0 : offset, limit == null ? 0 : limit);
        /* includeDone 由服务端过滤；前端默认不传（true），切换「显示已完成」时本地过滤即可 */
        return ResponseEntity.ok().header(HttpHeaders.ETAG, etag).body(ApiResult.ok(resp));
    }

    @GetMapping("/api/gantt/deps")
    public ApiResult<List<TaskDependency>> deps(@RequestParam(required = false) String workspace) {
        Workspace ws = workspaceService.resolve(CurrentUser.id(), workspace);
        return ApiResult.ok(ganttService.deps(ws.getId()));
    }

    @PostMapping("/api/gantt/deps")
    public ApiResult<TaskDependency> createDep(@RequestParam(required = false) String workspace,
                                               @Valid @RequestBody GanttDepRequest req) {
        Workspace ws = workspaceService.resolve(CurrentUser.id(), workspace);
        return ApiResult.ok(ganttService.createDep(ws.getId(), req));
    }

    @PutMapping("/api/gantt/deps/{id}")
    public ApiResult<TaskDependency> updateDep(@PathVariable String id,
                                               @RequestParam(required = false) String workspace,
                                               @Valid @RequestBody GanttDepRequest req) {
        Workspace ws = workspaceService.resolve(CurrentUser.id(), workspace);
        return ApiResult.ok(ganttService.updateDep(ws.getId(), id, req));
    }

    @DeleteMapping("/api/gantt/deps/{id}")
    public ApiResult<Void> deleteDep(@PathVariable String id,
                                     @RequestParam(required = false) String workspace) {
        Workspace ws = workspaceService.resolve(CurrentUser.id(), workspace);
        ganttService.deleteDep(ws.getId(), id);
        return ApiResult.ok();
    }

    @GetMapping("/api/gantt/baseline")
    public ApiResult<GanttResponse.BaselinePointMapHolder> baseline(@RequestParam(required = false) String workspace) {
        Workspace ws = workspaceService.resolve(CurrentUser.id(), workspace);
        return ApiResult.ok(ganttService.baselineInfo(ws.getId()));
    }

    /** 把当前计划起止拍成基线（覆盖旧基线） */
    @PostMapping("/api/gantt/baseline")
    public ApiResult<GanttResponse.BaselinePointMapHolder> captureBaseline(@RequestParam(required = false) String workspace) {
        Workspace ws = workspaceService.resolve(CurrentUser.id(), workspace);
        return ApiResult.ok(ganttService.captureBaseline(ws.getId()));
    }

    @DeleteMapping("/api/gantt/baseline")
    public ApiResult<Void> clearBaseline(@RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        /* 基线是团队共用的对照基准：拍摄成员可做，清除仅空间主 */
        workspaceService.requireOwner(userId, ws.getId());
        ganttService.clearBaseline(ws.getId());
        return ApiResult.ok();
    }

    /** 按人 × 周汇总预估/实际工时 */
    @GetMapping("/api/gantt/load")
    public ApiResult<GanttLoadResponse> load(@RequestParam(required = false) String workspace,
                                             @RequestParam(required = false) String q,
                                             @RequestParam(required = false) String owners,
                                             @RequestParam(required = false) String pris,
                                             @RequestParam(required = false) String cats,
                                             @RequestParam(required = false) String reqs,
                                             @RequestParam(required = false) String tags,
                                             @RequestParam(required = false) String due,
                                             @RequestParam(required = false) Boolean focus,
                                             @RequestParam(required = false) Boolean blocked,
                                             @RequestParam(required = false)
                                             @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
                                             @RequestParam(required = false)
                                             @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        Workspace ws = workspaceService.resolve(CurrentUser.id(), workspace);
        BoardQuery query = BoardQuery.from(q, owners, pris, cats, reqs, tags, due, focus, blocked, null,
                "all", null, null);
        return ApiResult.ok(ganttService.load(ws.getId(), query, from, to));
    }

    /* ==================== 只读分享 ==================== */

    @GetMapping("/api/gantt/share")
    public ApiResult<GanttShare> shareInfo(@RequestParam(required = false) String workspace) {
        Workspace ws = workspaceService.resolve(CurrentUser.id(), workspace);
        /* token 本身就是公开读权限，只给空间主看；成员拿到也能绕过“仅空间主可分享”的约束 */
        workspaceService.requireOwner(CurrentUser.id(), ws.getId());
        return ApiResult.ok(ganttService.shareInfo(ws.getId()));
    }

    /** 生成/重置分享链接（仅空间主） */
    @PostMapping("/api/gantt/share")
    public ApiResult<GanttShare> createShare(@RequestParam(required = false) String workspace) {
        Workspace ws = workspaceService.resolve(CurrentUser.id(), workspace);
        workspaceService.requireOwner(CurrentUser.id(), ws.getId());
        return ApiResult.ok(ganttService.createShare(ws.getId()));
    }

    @DeleteMapping("/api/gantt/share")
    public ApiResult<Void> revokeShare(@RequestParam(required = false) String workspace) {
        Workspace ws = workspaceService.resolve(CurrentUser.id(), workspace);
        workspaceService.requireOwner(CurrentUser.id(), ws.getId());
        ganttService.revokeShare(ws.getId());
        return ApiResult.ok();
    }

    /** 公开只读：不需要登录 */
    @GetMapping("/api/share/gantt")
    public ApiResult<GanttShareResponse> publicShare(@RequestParam(required = false) String token) {
        return ApiResult.ok(ganttService.publicShare(token));
    }

}
