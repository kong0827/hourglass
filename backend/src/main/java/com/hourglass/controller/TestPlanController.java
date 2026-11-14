package com.hourglass.controller;

import com.hourglass.common.ApiResult;
import com.hourglass.common.CurrentUser;
import com.hourglass.dto.PageResult;
import com.hourglass.dto.PlanBatchRequest;
import com.hourglass.dto.TestPlanSaveRequest;
import com.hourglass.dto.TestPlanView;
import com.hourglass.entity.Workspace;
import com.hourglass.service.TestPlanService;
import com.hourglass.service.WorkspaceService;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import javax.validation.Valid;
import java.util.List;
import java.util.Map;

/**
 * 测试计划（A2 测试最小闭环）。
 * 层级：空间 → 项目(/api/reqs) → 计划(/api/test-plans) → 圈选用例 → 批量执行。
 */
@RestController
public class TestPlanController {

    private final TestPlanService planService;
    private final WorkspaceService workspaceService;

    public TestPlanController(TestPlanService planService, WorkspaceService workspaceService) {
        this.planService = planService;
        this.workspaceService = workspaceService;
    }

    @GetMapping("/api/test-plans")
    public ApiResult<PageResult<TestPlanView>> list(@RequestParam String reqId,
                                                    @RequestParam(required = false) String workspace,
                                                    @RequestParam(required = false) Integer offset,
                                                    @RequestParam(required = false) Integer limit) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(planService.page(ws.getId(), userId, reqId,
                offset == null ? 0 : offset, limit == null ? 100 : limit));
    }

    /** 计划详情：plan + passRate；用例行通过 cases 分页接口读取 */
    @GetMapping("/api/test-plans/{id}")
    public ApiResult<Map<String, Object>> detail(@PathVariable String id,
                                                 @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(planService.detail(ws.getId(), userId, id));
    }

    @GetMapping("/api/test-plans/{id}/cases")
    public ApiResult<PageResult<com.hourglass.dto.TestPlanCaseView>> cases(
            @PathVariable String id,
            @RequestParam(required = false) String workspace,
            @RequestParam(required = false) Integer offset,
            @RequestParam(required = false) Integer limit) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(planService.cases(ws.getId(), userId, id,
                offset == null ? 0 : offset, limit == null ? 100 : limit));
    }

    @PostMapping("/api/test-plans")
    public ApiResult<TestPlanView> create(@Valid @RequestBody TestPlanSaveRequest req,
                                          @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(planService.create(userId, ws.getId(), req));
    }

    @PutMapping("/api/test-plans/{id}")
    public ApiResult<TestPlanView> update(@PathVariable String id,
                                          @Valid @RequestBody TestPlanSaveRequest req,
                                          @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(planService.update(userId, ws.getId(), id, req));
    }

    /** 状态流转：draft/running/done */
    @PutMapping("/api/test-plans/{id}/status")
    public ApiResult<TestPlanView> setStatus(@PathVariable String id,
                                             @RequestParam String status,
                                             @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(planService.setStatus(userId, ws.getId(), id, status));
    }

    @DeleteMapping("/api/test-plans/{id}")
    public ApiResult<Void> delete(@PathVariable String id,
                                  @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        planService.delete(userId, ws.getId(), id);
        return ApiResult.ok(null);
    }

    /** 圈选用例加入计划（已在计划内的静默跳过，返回实际新增数） */
    @PostMapping("/api/test-plans/{id}/cases")
    public ApiResult<Integer> addCases(@PathVariable String id,
                                       @Valid @RequestBody PlanBatchRequest req,
                                       @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(planService.addCases(userId, ws.getId(), id, req));
    }

    @DeleteMapping("/api/test-plans/{id}/cases/{caseId}")
    public ApiResult<Void> removeCase(@PathVariable String id,
                                      @PathVariable String caseId,
                                      @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        planService.removeCase(userId, ws.getId(), id, caseId);
        return ApiResult.ok(null);
    }

    /** 发布必测：逐条切换，发布检查据此判断必测用例是否通过 */
    @PutMapping("/api/test-plans/{id}/cases/{caseId}/required")
    public ApiResult<Void> setRequired(@PathVariable String id,
                                       @PathVariable String caseId,
                                       @RequestParam boolean required,
                                       @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        planService.setRequired(userId, ws.getId(), id, caseId, required);
        return ApiResult.ok(null);
    }

    /** 批量执行：一次录入多例结果（status=passed/failed/blocked），流水带计划归属 */
    @PostMapping("/api/test-plans/{id}/runs")
    public ApiResult<Integer> batchRun(@PathVariable String id,
                                       @Valid @RequestBody PlanBatchRequest req,
                                       @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(planService.batchRun(userId, ws.getId(), id, req));
    }
}
