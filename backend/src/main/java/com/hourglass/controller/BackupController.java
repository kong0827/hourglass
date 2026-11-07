package com.hourglass.controller;

import com.hourglass.common.ApiResult;
import com.hourglass.common.CurrentUser;
import com.hourglass.dto.BackupData;
import com.hourglass.entity.Workspace;
import com.hourglass.service.BackupService;
import com.hourglass.service.ProjectAccessService;
import com.hourglass.service.WorkspaceService;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.nio.charset.StandardCharsets;
import java.time.LocalDate;

@RestController
public class BackupController {

    private final BackupService backupService;
    private final WorkspaceService workspaceService;
    private final ProjectAccessService projectAccess;

    public BackupController(BackupService backupService, WorkspaceService workspaceService,
                            ProjectAccessService projectAccess) {
        this.backupService = backupService;
        this.workspaceService = workspaceService;
        this.projectAccess = projectAccess;
    }

    /** 导出当前空间的全部数据（仅空间主：包含全量任务/评论/依赖/基线） */
    @GetMapping("/api/export")
    public ApiResult<BackupData> export(@RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        workspaceService.requireOwner(userId, ws.getId());
        return ApiResult.ok(backupService.export(ws.getId()));
    }

    /** 导出当前空间 CSV（Excel 可直接打开） */
    @GetMapping("/api/export/csv")
    public ResponseEntity<byte[]> exportCsv(@RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        byte[] bytes = backupService.exportCsv(ws.getId(), projectAccess.hiddenProjectIds(ws.getId(), userId));
        String filename = "workbench-tasks-" + LocalDate.now() + ".csv";
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + filename + "\"")
                .contentType(new MediaType("text", "csv", StandardCharsets.UTF_8))
                .body(bytes);
    }

    /** 导入备份文件（覆盖当前空间数据；仅空间主） */
    @PostMapping("/api/import")
    public ApiResult<BackupData.ImportResult> importData(@RequestBody BackupData data,
                                                         @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        workspaceService.requireOwner(userId, ws.getId());
        return ApiResult.ok(backupService.importData(userId, ws.getId(), data));
    }
}
