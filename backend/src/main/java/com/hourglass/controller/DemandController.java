package com.hourglass.controller;

import com.hourglass.common.ApiResult;
import com.hourglass.common.CurrentUser;
import com.hourglass.common.CurrentWorkspace;
import com.hourglass.common.RequireRole;
import com.hourglass.config.WorkspaceCtx;
import com.hourglass.dto.DemandActionRequest;
import com.hourglass.dto.DemandDocLinkRequest;
import com.hourglass.dto.DemandSaveRequest;
import com.hourglass.dto.ReqDocView;
import com.hourglass.entity.Demand;
import com.hourglass.entity.Task;
import com.hourglass.service.DemandService;
import com.hourglass.service.RequirementDocService;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import javax.validation.Valid;
import java.util.List;
import java.util.Map;

/** M2 需求池（T2.1）：提交/编辑所有成员可做；评审流转（pass/rej/plan/reopen）与删除仅空间主 */
@RestController
public class DemandController {

    private final DemandService demandService;
    private final RequirementDocService docService;

    public DemandController(DemandService demandService, RequirementDocService docService) {
        this.demandService = demandService;
        this.docService = docService;
    }

    @GetMapping("/api/demands")
    public ApiResult<List<Demand>> list(@RequestParam(required = false) String reqId, @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(demandService.list(ctx.getWsId(), reqId, ctx.getUserId()));
    }

    @GetMapping("/api/demands/{id}")
    public ApiResult<Demand> get(@PathVariable String id, @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(demandService.getVisible(ctx.getWsId(), ctx.getUserId(), id));
    }

    @GetMapping("/api/demands/{id}/logs")
    public ApiResult<List<Map<String, Object>>> logs(@PathVariable String id, @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(demandService.logs(ctx.getWsId(), ctx.getUserId(), id));
    }

    /** T2.3：需求详情「关联任务」透视 */
    @GetMapping("/api/demands/{id}/tasks")
    public ApiResult<List<Task>> tasks(@PathVariable String id, @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(demandService.tasks(ctx.getWsId(), ctx.getUserId(), id));
    }

    /** 需求详情「关联文档」列表 */
    @GetMapping("/api/demands/{id}/docs")
    public ApiResult<List<ReqDocView>> docs(@PathVariable String id, @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(docService.docsOfDemand(ctx.getWsId(), id, ctx.getUserId()));
    }

    @PostMapping("/api/demands/{id}/docs")
    public ApiResult<Void> linkDoc(@PathVariable String id, @Valid @RequestBody DemandDocLinkRequest req,
                                   @CurrentWorkspace WorkspaceCtx ctx) {
        docService.linkDemand(ctx.getWsId(), id, req.getDocId(), CurrentUser.id());
        return ApiResult.ok(null);
    }

    @DeleteMapping("/api/demands/{id}/docs/{docId}")
    public ApiResult<Void> unlinkDoc(@PathVariable String id, @PathVariable String docId,
                                     @CurrentWorkspace WorkspaceCtx ctx) {
        docService.unlinkDemand(ctx.getWsId(), id, docId, CurrentUser.id());
        return ApiResult.ok(null);
    }

    @PostMapping("/api/demands")
    public ApiResult<Demand> create(@Valid @RequestBody DemandSaveRequest req,
                                    @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(demandService.create(CurrentUser.id(), ctx.getWsId(), req));
    }

    @PutMapping("/api/demands/{id}")
    public ApiResult<Demand> update(@PathVariable String id, @Valid @RequestBody DemandSaveRequest req,
                                    @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(demandService.update(CurrentUser.id(), ctx.getWsId(), id, req));
    }

    @RequireRole
    @PostMapping("/api/demands/{id}/pass")
    public ApiResult<Demand> pass(@PathVariable String id,
                                  @RequestBody(required = false) DemandActionRequest body,
                                  @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(demandService.pass(CurrentUser.id(), ctx.getWsId(), id, body));
    }

    @RequireRole
    @PostMapping("/api/demands/{id}/rej")
    public ApiResult<Demand> reject(@PathVariable String id,
                                    @RequestBody(required = false) DemandActionRequest body,
                                    @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(demandService.reject(CurrentUser.id(), ctx.getWsId(), id, body));
    }

    @RequireRole
    @PostMapping("/api/demands/{id}/plan")
    public ApiResult<Demand> plan(@PathVariable String id,
                                  @RequestBody(required = false) DemandActionRequest body,
                                  @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(demandService.plan(CurrentUser.id(), ctx.getWsId(), id, body));
    }

    @RequireRole
    @PostMapping("/api/demands/{id}/reopen")
    public ApiResult<Demand> reopen(@PathVariable String id,
                                    @RequestBody(required = false) DemandActionRequest body,
                                    @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(demandService.reopen(CurrentUser.id(), ctx.getWsId(), id, body));
    }

    @RequireRole
    @DeleteMapping("/api/demands/{id}")
    public ApiResult<Void> delete(@PathVariable String id, @CurrentWorkspace WorkspaceCtx ctx) {
        demandService.delete(CurrentUser.id(), ctx.getWsId(), id);
        return ApiResult.ok();
    }
}
