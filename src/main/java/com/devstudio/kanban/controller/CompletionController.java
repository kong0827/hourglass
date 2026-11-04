package com.devstudio.kanban.controller;

import com.devstudio.kanban.common.ApiResult;
import com.devstudio.kanban.common.AppException;
import com.devstudio.kanban.common.CurrentUser;
import com.devstudio.kanban.entity.TaskCompletionRecord;
import com.devstudio.kanban.entity.Workspace;
import com.devstudio.kanban.service.TaskCompletionService;
import com.devstudio.kanban.service.WorkspaceService;
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
