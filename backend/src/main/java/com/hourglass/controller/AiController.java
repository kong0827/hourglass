package com.hourglass.controller;

import com.hourglass.common.ApiResult;
import com.hourglass.common.CurrentUser;
import com.hourglass.dto.AiApplyRequest;
import com.hourglass.dto.AiApplyResult;
import com.hourglass.dto.AiAuditResponse;
import com.hourglass.dto.AiCaseApplyRequest;
import com.hourglass.dto.AiConfigRequest;
import com.hourglass.dto.AiConfigView;
import com.hourglass.dto.AiInvestmentSummaryRequest;
import com.hourglass.dto.AiInvestmentSummaryResponse;
import com.hourglass.dto.AiReviewRequest;
import com.hourglass.dto.AiReviewResponse;
import com.hourglass.dto.AiSelectionRequest;
import com.hourglass.dto.AiSelectionResponse;
import com.hourglass.dto.AiSplitResponse;
import com.hourglass.dto.AiTestCaseRequest;
import com.hourglass.dto.AiTestCaseResponse;
import com.hourglass.dto.AiUsage;
import com.hourglass.entity.Workspace;
import com.hourglass.service.AiConfigService;
import com.hourglass.service.AiDemandSplitService;
import com.hourglass.service.AiInvestmentService;
import com.hourglass.service.AiReqDocService;
import com.hourglass.service.AiReviewService;
import com.hourglass.service.AiSelectionService;
import com.hourglass.service.AiTestCaseService;
import com.hourglass.service.AiUsageService;
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
import java.util.function.Function;
import java.util.function.Supplier;

/**
 * AI 辅助需求。
 *
 * <p>额度来源由 {@link AiConfigService} 统一解析：团队 AI → 空间 AI（预留）→ 个人 Key。
 * 同一个共享空间里，成员默认共用团队额度；选择「我的 API Key」的成员走自己的额度。
 *
 * <p>注意：拆需求/体检是**长请求**（模型生成通常 20-60 秒），
 * nginx 的 proxy_read_timeout 必须大于这个值，否则前端会拿到 504。
 */
@RestController
public class AiController {

    private final AiConfigService configService;
    private final AiReqDocService reqDocService;
    private final AiDemandSplitService demandSplitService;
    private final AiReviewService reviewService;
    private final AiTestCaseService testCaseService;
    private final AiInvestmentService investmentService;
    private final AiSelectionService selectionService;
    private final WorkspaceService workspaceService;
    private final AiUsageService usageService;

    public AiController(AiConfigService configService, AiReqDocService reqDocService,
                        AiDemandSplitService demandSplitService,
                        AiReviewService reviewService, AiTestCaseService testCaseService,
                        AiInvestmentService investmentService, AiSelectionService selectionService,
                        WorkspaceService workspaceService, AiUsageService usageService) {
        this.configService = configService;
        this.reqDocService = reqDocService;
        this.demandSplitService = demandSplitService;
        this.reviewService = reviewService;
        this.testCaseService = testCaseService;
        this.investmentService = investmentService;
        this.selectionService = selectionService;
        this.workspaceService = workspaceService;
        this.usageService = usageService;
    }

    /** 我的 AI 配置（key 只回掩码；带 workspace 用于解析团队 / 空间共享来源） */
    @GetMapping("/api/ai/config")
    public ApiResult<AiConfigView> getConfig(@RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(configService.view(userId, ws.getId()));
    }

    @PutMapping("/api/ai/config")
    public ApiResult<AiConfigView> saveConfig(@Valid @RequestBody AiConfigRequest req,
                                              @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(configService.save(userId, req, ws.getId()));
    }

    /** 用实际来源发一次极小请求，验证 key / 地址 / 模型名都对 */
    @PostMapping("/api/ai/config/test")
    public ApiResult<Map<String, Object>> testConfig(@RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(configService.test(userId, ws.getId()));
    }

    /** 把需求拆成任务草稿（不落库） */
    @PostMapping("/api/ai/reqdoc/{id}/split")
    public ApiResult<AiSplitResponse> split(@PathVariable String id,
                                            @RequestParam(required = false) Integer maxTasks,
                                            @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(run(ws.getId(), "feature:reqdoc_split",
                () -> reqDocService.split(userId, ws.getId(), id, maxTasks), AiSplitResponse::getUsage));
    }

