package com.devstudio.kanban.controller;

import com.devstudio.kanban.common.ApiResult;
import com.devstudio.kanban.common.CurrentWorkspace;
import com.devstudio.kanban.common.RequireRole;
import com.devstudio.kanban.config.WorkspaceCtx;
import com.devstudio.kanban.dto.BulkProjectMetaRequest;
import com.devstudio.kanban.dto.BulkTaskMetaRequest;
import com.devstudio.kanban.dto.HealthOverrideRequest;
import com.devstudio.kanban.dto.ManagementOverviewResponse;
import com.devstudio.kanban.dto.ManagementProjectDetail;
import com.devstudio.kanban.dto.ManagementProjectRow;
import com.devstudio.kanban.dto.ManagementQuery;
import com.devstudio.kanban.dto.ManagementRiskRow;
import com.devstudio.kanban.dto.ManagementWorkloadResponse;
import com.devstudio.kanban.dto.ProjectMetaRequest;
import com.devstudio.kanban.entity.Requirement;
import com.devstudio.kanban.service.ActivityService;
import com.devstudio.kanban.service.ManagementAdminService;
import com.devstudio.kanban.service.ManagementQueryService;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.ModelAttribute;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import javax.validation.Valid;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;

/** 管理层驾驶舱：读接口 owner/exec，写接口 owner。 */
@RestController
public class ManagementController {

    /** 与 ManagementQueryService 的周口径保持一致，避免服务器时区为 UTC 时“本周”错一天 */
    private static final ZoneId ZONE = ZoneId.of("Asia/Shanghai");

    private final ManagementQueryService queryService;
    private final ManagementAdminService adminService;
    private final ActivityService activityService;

    public ManagementController(ManagementQueryService queryService, ManagementAdminService adminService,
                                ActivityService activityService) {
        this.queryService = queryService;
        this.adminService = adminService;
        this.activityService = activityService;
    }

    @RequireRole(RequireRole.MANAGEMENT)
    @GetMapping("/api/management/overview")
    public ApiResult<ManagementOverviewResponse> overview(@CurrentWorkspace WorkspaceCtx ctx) {
        adminService.requireShared(ctx.getWorkspace());
        return ApiResult.ok(queryService.overview(ctx.getWsId()));
    }

    @RequireRole(RequireRole.MANAGEMENT)
    @GetMapping("/api/management/projects")
    public ApiResult<Map<String, Object>> projects(@CurrentWorkspace WorkspaceCtx ctx,
                                                   @ModelAttribute ManagementQuery query) {
        adminService.requireShared(ctx.getWorkspace());
        return ApiResult.ok(queryService.projects(ctx.getWsId(), query));
    }

    /** 跨项目总览卡片：当前空间全部项目，不分页。 */
    @RequireRole(RequireRole.MANAGEMENT)
    @GetMapping("/api/management/portfolio")
    public ApiResult<List<ManagementProjectRow>> portfolio(@CurrentWorkspace WorkspaceCtx ctx) {
        adminService.requireShared(ctx.getWorkspace());
        return ApiResult.ok(queryService.projectRows(ctx.getWsId(), new ManagementQuery()));
    }

    @RequireRole(RequireRole.MANAGEMENT)
    @GetMapping("/api/management/projects/{id}")
    public ApiResult<ManagementProjectDetail> detail(@PathVariable String id, @CurrentWorkspace WorkspaceCtx ctx) {
        adminService.requireShared(ctx.getWorkspace());
        return ApiResult.ok(queryService.detail(ctx.getWsId(), id));
    }

    @RequireRole(RequireRole.MANAGEMENT)
    @GetMapping("/api/management/risks")
    public ApiResult<List<ManagementRiskRow>> risks(@CurrentWorkspace WorkspaceCtx ctx,
                                                    @RequestParam(required = false) Integer limit) {
        adminService.requireShared(ctx.getWorkspace());
        int n = limit == null ? 100 : Math.max(1, Math.min(500, limit));
        return ApiResult.ok(queryService.risks(ctx.getWsId(), n));
    }

