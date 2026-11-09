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

/** M2 需求池（T2.1）：提交/编辑所有成员可做；评审流转（pass/rej/plan/reopen）与删除仅空间主 */
@RestController
public class DemandController {

    private final DemandService demandService;
    private final RequirementDocService docService;

    public DemandController(DemandService demandService, RequirementDocService docService) {
        this.demandService = demandService;
        this.docService = docService;
    }

    /** 需求池看板首屏：每个状态一列，只下发前 limit 条 */
    @GetMapping("/api/demands/board")
    public ApiResult<DemandBoardResponse> board(@RequestParam(required = false) String reqId,
                                                @RequestParam(required = false) Integer limit,
                                                @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(demandService.board(ctx.getWsId(), ctx.getUserId(), reqId,
                limit == null ? 0 : limit));
    }

    /** 需求池分页：看板单列滚动加载 + 列表模式的筛选/排序/分页 */
    @GetMapping({"/api/demands", "/api/demands/page"})
    public ApiResult<DemandPage> page(@RequestParam(required = false) String reqId,
                                      @RequestParam(required = false) String status,
                                      @RequestParam(required = false) String q,
                                      @RequestParam(required = false) String pris,
                                      @RequestParam(required = false) String kinds,
                                      @RequestParam(required = false) String reqs,
                                      @RequestParam(required = false) String sort,
                                      @RequestParam(required = false) Integer offset,
                                      @RequestParam(required = false) Integer limit,
                                      @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(demandService.page(ctx.getWsId(), ctx.getUserId(),
                query(reqId, status, q, pris, kinds, reqs, sort, offset, limit)));
    }

    /** 需求池甘特：分页口径同列表，额外下发每条需求的阶段时间轴 */
    @GetMapping("/api/demands/gantt")
    public ApiResult<DemandGanttPage> gantt(@RequestParam(required = false) String reqId,
                                            @RequestParam(required = false) String status,
                                            @RequestParam(required = false) String q,
                                            @RequestParam(required = false) String pris,
                                            @RequestParam(required = false) String kinds,
                                            @RequestParam(required = false) String reqs,
                                            @RequestParam(required = false) String sort,
                                            @RequestParam(required = false) Integer offset,
                                            @RequestParam(required = false) Integer limit,
                                            @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(demandService.gantt(ctx.getWsId(), ctx.getUserId(),
                query(reqId, status, q, pris, kinds, reqs, sort, offset, limit)));
    }

    private static DemandQuery query(String reqId, String status, String q, String pris, String kinds,
                                     String reqs, String sort, Integer offset, Integer limit) {
        DemandQuery query = new DemandQuery();
        query.setReqId(reqId == null || reqId.trim().isEmpty() ? null : reqId.trim());
        query.setStatus(status);
        query.setQ(q == null || q.trim().isEmpty() ? null : q.trim());
        query.setPris(csv(pris));
        query.setKinds(csv(kinds));
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
    @PostMapping("/api/demands/{id}/unpass")
    public ApiResult<Demand> unpass(@PathVariable String id,
                                    @RequestBody(required = false) DemandActionRequest body,
                                    @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(demandService.unpass(CurrentUser.id(), ctx.getWsId(), id, body));
    }

    @RequireRole
    @PostMapping("/api/demands/{id}/unplan")
    public ApiResult<Demand> unplan(@PathVariable String id,
                                    @RequestBody(required = false) DemandActionRequest body,
                                    @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(demandService.unplan(CurrentUser.id(), ctx.getWsId(), id, body));
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
