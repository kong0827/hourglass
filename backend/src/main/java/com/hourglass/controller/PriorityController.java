package com.hourglass.controller;

import com.hourglass.common.ApiResult;
import com.hourglass.common.CurrentUser;
import com.hourglass.dto.PriorityRequest;
import com.hourglass.entity.Workspace;
import com.hourglass.entity.WorkspacePriority;
import com.hourglass.service.PriorityService;
import com.hourglass.service.WorkspaceService;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import javax.validation.Valid;
import java.util.List;

@RestController
public class PriorityController {

    private final PriorityService priorityService;
    private final WorkspaceService workspaceService;

    public PriorityController(PriorityService priorityService, WorkspaceService workspaceService) {
        this.priorityService = priorityService;
        this.workspaceService = workspaceService;
    }

    @GetMapping("/api/priorities")
    public ApiResult<List<WorkspacePriority>> list(@RequestParam(required = false) String workspace) {
        Workspace ws = workspaceService.resolve(CurrentUser.id(), workspace);
        return ApiResult.ok(priorityService.list(ws.getId()));
    }

    @PutMapping("/api/priorities/{code}")
    public ApiResult<WorkspacePriority> update(@PathVariable String code, @Valid @RequestBody PriorityRequest req,
                                               @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        workspaceService.requireWriter(userId, ws.getId());
        return ApiResult.ok(priorityService.update(ws.getId(), code, req));
    }

    @DeleteMapping("/api/priorities")
    public ApiResult<Void> reset(@RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        workspaceService.requireWriter(userId, ws.getId());
        priorityService.reset(ws.getId());
        return ApiResult.ok();
    }
}
