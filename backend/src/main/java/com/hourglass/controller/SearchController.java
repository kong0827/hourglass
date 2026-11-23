package com.hourglass.controller;

import com.hourglass.common.ApiResult;
import com.hourglass.common.CurrentUser;
import com.hourglass.dto.SearchHit;
import com.hourglass.dto.SearchQuery;
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

    /**
     * q 可省略：只按范围（项目 / 版本 / 类型 / 状态 / 负责人 / 日期）查看时也允许。
     * 各实体只应用自己支持的维度，不支持的维度忽略。
     */
    @GetMapping("/api/search")
    public ApiResult<List<SearchHit>> search(@RequestParam(required = false) String q,
                                             @RequestParam(required = false) String type,
                                             @RequestParam(required = false) String reqId,
                                             @RequestParam(required = false) String versionId,
                                             @RequestParam(required = false) String status,
                                             @RequestParam(required = false) String owner,
                                             @RequestParam(required = false) String from,
                                             @RequestParam(required = false) String to,
                                             @RequestParam(required = false) Integer limit,
                                             @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        SearchQuery query = new SearchQuery();
        query.setQ(q);
        query.setType(type);
        query.setReqId(reqId);
        query.setVersionId(versionId);
        query.setStatus(status);
        query.setOwner(owner);
        query.setFrom(from);
        query.setTo(to);
        query.setLimit(limit == null ? 5 : limit);
        return ApiResult.ok(searchService.search(ws.getId(), userId, query));
    }
}
