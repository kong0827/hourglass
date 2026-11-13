package com.hourglass.controller;

import com.hourglass.common.ApiResult;
import com.hourglass.common.CurrentUser;
import com.hourglass.common.CurrentWorkspace;
import com.hourglass.common.RequireRole;
import com.hourglass.config.WorkspaceCtx;
import com.hourglass.dto.DemandActionRequest;
import com.hourglass.dto.DemandBoardResponse;
import com.hourglass.dto.DemandDocLinkRequest;
import com.hourglass.dto.DemandGanttPage;
import com.hourglass.dto.DemandPage;
import com.hourglass.dto.DemandQuery;
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

/** 需求池：评审流转（通过/拒绝/撤回/重开）空间主与管理员均可，删除仅空间主；计划动作由服务端管理权限校验，空间成员校验不变。 */
@RestController
public class DemandController {

    private final DemandService demandService;
    private final RequirementDocService docService;

    public DemandController(DemandService demandService, RequirementDocService docService) {
        this.demandService = demandService;
        this.docService = docService;
    }

    /** 需求池看板首屏：每个状态一列，只下发前 limit 条；搜索/优先级/类型/模块与列表同一口径 */
    @GetMapping("/api/demands/board")
    public ApiResult<DemandBoardResponse> board(@RequestParam(required = false) String reqId,
                                                @RequestParam(required = false) String q,
                                                @RequestParam(required = false) String pris,
                                                @RequestParam(required = false) String kinds,
                                                @RequestParam(required = false) String cats,
                                                @RequestParam(required = false) String deliveryStage,
                                                @RequestParam(required = false) Integer limit,
                                                @CurrentWorkspace WorkspaceCtx ctx) {
        DemandQuery query = query(reqId, null, q, pris, kinds, cats, null, null, 0, limit);
        query.setDeliveryStage(deliveryStage);
        return ApiResult.ok(demandService.board(ctx.getWsId(), ctx.getUserId(), query));
    }

    /** 需求池分页：看板单列滚动加载 + 列表模式的筛选/排序/分页 */
    @GetMapping({"/api/demands", "/api/demands/page"})
    public ApiResult<DemandPage> page(@RequestParam(required = false) String reqId,
                                      @RequestParam(required = false) String status,
                                      @RequestParam(required = false) String q,
                                      @RequestParam(required = false) String pris,
                                      @RequestParam(required = false) String kinds,
                                      @RequestParam(required = false) String cats,
                                      @RequestParam(required = false) String reqs,
                                      @RequestParam(required = false) String sort,
                                      @RequestParam(required = false) String deliveryStage,
                                      @RequestParam(required = false) String versionId,
                                      @RequestParam(required = false) String closeReason,
                                      @RequestParam(required = false) String closeStage,
                                      @RequestParam(required = false) String focus,
                                      @RequestParam(required = false) Integer offset,
                                      @RequestParam(required = false) Integer limit,
                                      @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(demandService.page(ctx.getWsId(), ctx.getUserId(),
                extended(query(reqId, status, q, pris, kinds, cats, reqs, sort, offset, limit),
                        deliveryStage, versionId, closeReason, closeStage, focus)));
    }

    /** 需求池甘特：分页口径同列表，额外下发每条需求的阶段时间轴 */
    @GetMapping("/api/demands/gantt")
    public ApiResult<DemandGanttPage> gantt(@RequestParam(required = false) String reqId,
                                            @RequestParam(required = false) String status,
                                            @RequestParam(required = false) String q,
                                            @RequestParam(required = false) String pris,
                                            @RequestParam(required = false) String kinds,
                                            @RequestParam(required = false) String cats,
                                            @RequestParam(required = false) String reqs,
                                            @RequestParam(required = false) String sort,
                                            @RequestParam(required = false) String deliveryStage,
                                            @RequestParam(required = false) String versionId,
                                            @RequestParam(required = false) String closeReason,
                                            @RequestParam(required = false) String closeStage,
                                            @RequestParam(required = false) String focus,
                                            @RequestParam(required = false) Integer offset,
                                            @RequestParam(required = false) Integer limit,
                                            @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(demandService.gantt(ctx.getWsId(), ctx.getUserId(),
                extended(query(reqId, status, q, pris, kinds, cats, reqs, sort, offset, limit),
                        deliveryStage, versionId, closeReason, closeStage, focus)));
    }

    @GetMapping("/api/demands/workpage")
    public ApiResult<com.hourglass.dto.DemandWorkpageResponse> workpage(
            @RequestParam String status,
            @RequestParam(required = false) String reqId,
            @RequestParam(required = false) String q,
            @RequestParam(required = false) String pris,
            @RequestParam(required = false) String kinds,
            @RequestParam(required = false) String cats,
            @RequestParam(required = false) String reqs,
            @RequestParam(required = false) String sort,
            @RequestParam(required = false) String deliveryStage,
            @RequestParam(required = false) String versionId,
            @RequestParam(required = false) String closeReason,
            @RequestParam(required = false) String closeStage,
            @RequestParam(required = false) String focus,
            @RequestParam(required = false) Integer offset,
            @RequestParam(required = false) Integer limit,
            @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(demandService.workpage(ctx.getWsId(), ctx.getUserId(),
                extended(query(reqId, status, q, pris, kinds, cats, reqs, sort, offset, limit),
                        deliveryStage, versionId, closeReason, closeStage, focus)));
    }

    private static DemandQuery extended(DemandQuery query, String deliveryStage, String versionId,
                                        String closeReason, String closeStage, String focus) {
        query.setDeliveryStage(deliveryStage);
        query.setVersionId(versionId);
        query.setCloseReason(closeReason);
        query.setCloseStage(closeStage);
        query.setFocus(focus);
        return query;
    }