    @RequireRole(RequireRole.MANAGEMENT)
    @GetMapping("/api/management/workload")
    public ApiResult<ManagementWorkloadResponse> workload(
            @CurrentWorkspace WorkspaceCtx ctx,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        adminService.requireShared(ctx.getWorkspace());
        return ApiResult.ok(queryService.workload(ctx.getWsId(), from, to));
    }

    /* 项目负责人（member）也要能维护自己项目的资料，因此这里不用 @RequireRole(owner)；
       ManagementAdminService 会校验 owner 或该项目 manager，exec 仍被只读过滤器拦截。 */
    @PutMapping("/api/management/projects/{id}/meta")
    public ApiResult<Requirement> meta(@PathVariable String id, @Valid @RequestBody ProjectMetaRequest req,
                                       @CurrentWorkspace WorkspaceCtx ctx) {
        adminService.requireShared(ctx.getWorkspace());
        return ApiResult.ok(adminService.updateProjectMeta(ctx.getUserId(), ctx.getWorkspace(), id, req));
    }

    @RequireRole
    @PutMapping("/api/management/projects/{id}/health")
    public ApiResult<Requirement> health(@PathVariable String id, @Valid @RequestBody HealthOverrideRequest req,
                                         @CurrentWorkspace WorkspaceCtx ctx) {
        adminService.requireShared(ctx.getWorkspace());
        return ApiResult.ok(adminService.overrideHealth(ctx.getUserId(), ctx.getWorkspace(), id, req));
    }

    @RequireRole
    @PostMapping("/api/management/projects/bulk-meta")
    public ApiResult<Map<String, Object>> bulkMeta(@Valid @RequestBody BulkProjectMetaRequest req,
                                                   @CurrentWorkspace WorkspaceCtx ctx) {
        adminService.requireShared(ctx.getWorkspace());
        return ApiResult.ok(adminService.bulkProjectMeta(ctx.getUserId(), ctx.getWorkspace(), req));
    }

    @RequireRole
    @PostMapping("/api/management/tasks/bulk-meta")
    public ApiResult<Map<String, Object>> bulkTaskMeta(@Valid @RequestBody BulkTaskMetaRequest req,
                                                       @CurrentWorkspace WorkspaceCtx ctx) {
        adminService.requireShared(ctx.getWorkspace());
        return ApiResult.ok(adminService.bulkTaskMeta(ctx.getUserId(), ctx.getWorkspace(), req));
    }

    @RequireRole(RequireRole.MANAGEMENT)
    @GetMapping("/api/management/export")
    public ResponseEntity<byte[]> export(@CurrentWorkspace WorkspaceCtx ctx,
                                         @ModelAttribute ManagementQuery query) {
        adminService.requireShared(ctx.getWorkspace());
        List<ManagementProjectRow> rows = queryService.projectRows(ctx.getWsId(), query);
        StringBuilder sb = new StringBuilder();
        sb.append('\uFEFF');
        sb.append(csv("项目", "状态", "负责人", "风险", "状态异常", "数据质量", "开始日期", "截止日期",
                "实际%", "计划%", "偏差pp", "任务数", "完成数", "逾期数", "阻塞数",
                "预估分钟", "实际分钟", "最近更新", "下一节点", "风险原因", "缺失项")).append("\r\n");
        for (ManagementProjectRow r : rows) {
            sb.append(csv(
                    r.getName(), r.getStatus(), r.getManager(), r.getRiskLevel(), r.getStatusIssue(),
                    r.getDataQuality() == null ? "" : String.valueOf(r.getDataQuality()),
                    r.getStartDate() == null ? "" : r.getStartDate().toString(),
                    r.getDueDate() == null ? "" : r.getDueDate().toString(),
                    String.valueOf(r.getDoneWeightedPct()),
                    r.getPlannedPct() == null ? "" : String.valueOf(r.getPlannedPct()),
                    r.getVariancePct() == null ? "" : String.valueOf(r.getVariancePct()),
                    String.valueOf(r.getTaskCount()), String.valueOf(r.getDoneCount()),
                    String.valueOf(r.getOverdueCount()), String.valueOf(r.getBlockedCount()),
                    String.valueOf(r.getEstimateMinutes()), String.valueOf(r.getActualMinutes()),
                    r.getLastActivityAt() == null ? "" : r.getLastActivityAt().toString(),
                    r.getNextNode(), join(r.getRiskReasons()), join(r.getMissingFields())
            )).append("\r\n");
        }
        activityService.logConfig(ctx.getWsId(), ctx.getUserId(), "导出管理报表（项目组合 CSV）");
        String filename = "管理报表-项目组合-" + LocalDate.now(ZONE) + ".csv";
        String encoded;
        try {
            encoded = URLEncoder.encode(filename, "UTF-8").replace("+", "%20");
        } catch (java.io.UnsupportedEncodingException e) {
            encoded = "management-report.csv";
        }
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename*=UTF-8''" + encoded)
                .header("X-Report-Schema-Version", "management-v0.2")
                .header(HttpHeaders.CACHE_CONTROL, "no-store")
                .contentType(new MediaType("text", "csv", StandardCharsets.UTF_8))
                .body(sb.toString().getBytes(StandardCharsets.UTF_8));
    }

