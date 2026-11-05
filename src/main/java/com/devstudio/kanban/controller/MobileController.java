package com.devstudio.kanban.controller;

import com.devstudio.kanban.common.ApiResult;
import com.devstudio.kanban.common.CurrentWorkspace;
import com.devstudio.kanban.config.WorkspaceCtx;
import com.devstudio.kanban.service.MobileService;
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

    @GetMapping("/workload")
    public ApiResult<Map<String, Object>> workload(@CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(mobileService.workload(ctx.getWsId(), ctx.getUserId()));
    }

    @GetMapping("/risks")
    public ApiResult<Map<String, Object>> risks(@RequestParam(required = false) String type,
                                                @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(mobileService.risks(ctx.getWsId(), ctx.getUserId(), type));
    }
}
