package com.hourglass.controller;

import com.hourglass.common.ApiResult;
import com.hourglass.common.CurrentUser;
import com.hourglass.dto.AiApplyRequest;
import com.hourglass.dto.AiApplyResult;
import com.hourglass.dto.AiAuditResponse;
import com.hourglass.dto.AiCaseApplyRequest;
import com.hourglass.dto.AiConfigRequest;
import com.hourglass.dto.AiConfigView;
import com.hourglass.dto.AiReviewRequest;
import com.hourglass.dto.AiReviewResponse;
import com.hourglass.dto.AiSplitResponse;
import com.hourglass.dto.AiTestCaseRequest;
import com.hourglass.dto.AiTestCaseResponse;
import com.hourglass.entity.Workspace;
import com.hourglass.service.AiConfigService;
import com.hourglass.service.AiReqDocService;
import com.hourglass.service.AiReviewService;
import com.hourglass.service.AiTestCaseService;
import com.hourglass.service.WorkspaceService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import javax.validation.Valid;
import java.util.Map;

/**
 * AI 辅助需求。
 *
 * <p>额度按账号走：每个调用都用 {@code CurrentUser.id()} 对应的配置，
 * 同一个共享空间里两个人的 AI 调用互不影响、互不记账。
 *
 * <p>注意：拆需求/体检是**长请求**（模型生成通常 20-60 秒），
 * nginx 的 proxy_read_timeout 必须大于这个值，否则前端会拿到 504。
 */
@RestController
public class AiController {

    private final AiConfigService configService;
    private final AiReqDocService reqDocService;
    private final AiReviewService reviewService;
    private final AiTestCaseService testCaseService;
    private final WorkspaceService workspaceService;

    public AiController(AiConfigService configService, AiReqDocService reqDocService,
                        AiReviewService reviewService, AiTestCaseService testCaseService,
                        WorkspaceService workspaceService) {
        this.configService = configService;
        this.reqDocService = reqDocService;
        this.reviewService = reviewService;
        this.testCaseService = testCaseService;
        this.workspaceService = workspaceService;
    }

    /** 我的 AI 配置（key 只回掩码） */
    @GetMapping("/api/ai/config")
    public ApiResult<AiConfigView> getConfig() {
        return ApiResult.ok(configService.view(CurrentUser.id()));
    }

    @PutMapping("/api/ai/config")
    public ApiResult<AiConfigView> saveConfig(@Valid @RequestBody AiConfigRequest req) {
        return ApiResult.ok(configService.save(CurrentUser.id(), req));
    }

    /** 用已保存的配置发一次极小请求，验证 key / 地址 / 模型名都对 */
    @PostMapping("/api/ai/config/test")
    public ApiResult<Map<String, Object>> testConfig() {
        return ApiResult.ok(configService.test(CurrentUser.id()));
    }

    /** 把需求拆成任务草稿（不落库） */
    @PostMapping("/api/ai/reqdoc/{id}/split")
    public ApiResult<AiSplitResponse> split(@PathVariable String id,
                                            @RequestParam(required = false) Integer maxTasks,
                                            @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(reqDocService.split(userId, ws.getId(), id, maxTasks));
    }

    /** 体检这个需求做完了没有 */
    @PostMapping("/api/ai/reqdoc/{id}/audit")
    public ApiResult<AiAuditResponse> audit(@PathVariable String id,
                                            @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(reqDocService.audit(userId, ws.getId(), id));
    }

    /** 把勾选的草稿创建成任务（逐条处理，单条失败不影响其它） */
    @PostMapping("/api/ai/reqdoc/{id}/tasks")
    public ApiResult<AiApplyResult> apply(@PathVariable String id,
                                          @Valid @RequestBody AiApplyRequest req,
                                          @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(reqDocService.applyTasks(userId, ws.getId(), id, req.getTasks()));
    }

    /** 从需求文档或需求池条目生成测试用例草稿（不落库） */
    @PostMapping("/api/ai/testcases/generate")
    public ApiResult<AiTestCaseResponse> generateCases(@Valid @RequestBody AiTestCaseRequest req,
                                                       @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(testCaseService.generate(userId, ws.getId(), req));
    }

    /** 把勾选的用例草稿创建成正式用例（逐条处理，同名跳过） */
    @PostMapping("/api/ai/testcases/apply")
    public ApiResult<AiApplyResult> applyCases(@Valid @RequestBody AiCaseApplyRequest req,
                                               @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(testCaseService.applyCases(userId, ws.getId(), req));
    }

    /**
     * 把某一周的回顾数据润色成一份可以直接发出去的周报。
     *
     * <p>不改任何数据、不落库：输出只回给当前这个页面，用户复制走就结束。
     * 所以不需要 SSE 广播（{@code ChangeBroadcastFilter} 会因为请求里没有写操作而不触发）。
     */
    @PostMapping("/api/ai/review/polish")
    public ApiResult<AiReviewResponse> polishReview(@RequestBody(required = false) AiReviewRequest req,
                                                    @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        AiReviewRequest body = req == null ? new AiReviewRequest() : req;
        return ApiResult.ok(reviewService.polish(userId, ws.getId(), body.getWeekOffset(), body.getReqId(), body.getNote()));
    }
}
