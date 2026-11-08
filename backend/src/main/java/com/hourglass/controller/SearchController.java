package com.hourglass.controller;

import com.hourglass.common.ApiResult;
import com.hourglass.common.CurrentUser;
import com.hourglass.dto.SearchHit;
import com.hourglass.entity.Workspace;
import com.hourglass.service.SearchService;
import com.hourglass.service.WorkspaceService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/** 全局搜索（Cmd/Ctrl+K）：项目、工作项、文档、需求、用例一次聚合。 */
@RestController
public class SearchController {

    private final SearchService searchService;
    private final WorkspaceService workspaceService;

    public SearchController(SearchService searchService, WorkspaceService workspaceService) {
        this.searchService = searchService;
        this.workspaceService = workspaceService;
    }

    @GetMapping("/api/search")
    public ApiResult<List<SearchHit>> search(@RequestParam String q,
                                             @RequestParam(required = false) Integer limit,
                                             @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(searchService.search(ws.getId(), userId, q, limit == null ? 5 : limit));
    }
}
