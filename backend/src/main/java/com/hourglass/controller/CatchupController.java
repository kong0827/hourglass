package com.hourglass.controller;

import com.hourglass.common.ApiResult;
import com.hourglass.config.WorkspaceCtx;
import com.hourglass.common.CurrentWorkspace;
import com.hourglass.dto.CatchupDecisionRequest;
import com.hourglass.dto.CatchupTimeRequest;
import com.hourglass.dto.CatchupView;
import com.hourglass.service.CatchupService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/** 周五补记：本周草稿、逐条确认、工时归属、提交与 5 分钟撤销。 */
@RestController
public class CatchupController {

    private final CatchupService catchupService;

    public CatchupController(CatchupService catchupService) {
        this.catchupService = catchupService;
    }

    /** 补记页数据；week 传本周任意一天，服务端归一到周一 */
    @GetMapping("/api/catchup")
    public ApiResult<CatchupView> view(@RequestParam(required = false) String week,
                                       @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(catchupService.view(ctx.getWsId(), ctx.getUserId(), week));
    }

    /** 「我的工作」入口卡片 */
    @GetMapping("/api/catchup/entry")
    public ApiResult<Map<String, Object>> entry(@CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(catchupService.entry(ctx.getWsId(), ctx.getUserId()));
    }

    /** 开始补记（记录计时起点） */
    @PostMapping("/api/catchup/start")
    public ApiResult<CatchupView> start(@RequestParam(required = false) String week,
                                        @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(catchupService.start(ctx.getWsId(), ctx.getUserId(), week));
    }

    /** 工作项或风险的逐条决策 */
    @PostMapping("/api/catchup/decisions")
    public ApiResult<CatchupView> decide(@RequestBody CatchupDecisionRequest req,
                                         @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(catchupService.decide(ctx.getWsId(), ctx.getUserId(), req));
    }

    /** 工时归属整张周网格保存 */
    @PostMapping("/api/catchup/time")
    public ApiResult<CatchupView> saveTime(@RequestBody CatchupTimeRequest req,
                                           @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(catchupService.saveTime(ctx.getWsId(), ctx.getUserId(), req));
    }

    /** 确认本周无其他已知风险 */
    @PostMapping("/api/catchup/no-other-risk")
    public ApiResult<CatchupView> noOtherRisk(@RequestParam(required = false) String week,
                                              @RequestParam boolean value,
                                              @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(catchupService.setNoOtherRisk(ctx.getWsId(), ctx.getUserId(), week, value));
    }

    @PostMapping("/api/catchup/submit")
    public ApiResult<CatchupView> submit(@RequestParam(required = false) String week,
                                         @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(catchupService.submit(ctx.getWsId(), ctx.getUserId(), week));
    }

    @PostMapping("/api/catchup/undo")
    public ApiResult<CatchupView> undo(@RequestParam(required = false) String week,
                                       @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(catchupService.undo(ctx.getWsId(), ctx.getUserId(), week));
    }

    @PostMapping("/api/catchup/skip")
    public ApiResult<CatchupView> skip(@RequestParam(required = false) String week,
                                       @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(catchupService.skip(ctx.getWsId(), ctx.getUserId(), week));
    }
}