    /** 把需求池需求拆成工作项草稿（不落库）；来源是需求描述 + 验收标准 */
    @PostMapping("/api/ai/demands/{id}/split")
    public ApiResult<AiSplitResponse> splitDemand(@PathVariable String id,
                                                  @RequestParam(required = false) Integer maxTasks,
                                                  @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(run(ws.getId(), "feature:demand_split",
                () -> demandSplitService.split(userId, ws.getId(), id, maxTasks), AiSplitResponse::getUsage));
    }

    /** 把勾选的需求拆分草稿创建成工作项（逐条处理，单条失败不影响其它） */
    @PostMapping("/api/ai/demands/{id}/tasks")
    public ApiResult<AiApplyResult> applyDemandTasks(@PathVariable String id,
                                                     @Valid @RequestBody AiApplyRequest req,
                                                     @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(demandSplitService.applyTasks(userId, ws.getId(), id, req.getTasks()));
    }

    /** 体检这个需求做完了没有 */
    @PostMapping("/api/ai/reqdoc/{id}/audit")
    public ApiResult<AiAuditResponse> audit(@PathVariable String id,
                                            @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(run(ws.getId(), "feature:reqdoc_audit",
                () -> reqDocService.audit(userId, ws.getId(), id), AiAuditResponse::getUsage));
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

    /**
     * 文档选区处理：改写 / 缩写 / 解释。
     *
     * <p>只返回建议，不写文档。用户点「替换」后由前端写回编辑器并走正常保存，
     * 保存时服务端自动留历史版本，可在「历史版本」里恢复。
     */
    @PostMapping("/api/ai/reqdoc/{id}/selection")
    public ApiResult<AiSelectionResponse> selection(@PathVariable String id,
                                                    @Valid @RequestBody AiSelectionRequest req,
                                                    @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(run(ws.getId(), "feature:selection",
                () -> selectionService.transform(userId, ws.getId(), id, req), AiSelectionResponse::getUsage));
    }

    /** 把选中的一段文字提为工作项草稿（不落库；勾选确认后复用创建接口） */
    @PostMapping("/api/ai/reqdoc/{id}/selection/tasks")
    public ApiResult<AiSplitResponse> selectionTasks(@PathVariable String id,
                                                     @Valid @RequestBody AiSelectionRequest req,
                                                     @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(run(ws.getId(), "feature:selection_tasks",
                () -> selectionService.tasks(userId, ws.getId(), id, req), AiSplitResponse::getUsage));
    }

    /** 从需求文档或需求池条目生成测试用例草稿（不落库） */
    @PostMapping("/api/ai/testcases/generate")
    public ApiResult<AiTestCaseResponse> generateCases(@Valid @RequestBody AiTestCaseRequest req,
                                                       @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(run(ws.getId(), "feature:testcase_gen",
                () -> testCaseService.generate(userId, ws.getId(), req), AiTestCaseResponse::getUsage));
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
        return ApiResult.ok(run(ws.getId(), "feature:weekly",
                () -> reviewService.polish(userId, ws.getId(), body.getWeekOffset(), body.getReqId(), body.getNote()),
                AiReviewResponse::getUsage));
    }

    /**
     * 把投入结构报表当前周期与筛选下的事实写成一份团队工作总结。
     * 只读、不落库：数字服务端算好，模型只引用，输出回给当前页面供导出。
     */
    @PostMapping("/api/ai/investment/summary")
    public ApiResult<AiInvestmentSummaryResponse> investmentSummary(
            @RequestBody(required = false) AiInvestmentSummaryRequest req,
            @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(run(ws.getId(), "feature:investment",
                () -> investmentService.summarize(userId, ws.getId(), req), AiInvestmentSummaryResponse::getUsage));
    }

    /** 统一计时并写入用量：失败也记一条，管理员能看到哪类能力出错 */
    private <T> T run(String wsId, String intent, Supplier<T> body, Function<T, AiUsage> usageOf) {
        long started = System.currentTimeMillis();
        try {
            T res = body.get();
            usageService.record(wsId, intent, usageOf.apply(res), true, System.currentTimeMillis() - started);
            return res;
        } catch (RuntimeException e) {
            usageService.record(wsId, intent, null, false, System.currentTimeMillis() - started);
            throw e;
        }
    }
}
