package com.devstudio.kanban.controller;

import com.devstudio.kanban.common.ApiResult;
import com.devstudio.kanban.common.CurrentUser;
import com.devstudio.kanban.entity.TagCount;
import com.devstudio.kanban.entity.Workspace;
import com.devstudio.kanban.service.WorkspaceMetaCache;
import com.devstudio.kanban.service.WorkspaceService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
public class TagController {

    private final WorkspaceMetaCache metaCache;
    private final WorkspaceService workspaceService;

    public TagController(WorkspaceMetaCache metaCache, WorkspaceService workspaceService) {
        this.metaCache = metaCache;
        this.workspaceService = workspaceService;
    }

    /** 当前空间有任务关联的标签（用于输入联想与筛选） */
    @GetMapping("/api/tags")
    public ApiResult<List<TagCount>> list(@RequestParam(required = false) String workspace) {
        Workspace ws = workspaceService.resolve(CurrentUser.id(), workspace);
        return ApiResult.ok(metaCache.tags(ws.getId()));
    }
}
