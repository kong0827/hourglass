package com.hourglass.controller;

import com.hourglass.common.ApiResult;
import com.hourglass.common.AppException;
import com.hourglass.common.CurrentUser;
import com.hourglass.entity.AppUser;
import com.hourglass.mapper.UserMapper;
import com.hourglass.service.AuditService;
import com.hourglass.service.SystemInfoService;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.Map;

/** 系统审计与只读系统信息（仅平台管理员） */
@RestController
public class AdminSystemController {

    private final AuditService auditService;
    private final SystemInfoService systemInfoService;
    private final UserMapper userMapper;

    public AdminSystemController(AuditService auditService, SystemInfoService systemInfoService,
                                 UserMapper userMapper) {
        this.auditService = auditService;
        this.systemInfoService = systemInfoService;
        this.userMapper = userMapper;
    }

    /** 以数据库实时角色为准（/api/admin/** 之外再复核一次，避免旧会话残留权限） */
    private void requireAdmin() {
        AppUser me = userMapper.selectById(CurrentUser.id());
        if (me == null || !"admin".equals(me.getRole())) {
            throw new AppException(403, "没有权限执行该操作");
        }
    }

    @GetMapping("/api/admin/audit/logs")
    public ApiResult<Map<String, Object>> logs(@RequestParam(required = false) String workspace,
                                               @RequestParam(required = false) String q,
                                               @RequestParam(required = false) String action,
                                               @RequestParam(required = false) String result,
                                               @RequestParam(required = false) String actor,
                                               @RequestParam(required = false) String from,
                                               @RequestParam(required = false) String to,
                                               @RequestParam(required = false) Integer page,
                                               @RequestParam(required = false) Integer size) {
        requireAdmin();
        return ApiResult.ok(auditService.page(workspace, q, action, result, actor, from, to, page, size));
    }

    /** 按当前筛选条件导出 CSV（最多 10000 条，保留 90 天） */
    @GetMapping("/api/admin/audit/logs.csv")
    public ResponseEntity<byte[]> export(@RequestParam(required = false) String workspace,
                                         @RequestParam(required = false) String q,
                                         @RequestParam(required = false) String action,
                                         @RequestParam(required = false) String result,
                                         @RequestParam(required = false) String actor,
                                         @RequestParam(required = false) String from,
                                         @RequestParam(required = false) String to) {
        requireAdmin();
        byte[] bytes = auditService.exportCsv(workspace, q, action, result, actor, from, to);
        String filename = "audit-" + LocalDate.now() + ".csv";
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + filename + "\"")
                .contentType(new MediaType("text", "csv", StandardCharsets.UTF_8))
                .body(bytes);
    }

    @GetMapping("/api/admin/system/info")
    public ApiResult<Map<String, Object>> info(@RequestParam(required = false) String workspace) {
        requireAdmin();
        return ApiResult.ok(systemInfoService.info(workspace));
    }
}
