package com.hourglass.controller;

import com.hourglass.common.ApiResult;
import com.hourglass.common.CurrentWorkspace;
import com.hourglass.config.WorkspaceCtx;
import com.hourglass.entity.VersionRelease;
import com.hourglass.service.TaskPublicationService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
public class TaskPublicationController {
    private final TaskPublicationService service;

    public TaskPublicationController(TaskPublicationService service) {
        this.service = service;
    }

    @GetMapping("/api/tasks/{id}/release-records")
    public ApiResult<List<VersionRelease>> records(@PathVariable String id, @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(service.records(ctx.getUserId(), ctx.getWsId(), id));
    }
}
