package com.devstudio.kanban.controller;

import com.devstudio.kanban.common.ApiResult;
import com.devstudio.kanban.common.CurrentUser;
import com.devstudio.kanban.dto.ListPreferenceRequest;
import com.devstudio.kanban.dto.ListPreferenceResponse;
import com.devstudio.kanban.entity.Workspace;
import com.devstudio.kanban.service.ListPreferenceService;
import com.devstudio.kanban.service.WorkspaceService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class ListPreferenceController {

    private final ListPreferenceService listPreferenceService;
    private final WorkspaceService workspaceService;

    public ListPreferenceController(ListPreferenceService listPreferenceService, WorkspaceService workspaceService) {
        this.listPreferenceService = listPreferenceService;
        this.workspaceService = workspaceService;
    }

    @GetMapping("/api/list-preferences/{viewKey}")
    public ApiResult<ListPreferenceResponse> get(@PathVariable String viewKey,
                                                 @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(listPreferenceService.get(userId, ws.getId(), viewKey));
    }

    @PutMapping("/api/list-preferences/{viewKey}")
    public ApiResult<ListPreferenceResponse> save(@PathVariable String viewKey,
                                                  @RequestBody ListPreferenceRequest req,
                                                  @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(listPreferenceService.save(userId, ws.getId(), viewKey, req));
    }
}
