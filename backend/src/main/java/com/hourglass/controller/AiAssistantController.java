package com.hourglass.controller;

import com.hourglass.common.ApiResult;
import com.hourglass.common.CurrentUser;
import com.hourglass.dto.AiAssistantBootstrapView;
import com.hourglass.dto.AiAssistantConfirmRequest;
import com.hourglass.dto.AiAssistantConfirmResponse;
import com.hourglass.dto.AiAssistantRequest;
import com.hourglass.dto.AiAssistantResponse;
import com.hourglass.entity.Workspace;
import com.hourglass.service.AiAssistantService;
import com.hourglass.service.WorkspaceService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import javax.validation.Valid;

/**
 * 产品内助手：问答、入口建议、任务草稿与确认创建。
 *
 * <p>空间一律由 {@link WorkspaceService#resolve} 解析并校验成员身份；
 * 助手不会读取请求里的任意项目 ID，所有项目都在服务层按可见范围重新过滤。
 */
@RestController
public class AiAssistantController {

    private final AiAssistantService assistantService;
    private final WorkspaceService workspaceService;

    public AiAssistantController(AiAssistantService assistantService, WorkspaceService workspaceService) {
        this.assistantService = assistantService;
        this.workspaceService = workspaceService;
    }

    @GetMapping("/api/ai/assistant/bootstrap")
    public ApiResult<AiAssistantBootstrapView> bootstrap(@RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(assistantService.bootstrap(userId, ws.getId(), ws.getName()));
    }

    @PostMapping("/api/ai/assistant/chat")
    public ApiResult<AiAssistantResponse> chat(@Valid @RequestBody AiAssistantRequest req,
                                               @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(assistantService.chat(userId, ws.getId(), ws.getName(), req));
    }

    @PostMapping("/api/ai/assistant/tasks/confirm")
    public ApiResult<AiAssistantConfirmResponse> confirm(@Valid @RequestBody AiAssistantConfirmRequest req,
                                                         @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(assistantService.confirm(userId, ws.getId(), req));
    }
}
