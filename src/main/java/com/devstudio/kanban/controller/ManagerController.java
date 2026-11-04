package com.devstudio.kanban.controller;

import com.devstudio.kanban.common.ApiResult;
import com.devstudio.kanban.common.CurrentWorkspace;
import com.devstudio.kanban.config.WorkspaceCtx;
import com.devstudio.kanban.service.ManagerService;
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

    @GetMapping("/reports")
    public ApiResult<Map<String, Object>> reports(@RequestParam(required = false) String reqId,
                                                  @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(managerService.reports(ctx.getWsId(), reqId, ctx.getUserId()));
    }

    @GetMapping("/workload")
    public ApiResult<Map<String, Object>> workload(@CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(managerService.workload(ctx.getWsId(), ctx.getUserId()));
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