    @RequireRole(RequireRole.MANAGEMENT)
    @GetMapping("/api/management/weekly-report")
    public ResponseEntity<byte[]> weeklyReport(@CurrentWorkspace WorkspaceCtx ctx) {
        adminService.requireShared(ctx.getWorkspace());
        ManagementOverviewResponse overview = queryService.overview(ctx.getWsId());
        List<ManagementProjectRow> rows = queryService.projectRows(ctx.getWsId(), new ManagementQuery());
        LocalDate today = LocalDate.now(ZONE);
        LocalDate monday = today.minusDays(today.getDayOfWeek().getValue() - 1);
        LocalDate sunday = monday.plusDays(6);
        ManagementOverviewResponse.Summary s = overview.getSummary();

        StringBuilder sb = new StringBuilder();
        sb.append('\uFEFF');
        sb.append(csv("管理周报", monday + " ~ " + sunday)).append("\r\n");
        sb.append(csv("生成时间", LocalDateTime.now(ZONE).withNano(0).toString())).append("\r\n\r\n");
        sb.append(csv("指标", "数值")).append("\r\n");
        sb.append(csv("进行中项目", s.getActive() + "/" + s.getProjects())).append("\r\n");
        sb.append(csv("已完成项目", String.valueOf(s.getDone()))).append("\r\n");
        sb.append(csv("逾期项目", String.valueOf(s.getOverdue()))).append("\r\n");
        sb.append(csv("逾期任务", String.valueOf(s.getOverdueTasks()))).append("\r\n");
        sb.append(csv("本周完成", s.getCompletedThisWeek() + "（上周 " + s.getCompletedPrevWeek() + "）")).append("\r\n");
        sb.append(csv("本周工时", hours(s.getWorkMinutesThisWeek()) + "（上周 " + hours(s.getWorkMinutesPrevWeek()) + "）")).append("\r\n");
        sb.append(csv("团队人数", String.valueOf(s.getMembers()))).append("\r\n");
        sb.append(csv("人均工时", s.getMembers() == 0 ? "—"
                : hours(Math.round(s.getWorkMinutesThisWeek() * 1.0f / s.getMembers())))).append("\r\n");
        sb.append(csv("数据质量", s.getDataQuality() == null ? "—" : s.getDataQuality() + "%")).append("\r\n");
        sb.append(csv("状态异常", String.valueOf(s.getStatusIssues()))).append("\r\n");
        sb.append(csv("逾期集中项目", s.getTopOverdueProject() == null ? "—" : s.getTopOverdueProject())).append("\r\n\r\n");

        sb.append(csv("需关注项目", "状态灯", "风险", "负责人", "逾期任务", "任务总数", "最近完成", "连续无完成天数", "超载人数", "原因"))
                .append("\r\n");
        for (ManagementProjectRow r : rows) {
            boolean exception = "red".equals(r.getStatusLight()) || "amber".equals(r.getStatusLight())
                    || r.getStatusIssue() != null
                    || ("unknown".equals(r.getStatusLight()) && "active".equals(r.getStatus()));
            if (!exception) continue;
            sb.append(csv(r.getName(), r.getStatusLight(), r.getRiskLevel(), r.getManager(),
                    String.valueOf(r.getOverdueCount()), String.valueOf(r.getTaskCount()),
                    r.getLastCompletedDate() == null ? "—" : r.getLastCompletedDate().toString(),
                    r.getDaysSinceCompletion() == null ? "—" : String.valueOf(r.getDaysSinceCompletion()),
                    String.valueOf(r.getOverloadedMembers()), join(r.getRiskReasons()))).append("\r\n");
        }

        List<ManagementProjectRow> topOverdue = new ArrayList<ManagementProjectRow>();
        for (ManagementProjectRow r : rows) {
            /* 与总览“逾期任务”同口径：只统计进行中项目 */
            if ("active".equals(r.getStatus()) && r.getOverdueCount() > 0) topOverdue.add(r);
        }
        topOverdue.sort(new Comparator<ManagementProjectRow>() {
            @Override
            public int compare(ManagementProjectRow a, ManagementProjectRow b) {
                return b.getOverdueCount() - a.getOverdueCount();
            }
        });
        sb.append("\r\n").append(csv("Top 逾期项目", "逾期任务", "任务总数", "逾期占比")).append("\r\n");
        for (int i = 0; i < topOverdue.size() && i < 5; i++) {
            ManagementProjectRow r = topOverdue.get(i);
            int ratio = r.getTaskCount() == 0 ? 0 : Math.round(r.getOverdueCount() * 100f / r.getTaskCount());
            sb.append(csv(r.getName(), String.valueOf(r.getOverdueCount()),
                    String.valueOf(r.getTaskCount()), ratio + "%")).append("\r\n");
        }

        activityService.logConfig(ctx.getWsId(), ctx.getUserId(), "导出管理周报");
        String filename = "管理周报-" + today + ".csv";
        String encoded;
        try {
            encoded = URLEncoder.encode(filename, "UTF-8").replace("+", "%20");
        } catch (java.io.UnsupportedEncodingException e) {
            encoded = "management-weekly.csv";
        }
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename*=UTF-8''" + encoded)
                .header("X-Report-Schema-Version", "management-weekly-v0.2")
                .header(HttpHeaders.CACHE_CONTROL, "no-store")
                .contentType(new MediaType("text", "csv", StandardCharsets.UTF_8))
                .body(sb.toString().getBytes(StandardCharsets.UTF_8));
    }

