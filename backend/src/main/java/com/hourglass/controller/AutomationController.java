package com.hourglass.controller;

import com.hourglass.common.ApiResult;
import com.hourglass.common.CurrentUser;
import com.hourglass.entity.Workspace;
import com.hourglass.service.AutomationSettingsService;
import com.hourglass.service.ReportService;
import com.hourglass.service.WorkspaceService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 轻量自动化与定时报告设置。
 *
 * <p>三条内置规则是空间级配置，只有空间主/管理员能改；
 * 报告订阅是个人配置，成员各自管理自己的周报与版本报告渠道。
 */
@RestController
public class AutomationController {

    private final AutomationSettingsService settings;
    private final ReportService reports;
    private final WorkspaceService workspaceService;

    public AutomationController(AutomationSettingsService settings, ReportService reports,
                                WorkspaceService workspaceService) {
        this.settings = settings;
        this.reports = reports;
        this.workspaceService = workspaceService;
    }

    /** 设置页一次读完：规则开关 + 当前人的报告订阅（含未订阅时的默认值）。 */
    @GetMapping("/api/automation")
    public ApiResult<Map<String, Object>> view(@RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        workspaceService.requireMember(userId, ws.getId());
        Map<String, Object> res = new LinkedHashMap<String, Object>();
        res.putAll(settings.view(ws.getId()));
        res.put("reports", reports.view(userId, ws.getId()));
        res.put("canManageRules", "owner".equals(ws.getMyRole()) || "admin".equals(ws.getMyRole()));
        return ApiResult.ok(res);
    }

    /** 空间规则：只更新请求里出现的规则键，未出现的保持原值。 */
    @PutMapping("/api/automation/rules")
    public ApiResult<Map<String, Object>> updateRules(@RequestParam(required = false) String workspace,
                                                      @RequestBody Map<String, Object> body) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        workspaceService.requireManager(userId, ws.getId());
        return ApiResult.ok(settings.updateRules(userId, ws.getId(), body));
    }

    /** 个人报告订阅：weekly / version。 */
    @PutMapping("/api/automation/reports/{type}")
    public ApiResult<Map<String, Object>> updateReport(@PathVariable String type,
                                                       @RequestParam(required = false) String workspace,
                                                       @RequestBody Map<String, Object> body) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        workspaceService.requireMember(userId, ws.getId());
        return ApiResult.ok(reports.update(userId, ws.getId(), type, body));
    }

    /** 立即给自己发一份：确认内容与渠道，不影响定时发送。 */
    @PostMapping("/api/automation/reports/{type}/send")
    public ApiResult<Map<String, Object>> sendReport(@PathVariable String type,
                                                     @RequestParam(required = false) String workspace,
                                                     @RequestParam(required = false) String versionId) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        workspaceService.requireMember(userId, ws.getId());
        return ApiResult.ok(reports.sendNow(userId, ws.getId(), type, versionId));
    }
}
