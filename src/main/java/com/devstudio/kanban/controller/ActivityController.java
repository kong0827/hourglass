package com.devstudio.kanban.controller;

import com.devstudio.kanban.common.ApiResult;
import com.devstudio.kanban.common.CurrentUser;
import com.devstudio.kanban.entity.TaskLog;
import com.devstudio.kanban.entity.Workspace;
import com.devstudio.kanban.service.ActivityService;
import com.devstudio.kanban.service.WorkspaceService;
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
    public ApiResult<List<TaskLog>> activity(@RequestParam(required = false) String workspace,
                                             @RequestParam(required = false) Integer limit) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(activityService.activity(ws.getId(), userId, limit));
    }
}
