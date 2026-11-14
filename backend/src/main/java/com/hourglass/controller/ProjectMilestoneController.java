package com.hourglass.controller;

import com.hourglass.common.ApiResult;
import com.hourglass.common.CurrentWorkspace;
import com.hourglass.config.WorkspaceCtx;
import com.hourglass.dto.MilestoneActionRequest;
import com.hourglass.dto.MilestoneSaveRequest;
import com.hourglass.dto.MilestoneUpdateRequest;
import com.hourglass.dto.MilestoneView;
import com.hourglass.service.ProjectMilestoneService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import javax.validation.Valid;
import java.util.List;

@RestController
public class ProjectMilestoneController {

    private final ProjectMilestoneService milestoneService;

    public ProjectMilestoneController(ProjectMilestoneService milestoneService) {
        this.milestoneService = milestoneService;
    }

    @GetMapping("/api/milestones")
    public ApiResult<List<MilestoneView>> list(@RequestParam String reqId, @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(milestoneService.list(ctx.getWsId(), reqId, ctx.getUserId()));
    }

    @GetMapping("/api/milestones/{id}")
    public ApiResult<MilestoneView> detail(@PathVariable String id, @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(milestoneService.detail(ctx.getWsId(), id, ctx.getUserId()));
    }

    @PostMapping("/api/milestones")
    public ApiResult<MilestoneView> create(@Valid @RequestBody MilestoneSaveRequest request,
                                           @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(milestoneService.create(ctx.getUserId(), ctx.getWsId(), request));
    }

    /** 只改名称 / 负责人 / 关键标记 / 说明；日期走改期，条件创建后不改 */
    @PutMapping("/api/milestones/{id}")
    public ApiResult<MilestoneView> update(@PathVariable String id, @Valid @RequestBody MilestoneUpdateRequest request,
                                           @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(milestoneService.update(ctx.getUserId(), ctx.getWsId(), id, request));
    }

    @PostMapping("/api/milestones/{id}/reschedule")
    public ApiResult<MilestoneView> reschedule(@PathVariable String id, @Valid @RequestBody MilestoneActionRequest request,
                                               @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(milestoneService.reschedule(ctx.getUserId(), ctx.getWsId(), id, request));
    }

    @PostMapping("/api/milestones/{id}/cancel")
    public ApiResult<MilestoneView> cancel(@PathVariable String id, @Valid @RequestBody MilestoneActionRequest request,
                                           @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(milestoneService.cancel(ctx.getUserId(), ctx.getWsId(), id, request));
    }

    @PostMapping("/api/milestones/{id}/achieve")
    public ApiResult<MilestoneView> achieve(@PathVariable String id, @Valid @RequestBody MilestoneActionRequest request,
                                            @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(milestoneService.achieve(ctx.getUserId(), ctx.getWsId(), id, request));
    }

    @PostMapping("/api/milestones/{id}/revoke")
    public ApiResult<MilestoneView> revoke(@PathVariable String id, @Valid @RequestBody MilestoneActionRequest request,
                                           @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(milestoneService.revoke(ctx.getUserId(), ctx.getWsId(), id, request));
    }
}
