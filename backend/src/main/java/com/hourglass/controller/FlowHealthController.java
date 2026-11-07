package com.hourglass.controller;

import com.hourglass.common.ApiResult;
import com.hourglass.common.CurrentUser;
import com.hourglass.dto.FlowHealthResponse;
import com.hourglass.entity.Workspace;
import com.hourglass.service.FlowHealthService;
import com.hourglass.service.WorkspaceService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 流程体检：从 task_log 的移动痕迹反推流程哪里堵、返工多少、需求多久才开工。
 * 只读接口，不改任何业务数据。
 */
@RestController
public class FlowHealthController {

    private final FlowHealthService flowHealthService;
    private final WorkspaceService workspaceService;

    public FlowHealthController(FlowHealthService flowHealthService, WorkspaceService workspaceService) {
        this.flowHealthService = flowHealthService;
        this.workspaceService = workspaceService;
    }

    /** 默认近 90 天；按空间隔离 */
    @GetMapping("/api/flow-health")
    public ApiResult<FlowHealthResponse> flowHealth(@RequestParam(required = false) String workspace,
                                                    @RequestParam(required = false) Integer days) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(flowHealthService.flowHealth(ws.getId(), userId, days));
    }
}
