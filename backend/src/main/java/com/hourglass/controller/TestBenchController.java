package com.hourglass.controller;

import com.hourglass.common.ApiResult;
import com.hourglass.config.WorkspaceCtx;
import com.hourglass.common.CurrentWorkspace;
import com.hourglass.service.TestBenchService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * 测试工作台汇总：流程条 / 新手任务清单 / 我的待办 / 进行中与最近完成计划的一次性取数。
 * 聚合只含当前用户可见且未归档的项目。
 */
@RestController
public class TestBenchController {

    private final TestBenchService benchService;

    public TestBenchController(TestBenchService benchService) {
        this.benchService = benchService;
    }

    @GetMapping("/api/test-bench/summary")
    public ApiResult<Map<String, Object>> summary(@CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(benchService.summary(ctx.getWsId(), ctx.getUserId()));
    }
}
