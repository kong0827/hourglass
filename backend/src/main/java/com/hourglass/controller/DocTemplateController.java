package com.hourglass.controller;

import com.hourglass.common.ApiResult;
import com.hourglass.common.CurrentUser;
import com.hourglass.dto.DocTemplateSaveRequest;
import com.hourglass.dto.DocTemplateView;
import com.hourglass.entity.Workspace;
import com.hourglass.service.DocTemplateService;
import com.hourglass.service.WorkspaceService;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import javax.validation.Valid;
import java.util.List;

/** 文档模板：内置骨架 + 工作区自定义模板 */
@RestController
public class DocTemplateController {

    private final DocTemplateService templateService;
    private final WorkspaceService workspaceService;

    public DocTemplateController(DocTemplateService templateService, WorkspaceService workspaceService) {
        this.templateService = templateService;
        this.workspaceService = workspaceService;
    }

    @GetMapping("/api/doc-templates")
    public ApiResult<List<DocTemplateView>> list(@RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(templateService.list(ws.getId(), userId));
    }

    @PostMapping("/api/doc-templates")
    public ApiResult<DocTemplateView> create(@Valid @RequestBody DocTemplateSaveRequest req,
                                             @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(templateService.create(userId, ws.getId(), req));
    }

    @DeleteMapping("/api/doc-templates/{id}")
    public ApiResult<Void> delete(@PathVariable String id,
                                  @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        templateService.delete(userId, ws.getId(), id);
        return ApiResult.ok(null);
    }
}
