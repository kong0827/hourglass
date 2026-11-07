package com.hourglass.controller;

import com.hourglass.common.ApiResult;
import com.hourglass.common.CurrentUser;
import com.hourglass.dto.SubtaskRequest;
import com.hourglass.entity.Subtask;
import com.hourglass.entity.Workspace;
import com.hourglass.service.SubtaskService;
import com.hourglass.service.WorkspaceService;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import javax.validation.Valid;
import java.util.List;

@RestController
public class SubtaskController {

    private final SubtaskService subtaskService;
    private final WorkspaceService workspaceService;

    public SubtaskController(SubtaskService subtaskService, WorkspaceService workspaceService) {
        this.subtaskService = subtaskService;
        this.workspaceService = workspaceService;
    }

    @GetMapping("/api/tasks/{taskId}/subtasks")
    public ApiResult<List<Subtask>> list(@PathVariable String taskId,
                                         @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(subtaskService.list(ws.getId(), userId, taskId));
    }

    @PostMapping("/api/tasks/{taskId}/subtasks")
    public ApiResult<Subtask> create(@PathVariable String taskId, @Valid @RequestBody SubtaskRequest req,
                                     @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(subtaskService.create(userId, ws.getId(), taskId, req));
    }

    @PutMapping("/api/subtasks/{id}")
    public ApiResult<Subtask> update(@PathVariable Long id, @Valid @RequestBody SubtaskRequest req,
                                     @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(subtaskService.update(userId, ws.getId(), id, req));
    }

    @DeleteMapping("/api/subtasks/{id}")
    public ApiResult<Void> delete(@PathVariable Long id, @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        subtaskService.delete(userId, ws.getId(), id);
        return ApiResult.ok();
    }
}
