package com.hourglass.controller;

import com.hourglass.common.ApiResult;
import com.hourglass.common.CurrentUser;
import com.hourglass.dto.CaseDefectRequest;
import com.hourglass.dto.CaseQuery;
import com.hourglass.dto.CaseRunRequest;
import com.hourglass.dto.CaseRunView;
import com.hourglass.dto.CaseStatsView;
import com.hourglass.dto.TestCasePage;
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

    /** 项目用例分页列表（筛选/排序/分页在服务端，含最近执行结果与转出缺陷标题） */
    @GetMapping("/api/test-cases")
    public ApiResult<TestCasePage> list(@RequestParam String reqId,
                                        @RequestParam(required = false) String workspace,
                                        @RequestParam(required = false) String status,
                                        @RequestParam(required = false) String module,
                                        @RequestParam(required = false) String pri,
                                        @RequestParam(required = false) String owner,
                                        @RequestParam(required = false) Boolean bug,
                                        @RequestParam(required = false) String q,
                                        @RequestParam(required = false) Integer offset,
                                        @RequestParam(required = false) Integer limit) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        CaseQuery query = new CaseQuery();
        query.setReqId(reqId);
        query.setStatus(status);
        query.setModule(module);
        query.setPri(pri);
        query.setOwner(owner);
        query.setBugOnly(Boolean.TRUE.equals(bug));
        query.setQ(q);
        query.setOffset(offset == null ? 0 : offset);
        query.setLimit(limit == null ? 100 : limit);
        return ApiResult.ok(caseService.page(ws.getId(), userId, query));
    }

    /** 项目用例执行概览（总数/通过/失败/阻塞/未执行） */
    @GetMapping("/api/test-cases/stats")
    public ApiResult<CaseStatsView> stats(@RequestParam String reqId,
                                          @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(caseService.stats(ws.getId(), userId, reqId));
    }

    /** 需求—用例—缺陷覆盖矩阵 */
    @GetMapping("/api/test-cases/coverage")
    public ApiResult<List<com.hourglass.dto.CaseCoverageRow>> coverage(@RequestParam(required = false) String reqId,
                                                                       @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(caseService.coverage(ws.getId(), userId, reqId));
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

    /** 导出项目全部用例 */
    @GetMapping("/api/test-cases/export.csv")
    public org.springframework.http.ResponseEntity<byte[]> exportCsv(@RequestParam String reqId,
                                                                     @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return csvResponse(caseService.exportCsv(ws.getId(), userId, reqId), "test-cases.csv");
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
