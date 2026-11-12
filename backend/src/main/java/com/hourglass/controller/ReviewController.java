package com.hourglass.controller;

import com.hourglass.common.ApiResult;
import com.hourglass.common.CurrentUser;
import com.hourglass.dto.ReviewHourLogPage;
import com.hourglass.dto.ReviewResponse;
import com.hourglass.entity.Workspace;
import com.hourglass.service.ReviewService;
import com.hourglass.service.WorkspaceService;
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

    /** 工作回顾：weekOffset 不传时自动选最近一个有完成记录的周；reqId 非空时只看该项目 */
    @GetMapping("/api/review")
    public ApiResult<ReviewResponse> review(@RequestParam(required = false) String workspace,
                                            @RequestParam(required = false) Integer weekOffset,
                                            @RequestParam(required = false) String reqId) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(reviewService.review(ws.getId(), userId, reqId, weekOffset));
    }

    /** 工时下钻：与 /api/review 的 workMinutes 同口径；mine=true 只看自己，分页最多 100 条 */
    @GetMapping("/api/review/hour-logs")
    public ApiResult<ReviewHourLogPage> hourLogs(@RequestParam(required = false) String workspace,
                                                 @RequestParam(required = false) Integer weekOffset,
                                                 @RequestParam(required = false) String reqId,
                                                 @RequestParam(required = false) Boolean mine,
                                                 @RequestParam(required = false) Integer offset,
                                                 @RequestParam(required = false) Integer limit) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(reviewService.hourLogs(ws.getId(), userId, reqId, weekOffset,
                Boolean.TRUE.equals(mine), offset == null ? 0 : offset, limit == null ? 0 : limit));
    }
}
