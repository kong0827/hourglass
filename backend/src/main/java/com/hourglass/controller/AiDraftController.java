package com.hourglass.controller;

import com.hourglass.common.ApiResult;
import com.hourglass.common.CurrentUser;
import com.hourglass.dto.AiDraftRequest;
import com.hourglass.dto.AiDraftResponse;
import com.hourglass.entity.Workspace;
import com.hourglass.service.AiDraftService;
import com.hourglass.service.AiUsageService;
import com.hourglass.service.WorkspaceService;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import javax.validation.Valid;

/**
 * 字段级 AI 草稿（验收标准 / 完成标准）。
 *
 * <p>和拆单一样只返回草稿：不落库、不自动保存，采用与否由用户在表单里决定。
 * 用量按 intent 记入 ai_usage_daily，管理员看得到每个入口花了多少。
 */
@RestController
public class AiDraftController {

    private final AiDraftService draftService;
    private final WorkspaceService workspaceService;
    private final AiUsageService usageService;

    public AiDraftController(AiDraftService draftService, WorkspaceService workspaceService,
                             AiUsageService usageService) {
        this.draftService = draftService;
        this.workspaceService = workspaceService;
        this.usageService = usageService;
    }

    @PostMapping("/api/ai/drafts/acceptance")
    public ApiResult<AiDraftResponse> acceptance(@Valid @RequestBody AiDraftRequest req,
                                                 @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(run(userId, ws, "draft:acceptance", AiDraftService.KIND_ACCEPTANCE, req));
    }

    @PostMapping("/api/ai/drafts/task-done")
    public ApiResult<AiDraftResponse> taskDone(@Valid @RequestBody AiDraftRequest req,
                                               @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(run(userId, ws, "draft:task_done", AiDraftService.KIND_TASK_DONE, req));
    }

    private AiDraftResponse run(String userId, Workspace ws, String intent, String kind, AiDraftRequest req) {
        long started = System.currentTimeMillis();
        try {
            AiDraftResponse res = draftService.generate(userId, ws.getId(), kind, req);
            usageService.record(ws.getId(), intent, res.getUsage(), true, System.currentTimeMillis() - started);
            return res;
        } catch (RuntimeException e) {
            usageService.record(ws.getId(), intent, null, false, System.currentTimeMillis() - started);
            throw e;
        }
    }
}
