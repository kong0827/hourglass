package com.devstudio.kanban.controller;

import com.devstudio.kanban.common.ApiResult;
import com.devstudio.kanban.common.CurrentUser;
import com.devstudio.kanban.entity.Workspace;
import com.devstudio.kanban.service.TimeLogService;
import com.devstudio.kanban.service.WorkspaceService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
public class TimerController {

    private final TimeLogService timeLogService;
    private final WorkspaceService workspaceService;

    public TimerController(TimeLogService timeLogService, WorkspaceService workspaceService) {
        this.timeLogService = timeLogService;
        this.workspaceService = workspaceService;
    }

    @GetMapping("/api/tasks/{taskId}/timer")
    public ApiResult<Map<String, Object>> status(@PathVariable String taskId,
                                                 @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(timeLogService.status(ws.getId(), taskId, userId));
    }

    /**
     * 我当前正在计时的任务（跨空间，最多一条）。
     * 看板用它渲染卡片上的「计时中」状态 —— 所以走全局语义，不能按当前空间过滤。
     */
    @GetMapping("/api/my-running-timer")
    public ApiResult<Map<String, Object>> myRunning() {
        return ApiResult.ok(timeLogService.myRunning(CurrentUser.id()));
    }

    @PostMapping("/api/tasks/{taskId}/timer/start")
    public ApiResult<Map<String, Object>> start(@PathVariable String taskId,
                                                @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        /* 手动开始：只有「待处理」「已完成」以外的任务能计时 */
        return ApiResult.ok(timeLogService.startManual(userId, ws.getId(), taskId));
    }

    @PostMapping("/api/tasks/{taskId}/timer/stop")
    public ApiResult<Map<String, Object>> stop(@PathVariable String taskId,
                                               @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(timeLogService.stop(userId, ws.getId(), taskId));
    }
}
