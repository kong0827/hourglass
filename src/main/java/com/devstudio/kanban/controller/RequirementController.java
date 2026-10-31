package com.devstudio.kanban.controller;

import com.devstudio.kanban.common.ApiResult;
import com.devstudio.kanban.common.CurrentUser;
import com.devstudio.kanban.dto.ReqProgress;
import com.devstudio.kanban.dto.ReqSaveRequest;
import com.devstudio.kanban.dto.RequirementDeleteResult;
import com.devstudio.kanban.entity.Requirement;
import com.devstudio.kanban.entity.Workspace;
import com.devstudio.kanban.service.RequirementService;
import com.devstudio.kanban.service.WorkspaceService;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import javax.validation.Valid;
import java.util.List;

@RestController
public class RequirementController {

    private final RequirementService requirementService;
    private final WorkspaceService workspaceService;

    public RequirementController(RequirementService requirementService, WorkspaceService workspaceService) {
        this.requirementService = requirementService;
        this.workspaceService = workspaceService;
    }

    /** 项目列表（含任务数、完成数、平均进度） */
    @GetMapping("/api/reqs")
    public ApiResult<List<ReqProgress>> list(@RequestParam(required = false) String workspace) {
        Workspace ws = workspaceService.resolve(CurrentUser.id(), workspace);
        return ApiResult.ok(requirementService.list(ws.getId()));
    }

    @PostMapping("/api/reqs")
    public ApiResult<Requirement> create(@Valid @RequestBody ReqSaveRequest req,
                                         @RequestParam(required = false) String workspace) {
        Workspace ws = workspaceService.resolve(CurrentUser.id(), workspace);
        return ApiResult.ok(requirementService.create(ws.getId(), req));
    }

    @PutMapping("/api/reqs/{id}")
    public ApiResult<Requirement> update(@PathVariable String id, @Valid @RequestBody ReqSaveRequest req,
                                         @RequestParam(required = false) String workspace) {
        Workspace ws = workspaceService.resolve(CurrentUser.id(), workspace);
        return ApiResult.ok(requirementService.update(ws.getId(), id, req));
    }

    /** 删除项目：其下任务保留（解除关联），其下需求文档一并删除 */
    @DeleteMapping("/api/reqs/{id}")
    public ApiResult<RequirementDeleteResult> delete(@PathVariable String id,
                                                     @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        /* 删除项目会级联删需求文档：仅空间主可执行 */
        workspaceService.requireOwner(userId, ws.getId());
        return ApiResult.ok(requirementService.delete(userId, ws.getId(), id));
    }
}
