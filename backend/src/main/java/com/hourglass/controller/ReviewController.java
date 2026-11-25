package com.hourglass.controller;

import com.hourglass.common.ApiResult;
import com.hourglass.common.CurrentUser;
import com.hourglass.dto.ReviewHourLogPage;
import com.hourglass.dto.ReviewTeamDetailPage;
import com.hourglass.entity.Workspace;
import com.hourglass.service.ReviewService;
import com.hourglass.service.ReviewTeamService;
import com.hourglass.service.WorkspaceService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class ReviewController {

    private final ReviewService reviewService;
    private final ReviewTeamService reviewTeamService;
    private final WorkspaceService workspaceService;

    public ReviewController(ReviewService reviewService, ReviewTeamService reviewTeamService,
                            WorkspaceService workspaceService) {
        this.reviewService = reviewService;
        this.reviewTeamService = reviewTeamService;
        this.workspaceService = workspaceService;
    }

    /**
     * 工作回顾：weekOffset 不传时自动选最近一个有完成记录的周；reqId 非空时只看该项目。
     * scope=mine（默认）是个人回顾；scope=team 需要空间主 / 管理员，role 只过滤成员类明细。
     */
    @GetMapping("/api/review")
    public ApiResult<?> review(@RequestParam(required = false) String workspace,
                               @RequestParam(required = false) Integer weekOffset,
                               @RequestParam(required = false) String reqId,
                               @RequestParam(required = false) Boolean mine,
                               @RequestParam(required = false) String scope,
                               @RequestParam(required = false) String role) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        if ("team".equals(scope)) {
            return ApiResult.ok(reviewTeamService.team(ws.getId(), userId, reqId, weekOffset, role));
        }
        boolean personal = !Boolean.FALSE.equals(mine);
        return ApiResult.ok(reviewService.review(ws.getId(), userId, reqId, weekOffset, personal));
    }

    /** 团队统计矩阵子项的就地展开：只回传前 limit 条，total 为同口径总数。 */
    @GetMapping("/api/review/team/detail")
    public ApiResult<ReviewTeamDetailPage> teamDetail(@RequestParam(required = false) String workspace,
                                                      @RequestParam(required = false) Integer weekOffset,
                                                      @RequestParam(required = false) String reqId,
                                                      @RequestParam String key,
                                                      @RequestParam(required = false) Integer limit) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(reviewTeamService.detail(ws.getId(), userId, reqId, weekOffset, key, limit));
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