    private static String hours(int minutes) {
        return String.format(java.util.Locale.ROOT, "%.1fh", minutes / 60.0);
    }

    private static String csv(String... cols) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < cols.length; i++) {
            if (i > 0) sb.append(',');
            sb.append(cell(cols[i]));
        }
        return sb.toString();
    }

    private static String cell(String raw) {
        if (raw == null) return "";
        String s = raw;
        String trimmed = s.trim();
        if (!trimmed.isEmpty()) {
            char first = trimmed.charAt(0);
            /* 防公式注入；纯负数（如偏差 -12、-12.5）保持数字，不加前缀影响 Excel 计算 */
            boolean negativeNumber = first == '-' && trimmed.matches("-\\d+(\\.\\d+)?");
            boolean dangerous = first == '=' || first == '+' || first == '@'
                    || first == '\t' || first == '\r'
                    || (first == '-' && !negativeNumber);
            if (dangerous) s = "'" + s;
        }
        if (s.indexOf(',') >= 0 || s.indexOf('"') >= 0 || s.indexOf('\n') >= 0 || s.indexOf('\r') >= 0) {
            return "\"" + s.replace("\"", "\"\"") + "\"";
        }
        return s;
    }

    private static String join(List<String> list) {
        if (list == null || list.isEmpty()) return "";
        StringBuilder sb = new StringBuilder();
        for (String s : list) {
            if (sb.length() > 0) sb.append("；");
            sb.append(s);
        }
        return sb.toString();
    }
}
