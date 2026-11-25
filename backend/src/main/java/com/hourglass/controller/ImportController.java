package com.hourglass.controller;

import com.hourglass.common.ApiResult;
import com.hourglass.common.CurrentUser;
import com.hourglass.dto.ImportPreview;
import com.hourglass.dto.ImportRequest;
import com.hourglass.dto.ImportResult;
import com.hourglass.entity.Workspace;
import com.hourglass.service.AuditService;
import com.hourglass.service.ImportService;
import com.hourglass.service.WorkspaceService;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import javax.servlet.http.HttpServletRequest;
import java.nio.charset.StandardCharsets;

/** Excel / CSV 迁移导入：模板、预检与写入。 */
@RestController
public class ImportController {

    private final ImportService importService;
    private final WorkspaceService workspaceService;
    private final AuditService audit;

    public ImportController(ImportService importService, WorkspaceService workspaceService, AuditService audit) {
        this.importService = importService;
        this.workspaceService = workspaceService;
        this.audit = audit;
    }

    @GetMapping("/api/import/template")
    public ResponseEntity<byte[]> template(@RequestParam(required = false) String kind) {
        String k = kind == null ? "task" : kind;
        String filename = "hourglass-import-" + safeKind(k) + ".csv";
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + filename + "\"")
                .contentType(new MediaType("text", "csv", StandardCharsets.UTF_8))
                .body(importService.template(k));
    }

    @PostMapping("/api/import/preview")
    public ApiResult<ImportPreview> preview(@RequestBody ImportRequest req,
                                            @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(importService.preview(ws.getId(), userId, req));
    }

    @PostMapping("/api/import/commit")
    public ApiResult<ImportResult> commit(@RequestBody ImportRequest req,
                                          @RequestParam(required = false) String workspace,
                                          HttpServletRequest request) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        try {
            ImportResult result = importService.commit(ws.getId(), userId, req);
            audit.recordCurrent(ws.getId(), "import", req == null ? "data" : req.getKind(),
                    ws.getId(), ws.getName(), true,
                    "迁移导入 " + result.getKind() + "：" + result.getCreated() + " 行成功 / "
                            + result.getFailed() + " 行失败", request);
            return ApiResult.ok(result);
        } catch (RuntimeException e) {
            audit.recordCurrent(ws.getId(), "import", req == null ? "data" : req.getKind(),
                    ws.getId(), ws.getName(), false,
                    "迁移导入失败：" + e.getMessage(), request);
            throw e;
        }
    }

    private static String safeKind(String kind) {
        if ("demand".equals(kind) || "case".equals(kind) || "worklog".equals(kind)) {
            return kind;
        }
        return "task";
    }
}
