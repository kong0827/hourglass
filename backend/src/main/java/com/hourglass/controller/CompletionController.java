package com.hourglass.controller;

import com.hourglass.common.ApiResult;
import com.hourglass.common.AppException;
import com.hourglass.common.CurrentUser;
import com.hourglass.entity.TaskCompletionRecord;
import com.hourglass.entity.Workspace;
import com.hourglass.service.TaskCompletionService;
import com.hourglass.service.WorkspaceService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.YearMonth;
import java.util.List;

@RestController
public class CompletionController {

    private final TaskCompletionService completionService;
    private final WorkspaceService workspaceService;

    public CompletionController(TaskCompletionService completionService, WorkspaceService workspaceService) {
        this.completionService = completionService;
        this.workspaceService = workspaceService;
    }

    /**
     * 任务清单（按月）：任务完成时自动归档的快照，用于月底统计 / 导出。
     *
     * @param month YYYY-MM，为空取当月
     */
    @GetMapping("/api/completions")
    public ApiResult<List<TaskCompletionRecord>> list(@RequestParam(required = false) String month,
                                                      @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(completionService.listByMonth(ws.getId(), userId, parseMonth(month)));
    }

    private YearMonth parseMonth(String month) {
        if (month == null || month.trim().isEmpty()) {
            return YearMonth.now();
        }
        try {
            return YearMonth.parse(month.trim());
        } catch (Exception e) {
            throw AppException.badRequest("月份格式应为 YYYY-MM");
        }
    }
}
