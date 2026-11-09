package com.hourglass.controller;

import com.hourglass.common.ApiResult;
import com.hourglass.common.CurrentWorkspace;
import com.hourglass.config.WorkspaceCtx;
import com.hourglass.service.MobileService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/** 手机端团队只读聚合：概览、成员负载、风险。 */
@RestController
@RequestMapping("/api/mobile")
public class MobileController {

    private final MobileService mobileService;

    public MobileController(MobileService mobileService) {
        this.mobileService = mobileService;
    }

    @GetMapping("/team-overview")
    public ApiResult<Map<String, Object>> teamOverview(@RequestParam(required = false) String from,
                                                       @RequestParam(required = false) String to,
                                                       @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(mobileService.teamOverview(ctx.getWsId(), ctx.getUserId(), from, to));
    }

    /** 成员负载：from/to 为统计区间（团队视图的本周、本月、近 30 天）；缺省回落到截至今天的最近 7 天，与团队概览同口径 */
    @GetMapping("/workload")
    public ApiResult<Map<String, Object>> workload(@RequestParam(required = false) String from,
                                                   @RequestParam(required = false) String to,
                                                   @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(mobileService.workload(ctx.getWsId(), ctx.getUserId(), from, to));
    }

    @GetMapping("/risks")
    public ApiResult<Map<String, Object>> risks(@RequestParam(required = false) String type,
                                                @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(mobileService.risks(ctx.getWsId(), ctx.getUserId(), type));
    }
}
