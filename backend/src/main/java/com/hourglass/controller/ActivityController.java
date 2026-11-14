package com.hourglass.controller;

import com.hourglass.common.ApiResult;
import com.hourglass.common.CurrentUser;
import com.hourglass.dto.ActivityFeed;
import com.hourglass.dto.ActivityQuery;
import com.hourglass.entity.Workspace;
import com.hourglass.service.ActivityService;
import com.hourglass.service.WorkspaceService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 空间级活动流（O-9）：工作项、需求、项目、文档、分支、版本与配置变更的统一时间线 */
@RestController
public class ActivityController {

    private final ActivityService activityService;
    private final WorkspaceService workspaceService;

    public ActivityController(ActivityService activityService, WorkspaceService workspaceService) {
        this.activityService = activityService;
        this.workspaceService = workspaceService;
    }

    @GetMapping("/api/activity")
    public ApiResult<ActivityFeed> activity(
            @RequestParam(required = false) String workspace,
            @RequestParam(required = false) String type,
            @RequestParam(required = false) String action,
            @RequestParam(required = false) String actor,
            @RequestParam(required = false) String from,
            @RequestParam(required = false) String to,
            @RequestParam(required = false) String q,
            @RequestParam(required = false) Integer offset,
            @RequestParam(required = false) Integer limit) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        ActivityQuery query = new ActivityQuery();
        query.setType(type);
        query.setAction(action);
        query.setActorId(actor);
        query.setFromDate(from);
        query.setToDate(to);
        query.setKeyword(q);
        return ApiResult.ok(activityService.feed(ws.getId(), userId, query,
                offset == null ? 0 : offset, limit == null ? 50 : limit));
    }
}
