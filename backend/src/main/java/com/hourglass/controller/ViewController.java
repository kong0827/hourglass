package com.hourglass.controller;

import com.hourglass.common.ApiResult;
import com.hourglass.common.CurrentUser;
import com.hourglass.dto.SavedViewRequest;
import com.hourglass.entity.SavedView;
import com.hourglass.entity.Workspace;
import com.hourglass.service.SavedViewService;
import com.hourglass.service.WorkspaceService;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import javax.validation.Valid;
import java.util.List;

@RestController
public class ViewController {

    private final SavedViewService savedViewService;
    private final WorkspaceService workspaceService;

    public ViewController(SavedViewService savedViewService, WorkspaceService workspaceService) {
        this.savedViewService = savedViewService;
        this.workspaceService = workspaceService;
    }

    @GetMapping("/api/views")
    public ApiResult<List<SavedView>> list(@RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(savedViewService.list(userId, ws.getId()));
    }

    @PostMapping("/api/views")
    public ApiResult<SavedView> create(@Valid @RequestBody SavedViewRequest req,
                                       @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(savedViewService.create(userId, ws.getId(), req));
    }

    @DeleteMapping("/api/views/{id}")
    public ApiResult<Void> delete(@PathVariable String id, @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        savedViewService.delete(userId, ws.getId(), id);
        return ApiResult.ok();
    }
}
