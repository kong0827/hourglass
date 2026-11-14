package com.hourglass.controller;

import com.hourglass.common.ApiResult;
import com.hourglass.common.CurrentUser;
import com.hourglass.dto.CaseDefectRequest;
import com.hourglass.dto.CaseQuery;
import com.hourglass.dto.CaseRunRequest;
import com.hourglass.dto.CaseRunView;
import com.hourglass.dto.CaseStatsView;
import com.hourglass.dto.EntityTimelineItem;
import com.hourglass.dto.TestCasePage;
import com.hourglass.dto.TestCaseBatchRequest;
import com.hourglass.dto.TestCaseSaveRequest;
import com.hourglass.dto.TestCaseView;
import com.hourglass.entity.Attachment;
import com.hourglass.entity.Task;
import com.hourglass.entity.TestCase;
import com.hourglass.entity.TestCaseRun;
import com.hourglass.entity.Workspace;
import com.hourglass.service.TestCaseService;
import com.hourglass.service.WorkspaceService;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.ModelAttribute;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

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

    /**
     * 项目用例分页列表：筛选 / 排序 / 分页都在服务端，含最近执行结果与转出缺陷标题。
     * 查询参数按 CaseQuery 字段名绑定（bugOnly / searchWide / moduleId / moduleSub / demandId / setId / sort / sortDir）。
     */
    @GetMapping("/api/test-cases")
    public ApiResult<TestCasePage> list(@ModelAttribute CaseQuery query,
                                        @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(caseService.page(ws.getId(), userId, query));
    }

    /** 分组段头：当前筛选范围内按维度聚合条数与结果分布（零用例的段也返回，便于发现覆盖缺口） */
    @GetMapping("/api/test-cases/groups")
    public ApiResult<List<com.hourglass.dto.CaseGroupCount>> groups(@ModelAttribute CaseQuery query,
                                                                    @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(caseService.groups(ws.getId(), userId, query));
    }

    /** 项目用例执行概览（总数/通过/失败/阻塞/未执行） */
    @GetMapping("/api/test-cases/stats")
    public ApiResult<CaseStatsView> stats(@RequestParam String reqId,
                                          @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(caseService.stats(ws.getId(), userId, reqId));
    }

    /** 执行流水聚合：按执行人 / 环境 / 轮次的结果分布与通过率 */
    @GetMapping("/api/test-cases/run-stats")
    public ApiResult<com.hourglass.dto.CaseRunStatsView> runStats(@RequestParam String reqId,
                                                                 @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(caseService.runStats(ws.getId(), userId, reqId));
    }

    /** 执行统计下钻：某桶（执行人 / 环境 / 轮次）内的执行流水明细 */
    @GetMapping("/api/test-cases/run-stats/drill")
    public ApiResult<List<com.hourglass.dto.CaseRunDrillRow>> runStatsDrill(@RequestParam String reqId,
                                                                           @RequestParam String dim,
                                                                           @RequestParam String key,
                                                                           @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(caseService.runDrill(ws.getId(), userId, reqId, dim, key));
    }

    /** 需求—用例—缺陷覆盖矩阵 */
    @GetMapping("/api/test-cases/coverage")
    public ApiResult<List<com.hourglass.dto.CaseCoverageRow>> coverage(@RequestParam(required = false) String reqId,
                                                                       @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(caseService.coverage(ws.getId(), userId, reqId));
    }

    /** 用例编辑器的工作项候选：必须先有主需求，只返回该需求下的工作项 */
    @GetMapping("/api/test-cases/task-options")
    public ApiResult<List<com.hourglass.dto.CaseTaskLink>> taskOptions(@RequestParam String reqId,
                                                                       @RequestParam String demandId,
                                                                       @RequestParam(required = false) String q,
                                                                       @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(caseService.taskOptions(ws.getId(), userId, reqId, demandId, q));
    }

    /** 工作项级覆盖：需求详情用它回答「哪项工作项有验证用例」 */
    @GetMapping("/api/test-cases/task-coverage")
    public ApiResult<List<com.hourglass.dto.TaskCoverageRow>> taskCoverage(@RequestParam String demandId,
                                                                           @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(caseService.taskCoverage(ws.getId(), userId, demandId));
    }

    /** 缺陷 tab：反查执行流水记录过的缺陷任务 → 用例 */
    @GetMapping("/api/test-cases/linked-bugs")
    public ApiResult<List<com.hourglass.dto.CaseBugLink>> linkedBugs(@RequestParam(required = false) String reqId,
                                                                    @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(caseService.linkedBugs(ws.getId(), userId, reqId));
    }

    /** 缺陷详情：反查来源用例（跨项目，只返回可见项目的用例） */
    @GetMapping("/api/test-cases/by-bug/{taskId}")
    public ApiResult<List<com.hourglass.dto.CaseBugLink>> byBugTask(@PathVariable String taskId,
                                                                   @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(caseService.byBugTask(ws.getId(), userId, taskId));
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

    /** 批量设置目录归属 / 优先级：范围支持勾选或「全选筛选结果」 */
    @PutMapping("/api/test-cases/batch")
    public ApiResult<java.util.Map<String, Object>> batchUpdate(@Valid @RequestBody TestCaseBatchRequest req,
                                                                @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(caseService.batchUpdate(userId, ws.getId(), req));
    }

    /** 批量删除（执行流水、计划圈选、分组成员与证据一并清理） */
    @PostMapping("/api/test-cases/batch-delete")
    public ApiResult<java.util.Map<String, Object>> batchDelete(@Valid @RequestBody TestCaseBatchRequest req,
                                                                @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(caseService.batchDelete(userId, ws.getId(), req));
    }

    /** 拖拽归类：目录单归属，移动即从原节点移出；返回移动前归属供撤销 */
    @PostMapping("/api/test-cases/move-module")
    public ApiResult<java.util.Map<String, Object>> moveModule(@Valid @RequestBody com.hourglass.dto.CaseMoveRequest req,
                                                               @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(caseService.moveModule(userId, ws.getId(), req));
    }

    /** 撤销归类：一次事务恢复到移动前的目录归属 */
    @PostMapping("/api/test-cases/restore-module")
    public ApiResult<java.util.Map<String, Object>> restoreModule(@Valid @RequestBody com.hourglass.dto.CaseRestoreRequest req,
                                                                  @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(caseService.restoreModule(userId, ws.getId(), req));
    }

    /** 记录一次执行结果（passed / failed / blocked） */
    @PostMapping("/api/test-cases/{id}/runs")
    public ApiResult<TestCaseRun> run(@PathVariable String id,
                                      @Valid @RequestBody CaseRunRequest req,
                                      @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(caseService.run(userId, ws.getId(), id, req));
    }

    /** 执行历史与失败证据（最近在前） */
    @GetMapping("/api/test-cases/{id}/runs")
    public ApiResult<com.hourglass.dto.PageResult<CaseRunView>> runs(
            @PathVariable String id,
            @RequestParam(required = false) Integer offset,
            @RequestParam(required = false) Integer limit,
            @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(caseService.runs(ws.getId(), userId, id,
                offset == null ? 0 : offset, limit == null ? 30 : limit));
    }

    /** 变更记录（最近在前）：新建/编辑/删除等留痕，执行结果另见 runs */
    @GetMapping("/api/test-cases/{id}/timeline")
    public ApiResult<List<EntityTimelineItem>> timeline(@PathVariable String id,
                                                        @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(caseService.timeline(ws.getId(), userId, id));
    }

    /** 上传失败证据（截图/日志/录屏文件），挂在本轮执行记录下 */
    @PostMapping("/api/test-cases/{id}/runs/{runId}/attachments")
    public ApiResult<Attachment> uploadEvidence(@PathVariable String id,
                                                @PathVariable String runId,
                                                @RequestParam("file") MultipartFile file,
                                                @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(caseService.uploadEvidence(userId, ws.getId(), id, runId, file));
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

    /* ==================== CSV 导入导出（A3 存量迁移） ==================== */

    /** 导入模板（表头 + 示例行，UTF-8 BOM，Excel 直接打开） */
    @GetMapping("/api/test-cases/template.csv")
    public org.springframework.http.ResponseEntity<byte[]> templateCsv() {
        return csvResponse(caseService.templateCsv(), "test-case-template.csv");
    }

    /** 导出：scope=all（项目全部，默认）/ filter（当前筛选，含未加载行）/ ids（勾选的行） */
    @GetMapping("/api/test-cases/export.csv")
    public org.springframework.http.ResponseEntity<byte[]> exportCsv(@ModelAttribute CaseQuery query,
                                                                     @RequestParam(required = false) String workspace,
                                                                     @RequestParam(required = false) String scope,
                                                                     @RequestParam(required = false) List<String> ids) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        if ("ids".equals(scope)) {
            return csvResponse(caseService.exportCsvByIds(ws.getId(), userId, ids), "test-cases-selected.csv");
        }
        if ("filter".equals(scope)) {
            return csvResponse(caseService.exportCsvByFilter(ws.getId(), userId, query), "test-cases-filtered.csv");
        }
        return csvResponse(caseService.exportCsv(ws.getId(), userId, query.getReqId()), "test-cases.csv");
    }

    /** 导入用例（整份 CSV 文本），逐行创建，单行失败不影响其余行 */
    @PostMapping("/api/test-cases/import")
    public ApiResult<java.util.Map<String, Object>> importCsv(@RequestBody java.util.Map<String, String> body,
                                                              @RequestParam String reqId,
                                                              @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        String csv = body == null ? null : body.get("csv");
        if (csv == null || csv.trim().isEmpty()) {
            throw new com.hourglass.common.AppException(400, "导入内容为空");
        }
        if (csv.length() > 2_000_000) {
            throw new com.hourglass.common.AppException(400, "导入内容过大（约 2MB 上限），请拆分文件");
        }
        return ApiResult.ok(caseService.importCsv(userId, ws.getId(), reqId, csv));
    }

    private static org.springframework.http.ResponseEntity<byte[]> csvResponse(byte[] body, String filename) {
        return org.springframework.http.ResponseEntity.ok()
                .header(org.springframework.http.HttpHeaders.CONTENT_DISPOSITION,
                        "attachment; filename=\"" + filename + "\"")
                .contentType(new org.springframework.http.MediaType("text", "csv", java.nio.charset.StandardCharsets.UTF_8))
                .body(body);
    }
}
