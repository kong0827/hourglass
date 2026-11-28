package com.hourglass.controller;

import com.hourglass.common.ApiResult;
import com.hourglass.common.CurrentUser;
import com.hourglass.dto.AiReleaseSummaryRequest;
import com.hourglass.dto.AiReleaseSummaryResponse;
import com.hourglass.entity.Workspace;
import com.hourglass.service.AiReleaseSummaryService;
import com.hourglass.service.AiUsageService;
import com.hourglass.service.WorkspaceService;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import javax.validation.Valid;

/**
 * 发布说明 / 变更摘要：以交付说明的系统事实为依据，生成可编辑的 Markdown 草稿。
 *
 * <p>只返回草稿：不落库、不写快照、不改交付说明；是否采用、怎么改由用户决定。
 * 用量记入 ai_usage_daily（feature:release_summary），管理员可看到该入口的花费。
 */
@RestController
public class AiReleaseSummaryController {

    private final AiReleaseSummaryService summaryService;
    private final WorkspaceService workspaceService;
    private final AiUsageService usageService;

    public AiReleaseSummaryController(AiReleaseSummaryService summaryService,
                                      WorkspaceService workspaceService,
                                      AiUsageService usageService) {
        this.summaryService = summaryService;
        this.workspaceService = workspaceService;
        this.usageService = usageService;
    }

    @PostMapping("/api/ai/release-summary")
    public ApiResult<AiReleaseSummaryResponse> generate(@Valid @RequestBody AiReleaseSummaryRequest req,
                                                        @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        long started = System.currentTimeMillis();
        try {
            AiReleaseSummaryResponse res = summaryService.generate(userId, ws.getId(), req);
            usageService.record(ws.getId(), "feature:release_summary", res.getUsage(), true,
                    System.currentTimeMillis() - started);
            return ApiResult.ok(res);
        } catch (RuntimeException e) {
            usageService.record(ws.getId(), "feature:release_summary", null, false,
                    System.currentTimeMillis() - started);
            throw e;
        }
    }
}
