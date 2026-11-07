package com.hourglass.controller;

import com.hourglass.common.ApiResult;
import com.hourglass.common.CurrentWorkspace;
import com.hourglass.common.RequireRole;
import com.hourglass.config.WorkspaceCtx;
import com.hourglass.dto.PhaseMemberTask;
import com.hourglass.dto.PhaseStatsResponse;
import com.hourglass.dto.ProjectVersionSaveRequest;
import com.hourglass.dto.ReleaseNoteResponse;
import com.hourglass.dto.VersionOverviewResponse;
import com.hourglass.dto.VersionStatsResponse;
import com.hourglass.entity.ProjectVersion;
import com.hourglass.entity.Task;
import com.hourglass.service.ProjectVersionService;
import com.hourglass.service.VersionPhaseService;
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

@RestController
public class ProjectVersionController {

    private final ProjectVersionService versionService;
    private final VersionPhaseService phaseService;

    public ProjectVersionController(ProjectVersionService versionService, VersionPhaseService phaseService) {
        this.versionService = versionService;
        this.phaseService = phaseService;
    }

    @GetMapping("/api/versions")
    public ApiResult<List<ProjectVersion>> list(@RequestParam String reqId, @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(versionService.list(ctx.getWsId(), reqId, ctx.getUserId()));
    }

    /** T1.3：版本聚合统计（版本卡三态口径 + 待规划任务桶） */
    @GetMapping("/api/versions/stats")
    public ApiResult<VersionStatsResponse> versionStats(@RequestParam String reqId, @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(phaseService.versionStats(ctx.getWsId(), reqId, ctx.getUserId()));
    }

    /** T1.4：首版/迭代阶段双统计（成员阶段工时 + 新增需求/缺陷维护拆分） */
    @GetMapping("/api/phase/stats")
    public ApiResult<PhaseStatsResponse> phaseStats(@RequestParam String reqId, @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(phaseService.phaseStats(ctx.getWsId(), reqId, ctx.getUserId()));
    }

    /** 成员阶段工时下钻：该成员自己的计时按「任务 × 阶段」聚合 */
    @GetMapping("/api/phase/member-tasks")
    public ApiResult<List<PhaseMemberTask>> memberTasks(@RequestParam String reqId, @RequestParam String userId,
                                                        @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(phaseService.memberTasks(ctx.getWsId(), reqId, userId, ctx.getUserId()));
    }

    /** 管理端总览：全部项目的首版/迭代工时对比、版本节奏与准时率 */
    @GetMapping("/api/versions/overview")
    public ApiResult<VersionOverviewResponse> overview(@CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(phaseService.overview(ctx.getWsId(), ctx.getUserId()));
    }

    /** T1.6：发布说明（版本任务 + 需求清单） */
    @GetMapping("/api/versions/{id}/release-note")
    public ApiResult<ReleaseNoteResponse> releaseNote(@PathVariable String id, @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(phaseService.releaseNote(ctx.getWsId(), id, ctx.getUserId()));
    }

    @GetMapping("/api/versions/task-options")
    public ApiResult<List<Task>> taskOptions(@RequestParam String reqId, @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(versionService.taskOptions(ctx.getWsId(), reqId, ctx.getUserId()));
    }

    @PostMapping("/api/versions")
    public ApiResult<ProjectVersion> create(@Valid @RequestBody ProjectVersionSaveRequest req,
                                            @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(versionService.create(ctx.getUserId(), ctx.getWsId(), req));
    }

    @PutMapping("/api/versions/{id}")
    public ApiResult<ProjectVersion> update(@PathVariable String id,
                                            @Valid @RequestBody ProjectVersionSaveRequest req,
                                            @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(versionService.update(ctx.getUserId(), ctx.getWsId(), id, req));
    }

    @PostMapping("/api/versions/{id}/release")
    public ApiResult<ProjectVersion> publish(@PathVariable String id, @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(versionService.publish(ctx.getUserId(), ctx.getWsId(), id));
    }

    @PostMapping("/api/versions/{id}/start")
    public ApiResult<ProjectVersion> start(@PathVariable String id, @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(versionService.start(ctx.getUserId(), ctx.getWsId(), id));
    }

    @RequireRole
    @DeleteMapping("/api/versions/{id}")
    public ApiResult<Void> delete(@PathVariable String id, @CurrentWorkspace WorkspaceCtx ctx) {
        versionService.delete(ctx.getUserId(), ctx.getWsId(), id);
        return ApiResult.ok();
    }
}
