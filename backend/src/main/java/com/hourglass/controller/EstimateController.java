package com.hourglass.controller;

import com.hourglass.common.ApiResult;
import com.hourglass.common.CurrentUser;
import com.hourglass.dto.EstimateStats;
import com.hourglass.entity.Workspace;
import com.hourglass.service.EstimateService;
import com.hourglass.service.WorkspaceService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 估时准确度：把「自己填的预估」和「计时记录的实际」摆在一起算系数，顺带挑出快超预估的任务。
 * 只读，不改业务数据。
 */
@RestController
public class EstimateController {

    private final EstimateService estimateService;
    private final WorkspaceService workspaceService;

    public EstimateController(EstimateService estimateService, WorkspaceService workspaceService) {
        this.estimateService = estimateService;
        this.workspaceService = workspaceService;
    }

    @GetMapping("/api/estimate/stats")
    public ApiResult<EstimateStats> stats(@RequestParam(required = false) String workspace) {
        Workspace ws = workspaceService.resolve(CurrentUser.id(), workspace);
        return ApiResult.ok(estimateService.stats(ws.getId(), CurrentUser.id()));
    }
}
