package com.hourglass.controller;

import com.hourglass.common.ApiResult;
import com.hourglass.common.CurrentUser;
import com.hourglass.entity.Workspace;
import com.hourglass.service.TimeLogService;
import com.hourglass.service.WorkspaceService;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.List;
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

    /** 工时记录列表（已结束的计时 + 手工补记） */
    @GetMapping("/api/tasks/{taskId}/timer/records")
    public ApiResult<List<Map<String, Object>>> records(@PathVariable String taskId,
                                                        @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(timeLogService.records(ws.getId(), taskId, userId));
    }

    /** 手工补记工时：forUserId 为空补自己，否则补该空间成员；date 格式 yyyy-MM-dd */
    @PostMapping("/api/tasks/{taskId}/timer/manual")
    public ApiResult<Map<String, Object>> addManual(@PathVariable String taskId,
                                                    @RequestParam(required = false) String workspace,
                                                    @RequestParam(required = false) String forUserId,
                                                    @RequestParam String date,
                                                    @RequestParam int minutes,
                                                    @RequestParam(required = false) String note) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        LocalDate day;
        try {
            day = LocalDate.parse(date);
        } catch (DateTimeParseException e) {
            throw com.hourglass.common.AppException.badRequest("日期格式应为 yyyy-MM-dd");
        }
        return ApiResult.ok(timeLogService.addManual(userId, ws.getId(), taskId, forUserId, day, minutes, note));
    }

    /** 作废一条已结束的工时记录（计时记录与手工补记都可作废），删除后统计按实际工时重算 */
    @DeleteMapping("/api/tasks/{taskId}/timer/records/{logId}")
    public ApiResult<Map<String, Object>> deleteRecord(@PathVariable String taskId,
                                                       @PathVariable Long logId,
                                                       @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(timeLogService.deleteRecord(userId, ws.getId(), taskId, logId));
    }
}
