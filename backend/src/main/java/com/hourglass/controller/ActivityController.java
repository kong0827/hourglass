package com.hourglass.controller;

import com.hourglass.common.ApiResult;
import com.hourglass.common.CurrentUser;
import com.hourglass.entity.TaskLog;
import com.hourglass.entity.Workspace;
import com.hourglass.service.ActivityService;
import com.hourglass.service.WorkspaceService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/** 空间级活动流（O-9）：让删除列/分类/项目、移出成员、清空数据这类破坏性操作可追溯 */
@RestController
public class ActivityController {

    private final ActivityService activityService;
    private final WorkspaceService workspaceService;

    public ActivityController(ActivityService activityService, WorkspaceService workspaceService) {
        this.activityService = activityService;
        this.workspaceService = workspaceService;
    }

    @GetMapping("/api/activity")
    public ApiResult<com.hourglass.dto.PageResult<TaskLog>> activity(
            @RequestParam(required = false) String workspace,
            @RequestParam(required = false) Integer offset,
            @RequestParam(required = false) Integer limit) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(activityService.activity(ws.getId(), userId,
                offset == null ? 0 : offset, limit == null ? 50 : limit));
    }
}
