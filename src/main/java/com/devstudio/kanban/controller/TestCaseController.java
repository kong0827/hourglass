package com.devstudio.kanban.controller;

import com.devstudio.kanban.common.ApiResult;
import com.devstudio.kanban.common.CurrentUser;
import com.devstudio.kanban.dto.CaseDefectRequest;
import com.devstudio.kanban.dto.CaseRunRequest;
import com.devstudio.kanban.dto.CaseStatsView;
import com.devstudio.kanban.dto.TestCaseSaveRequest;
import com.devstudio.kanban.dto.TestCaseView;
import com.devstudio.kanban.entity.Task;
import com.devstudio.kanban.entity.TestCase;
import com.devstudio.kanban.entity.Workspace;
import com.devstudio.kanban.service.TestCaseService;
import com.devstudio.kanban.service.WorkspaceService;
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

/**
 * 测试用例。
 * 层级：空间 → 项目(/api/reqs) → 用例(/api/test-cases) → 缺陷任务(task)。
 */
@RestController
public class TestCaseController {

    private final TestCaseService caseService;
    private final WorkspaceService workspaceService;

    public TestCaseController(TestCaseService caseService, WorkspaceService workspaceService) {
        this.caseService = caseService;
        this.workspaceService = workspaceService;
    }

    /** 项目用例列表（含最近执行结果与转出缺陷标题） */
    @GetMapping("/api/test-cases")
    public ApiResult<List<TestCaseView>> list(@RequestParam String reqId,
                                              @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(caseService.list(ws.getId(), userId, reqId));
    }

    /** 项目用例执行概览（总数/通过/失败/阻塞/未执行） */
    @GetMapping("/api/test-cases/stats")
    public ApiResult<CaseStatsView> stats(@RequestParam String reqId,
                                          @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(caseService.stats(ws.getId(), userId, reqId));
    }

    @PostMapping("/api/test-cases")
    public ApiResult<TestCase> create(@Valid @RequestBody TestCaseSaveRequest req,
                                      @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(caseService.create(userId, ws.getId(), req));
    }

    @PutMapping("/api/test-cases/{id}")
    public ApiResult<TestCase> update(@PathVariable String id,
                                      @Valid @RequestBody TestCaseSaveRequest req,
                                      @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(caseService.update(userId, ws.getId(), id, req));
    }

    @DeleteMapping("/api/test-cases/{id}")
    public ApiResult<Void> delete(@PathVariable String id,
                                  @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        caseService.delete(userId, ws.getId(), id);
        return ApiResult.ok(null);
    }

    /** 记录一次执行结果（passed / failed / blocked） */
    @PostMapping("/api/test-cases/{id}/runs")
    public ApiResult<TestCase> run(@PathVariable String id,
                                   @Valid @RequestBody CaseRunRequest req,
                                   @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(caseService.run(userId, ws.getId(), id, req));
    }

    /** 执行失败转出缺陷（生成 bug 任务，回填用例缺陷引用） */
    @PostMapping("/api/test-cases/{id}/defect")
    public ApiResult<Task> fileDefect(@PathVariable String id,
                                      @Valid @RequestBody CaseDefectRequest req,
                                      @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(caseService.fileDefect(userId, ws.getId(), id, req));
    }
}