    private static DemandQuery query(String reqId, String status, String q, String pris, String kinds,
                                     String cats, String reqs, String sort, Integer offset, Integer limit) {
        DemandQuery query = new DemandQuery();
        query.setReqId(reqId == null || reqId.trim().isEmpty() ? null : reqId.trim());
        query.setStatus(status);
        query.setQ(q == null || q.trim().isEmpty() ? null : q.trim());
        query.setPris(csv(pris));
        query.setKinds(csv(kinds));
        query.setCats(csv(cats));
        query.setReqs(csv(reqs));
        query.setSort(sort);
        query.setOffset(offset == null ? 0 : offset);
        query.setLimit(limit == null ? 50 : limit);
        return query;
    }

    private static List<String> csv(String value) {
        List<String> list = new java.util.ArrayList<String>();
        if (value == null) {
            return list;
        }
        for (String part : value.split(",")) {
            String item = part.trim();
            if (!item.isEmpty()) {
                list.add(item);
            }
        }
        return list;
    }

    @GetMapping("/api/demands/{id}")
    public ApiResult<Demand> get(@PathVariable String id, @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(demandService.getVisible(ctx.getWsId(), ctx.getUserId(), id));
    }

    @GetMapping("/api/demands/{id}/logs")
    public ApiResult<com.hourglass.dto.PageResult<Map<String, Object>>> logs(
            @PathVariable String id,
            @RequestParam(required = false) Integer offset,
            @RequestParam(required = false) Integer limit,
            @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(demandService.logs(ctx.getWsId(), ctx.getUserId(), id,
                offset == null ? 0 : offset, limit == null ? 100 : limit));
    }

    /** T2.3：需求详情「关联任务」透视 */
    @GetMapping("/api/demands/{id}/tasks")
    public ApiResult<com.hourglass.dto.PageResult<Task>> tasks(@PathVariable String id,
                                                               @CurrentWorkspace WorkspaceCtx ctx,
                                                               @RequestParam(required = false) Integer offset,
                                                               @RequestParam(required = false) Integer limit) {
        return ApiResult.ok(demandService.tasks(ctx.getWsId(), ctx.getUserId(), id,
                offset == null ? 0 : offset, limit == null ? 100 : limit));
    }

    /** 需求详情「关联文档」列表 */
    @GetMapping("/api/demands/{id}/docs")
    public ApiResult<com.hourglass.dto.PageResult<ReqDocView>> docs(
            @PathVariable String id,
            @RequestParam(required = false) Integer offset,
            @RequestParam(required = false) Integer limit,
            @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(docService.docsOfDemand(ctx.getWsId(), id, ctx.getUserId(),
                offset == null ? 0 : offset, limit == null ? 100 : limit));
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

    @RequireRole(RequireRole.ADMIN)
    @PostMapping("/api/demands/{id}/pass")
    public ApiResult<Demand> pass(@PathVariable String id,
                                  @Valid @RequestBody(required = false) DemandActionRequest body,
                                  @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(demandService.pass(CurrentUser.id(), ctx.getWsId(), id, body));
    }

    @RequireRole(RequireRole.ADMIN)
    @PostMapping("/api/demands/{id}/rej")
    public ApiResult<Demand> reject(@PathVariable String id,
                                    @Valid @RequestBody(required = false) DemandActionRequest body,
                                    @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(demandService.reject(CurrentUser.id(), ctx.getWsId(), id, body));
    }

    @PostMapping("/api/demands/{id}/plan")
    public ApiResult<Demand> plan(@PathVariable String id,
                                  @Valid @RequestBody(required = false) DemandActionRequest body,
                                  @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(demandService.plan(CurrentUser.id(), ctx.getWsId(), id, body));
    }

    @PostMapping("/api/demands/{id}/replan")
    public ApiResult<Demand> replan(@PathVariable String id,
                                    @Valid @RequestBody DemandActionRequest body,
                                    @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(demandService.replan(CurrentUser.id(), ctx.getWsId(), id, body));
    }

    @PostMapping("/api/demands/{id}/cancel")
    public ApiResult<Demand> cancel(@PathVariable String id,
                                    @Valid @RequestBody DemandActionRequest body,
                                    @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(demandService.cancel(CurrentUser.id(), ctx.getWsId(), id, body));
    }

    @PostMapping("/api/demands/{id}/restore")
    public ApiResult<Demand> restore(@PathVariable String id,
                                     @Valid @RequestBody DemandActionRequest body,
                                     @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(demandService.restore(CurrentUser.id(), ctx.getWsId(), id, body));
    }

    @RequireRole(RequireRole.ADMIN)
    @PostMapping("/api/demands/{id}/unpass")
    public ApiResult<Demand> unpass(@PathVariable String id,
                                    @Valid @RequestBody(required = false) DemandActionRequest body,
                                    @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(demandService.unpass(CurrentUser.id(), ctx.getWsId(), id, body));
    }

    @PostMapping("/api/demands/{id}/unplan")
    public ApiResult<Demand> unplan(@PathVariable String id,
                                    @Valid @RequestBody(required = false) DemandActionRequest body,
                                    @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(demandService.unplan(CurrentUser.id(), ctx.getWsId(), id, body));
    }

    @RequireRole(RequireRole.ADMIN)
    @PostMapping("/api/demands/{id}/reopen")
    public ApiResult<Demand> reopen(@PathVariable String id,
                                    @Valid @RequestBody(required = false) DemandActionRequest body,
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
