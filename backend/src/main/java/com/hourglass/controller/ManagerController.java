package com.hourglass.controller;

import com.hourglass.common.ApiResult;
import com.hourglass.common.CurrentWorkspace;
import com.hourglass.config.WorkspaceCtx;
import com.hourglass.dto.PageResult;
import com.hourglass.service.ManagerService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/** 管理组项目组合、报表、负载、风险与催办。 */
@RestController
@RequestMapping("/api/manager")
public class ManagerController {

    private final ManagerService managerService;

    public ManagerController(ManagerService managerService) {
        this.managerService = managerService;
    }

    @GetMapping("/portfolio")
    public ApiResult<Map<String, Object>> portfolio(@CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(managerService.portfolio(ctx.getWsId(), ctx.getUserId()));
    }

    @GetMapping("/projects/{reqId}")
    public ApiResult<Map<String, Object>> project(@PathVariable String reqId,
                                                  @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(managerService.project(ctx.getWsId(), reqId, ctx.getUserId()));
    }

    public ApiResult<Map<String, Object>> reports(String reqId, WorkspaceCtx ctx) {
        return ApiResult.ok(managerService.reports(ctx.getWsId(), reqId, ctx.getUserId()));
    }

    @GetMapping("/reports")
    public ApiResult<Map<String, Object>> reports(@RequestParam(required = false) String reqId,
                                                  @RequestParam(required = false) String roleTitle,
                                                  @RequestParam(required = false) String companyName,
                                                  @RequestParam(required = false) String versionId,
                                                  @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(managerService.reports(ctx.getWsId(), reqId, ctx.getUserId(),
                roleTitle, companyName, versionId));
    }

    @GetMapping("/reports/tasks")
    public ApiResult<PageResult<Map<String, Object>>> reportTasks(
            @RequestParam(required = false) String reqId,
            @RequestParam(required = false) String roleTitle,
            @RequestParam(required = false) String companyName,
            @RequestParam(required = false) String chart,
            @RequestParam(required = false) String weekStart,
            @RequestParam(required = false) String state,
            @RequestParam(required = false) String bucket,
            @RequestParam(required = false) String date,
            @RequestParam(required = false) String versionId,
            @RequestParam(required = false) Integer offset,
            @RequestParam(required = false) Integer limit,
            @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(managerService.reportTasks(ctx.getWsId(), ctx.getUserId(),
                reqId, roleTitle, companyName, chart, weekStart, state, bucket, date,
                versionId, offset, limit));
    }

    public ApiResult<Map<String, Object>> workload(WorkspaceCtx ctx) {
        return ApiResult.ok(managerService.workload(ctx.getWsId(), ctx.getUserId()));
    }

    @GetMapping("/workload")
    public ApiResult<Map<String, Object>> workload(@RequestParam(required = false) String reqId,
                                                   @RequestParam(required = false) String roleTitle,
                                                   @RequestParam(required = false) String companyName,
                                                   @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(managerService.workload(ctx.getWsId(), ctx.getUserId(), reqId, roleTitle, companyName));
    }

    @GetMapping("/risks")
    public ApiResult<Map<String, Object>> risks(@CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(managerService.risks(ctx.getWsId(), ctx.getUserId()));
    }

    @PostMapping("/nudges")
    public ApiResult<Map<String, Object>> nudges(@RequestBody NudgeRequest request,
                                                 @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(managerService.nudges(ctx.getWsId(), ctx.getUserId(), request.getTaskIds()));
    }

    public static class NudgeRequest {
        private List<String> taskIds;

        public List<String> getTaskIds() {
            return taskIds;
        }

        public void setTaskIds(List<String> taskIds) {
            this.taskIds = taskIds;
        }
    }
}
