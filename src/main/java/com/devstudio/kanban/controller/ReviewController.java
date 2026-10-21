package com.devstudio.kanban.controller;

import com.devstudio.kanban.common.ApiResult;
import com.devstudio.kanban.common.CurrentUser;
import com.devstudio.kanban.dto.ReviewResponse;
import com.devstudio.kanban.entity.Workspace;
import com.devstudio.kanban.service.ReviewService;
import com.devstudio.kanban.service.WorkspaceService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class ReviewController {

    private final ReviewService reviewService;
    private final WorkspaceService workspaceService;

    public ReviewController(ReviewService reviewService, WorkspaceService workspaceService) {
        this.reviewService = reviewService;
        this.workspaceService = workspaceService;
    }

    /** 工作回顾：weekOffset 不传时自动选最近一个有完成记录的周 */
    @GetMapping("/api/review")
    public ApiResult<ReviewResponse> review(@RequestParam(required = false) String workspace,
                                            @RequestParam(required = false) Integer weekOffset) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(reviewService.review(ws.getId(), userId, weekOffset));
    }
}
