package com.hourglass.controller;

import com.hourglass.common.ApiResult;
import com.hourglass.common.CurrentUser;
import com.hourglass.dto.PageResult;
import com.hourglass.dto.StatsResponse;
import com.hourglass.dto.TaskDrillRow;
import com.hourglass.entity.Workspace;
import com.hourglass.service.StatsService;
import com.hourglass.service.WorkspaceService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

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

    /** 趋势 / 分布 / 流程体检下钻：返回与聚合同口径的工作项明细分页，单页最多 100 条 */
    @GetMapping("/api/stats/tasks")
    public ApiResult<PageResult<TaskDrillRow>> tasks(@RequestParam(required = false) String workspace,
                                                     @RequestParam(required = false) String kind,
                                                     @RequestParam(required = false) String from,
                                                     @RequestParam(required = false) String before,
                                                     @RequestParam(required = false) String value,
                                                     @RequestParam(required = false) Integer offset,
                                                     @RequestParam(required = false) Integer limit) {
        Workspace ws = workspaceService.resolve(CurrentUser.id(), workspace);
        return ApiResult.ok(statsService.drillTasks(ws.getId(), CurrentUser.id(),
                kind, from, before, value, offset, limit));
    }

    /** 工时卡下钻：period=week/total，scope=mine/all；分页最多 100 条 */
    @GetMapping("/api/stats/hour-logs")
    public ApiResult<Map<String, Object>> hourLogs(@RequestParam(required = false) String workspace,
                                                   @RequestParam(required = false) String scope,
                                                   @RequestParam(required = false) String period,
                                                   @RequestParam(required = false) Integer offset,
                                                   @RequestParam(required = false) Integer limit) {
        Workspace ws = workspaceService.resolve(CurrentUser.id(), workspace);
        return ApiResult.ok(statsService.hourLogs(ws.getId(), CurrentUser.id(),
                scope, period, offset, limit));
    }
}
