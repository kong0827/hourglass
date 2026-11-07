package com.hourglass.controller;

import com.hourglass.common.ApiResult;
import com.hourglass.common.CurrentUser;
import com.hourglass.dto.StatsResponse;
import com.hourglass.entity.Workspace;
import com.hourglass.service.StatsService;
import com.hourglass.service.WorkspaceService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class StatsController {

    private final StatsService statsService;
    private final WorkspaceService workspaceService;

    public StatsController(StatsService statsService, WorkspaceService workspaceService) {
        this.statsService = statsService;
        this.workspaceService = workspaceService;
    }

    /** 统计报表：默认近 8 周（按空间隔离；工时按当前用户统计） */
    @GetMapping("/api/stats")
    public ApiResult<StatsResponse> stats(@RequestParam(required = false) String workspace,
                                          @RequestParam(required = false) Integer weeks) {
        Workspace ws = workspaceService.resolve(CurrentUser.id(), workspace);
        return ApiResult.ok(statsService.stats(ws.getId(), CurrentUser.id(), weeks));
    }
}
