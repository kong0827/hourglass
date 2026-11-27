package com.hourglass.controller;

import com.hourglass.common.ApiResult;
import com.hourglass.common.CurrentWorkspace;
import com.hourglass.config.WorkspaceCtx;
import com.hourglass.dto.PageResult;
import com.hourglass.dto.TaskPublicationJudgementBatchRequest;
import com.hourglass.dto.TaskPublicationJudgementRequest;
import com.hourglass.entity.TaskPublicationJudgement;
import com.hourglass.entity.VersionRelease;
import com.hourglass.service.TaskPublicationJudgementService;
import com.hourglass.service.TaskPublicationService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

@RestController
public class TaskPublicationController {
    private final TaskPublicationService service;
    private final TaskPublicationJudgementService judgementService;

    public TaskPublicationController(TaskPublicationService service,
                                     TaskPublicationJudgementService judgementService) {
        this.service = service;
        this.judgementService = judgementService;
    }

    @GetMapping("/api/tasks/{id}/release-records")
    public ApiResult<List<VersionRelease>> records(@PathVariable String id, @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(service.records(ctx.getUserId(), ctx.getWsId(), id));
    }

    /** 人工标记历史：追加式记录，最多返回 100 条。 */
    @GetMapping("/api/tasks/{id}/publication-judgements")
    public ApiResult<PageResult<TaskPublicationJudgement>> judgements(
            @PathVariable String id,
            @RequestParam(required = false) Integer offset,
            @RequestParam(required = false) Integer limit,
            @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(judgementService.history(ctx.getWsId(), ctx.getUserId(), id,
                offset == null ? 0 : offset, limit == null ? 100 : limit));
    }

    /** 人工标记已发布：按空间「人工标记工作项发布」配置判定，仅用于无发布记录的历史迁移数据。 */
    @PostMapping("/api/tasks/{id}/publication-judgement")
    public ApiResult<TaskPublicationJudgement> mark(@PathVariable String id,
                                                    @RequestBody TaskPublicationJudgementRequest body,
                                                    @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(judgementService.mark(ctx.getUserId(), ctx.getWsId(), id, body));
    }

    /** 撤销人工标记：保留历史，回落为未发布。 */
    @PostMapping("/api/tasks/{id}/publication-judgement/revoke")
    public ApiResult<Void> revoke(@PathVariable String id,
                                  @RequestBody TaskPublicationJudgementRequest body,
                                  @CurrentWorkspace WorkspaceCtx ctx) {
        judgementService.revoke(ctx.getUserId(), ctx.getWsId(), id, body);
        return ApiResult.ok();
    }

    /** 批量标记：单次最多 100 条，整批一个事务。 */
    @PostMapping("/api/tasks/publication-judgement/batch")
    public ApiResult<Map<String, Integer>> markBatch(
            @RequestBody TaskPublicationJudgementBatchRequest body,
            @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(judgementService.markBatch(ctx.getUserId(), ctx.getWsId(), body));
    }

    /** 批量撤销：已撤销的条目跳过。 */
    @PostMapping("/api/tasks/publication-judgement/batch/revoke")
    public ApiResult<Map<String, Integer>> revokeBatch(
            @RequestBody TaskPublicationJudgementBatchRequest body,
            @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(judgementService.revokeBatch(ctx.getUserId(), ctx.getWsId(), body));
    }
}
