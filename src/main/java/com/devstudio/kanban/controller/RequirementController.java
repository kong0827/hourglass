package com.devstudio.kanban.controller;

import com.devstudio.kanban.common.ApiResult;
import com.devstudio.kanban.common.CurrentUser;
import com.devstudio.kanban.common.CurrentWorkspace;
import com.devstudio.kanban.common.RequireRole;
import com.devstudio.kanban.config.WorkspaceCtx;
import com.devstudio.kanban.dto.FirstReleaseRequest;
import com.devstudio.kanban.dto.ReqProgress;
import com.devstudio.kanban.dto.ReqSaveRequest;
import com.devstudio.kanban.dto.RequirementDeleteResult;
import com.devstudio.kanban.entity.Requirement;
import com.devstudio.kanban.entity.Task;
import com.devstudio.kanban.entity.WorkActivity;
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
    @GetMapping({"/api/reqs", "/api/projects"})
    public ApiResult<List<ReqProgress>> list(@RequestParam(required = false) String workspace) {
        Workspace ws = workspaceService.resolve(CurrentUser.id(), workspace);
        return ApiResult.ok(requirementService.list(ws.getId(), CurrentUser.id()));
    }

    @PostMapping({"/api/reqs", "/api/projects"})
    public ApiResult<Requirement> create(@Valid @RequestBody ReqSaveRequest req,
                                         @RequestParam(required = false) String workspace) {
        Workspace ws = workspaceService.resolve(CurrentUser.id(), workspace);
        return ApiResult.ok(requirementService.create(ws.getId(), CurrentUser.id(), req));
    }

    @PutMapping({"/api/reqs/{id}", "/api/projects/{id}"})
    public ApiResult<Requirement> update(@PathVariable String id, @Valid @RequestBody ReqSaveRequest req,
                                         @RequestParam(required = false) String workspace) {
        Workspace ws = workspaceService.resolve(CurrentUser.id(), workspace);
        return ApiResult.ok(requirementService.update(ws.getId(), CurrentUser.id(), id, req));
    }

    /** 项目活动轨迹：沿用空间成员权限，并校验项目属于该空间。 */
    @GetMapping({"/api/reqs/{id}/activities", "/api/projects/{id}/activities"})
    public ApiResult<List<WorkActivity>> activities(@PathVariable String id,
                                                    @RequestParam(required = false) String workspace) {
        Workspace ws = workspaceService.resolve(CurrentUser.id(), workspace);
        return ApiResult.ok(requirementService.activities(ws.getId(), CurrentUser.id(), id));
    }

    @GetMapping({"/api/reqs/{id}/tasks", "/api/projects/{id}/tasks"})
    public ApiResult<List<Task>> tasks(@PathVariable String id,
                                       @RequestParam(required = false) String workspace) {
        Workspace ws = workspaceService.resolve(CurrentUser.id(), workspace);
        return ApiResult.ok(requirementService.tasks(ws.getId(), CurrentUser.id(), id));
    }

    /** 标记首版上线（阶段归组口径锚点）：仅空间主可执行；body 可选 date，缺省当天 */
    @RequireRole
    @PostMapping({"/api/reqs/{id}/first-release", "/api/projects/{id}/first-release"})
    public ApiResult<Requirement> markFirstRelease(@PathVariable String id,
                                                   @RequestBody(required = false) FirstReleaseRequest body,
                                                   @CurrentWorkspace WorkspaceCtx ctx) {
        java.time.LocalDate date = body == null || body.getDate() == null ? java.time.LocalDate.now() : body.getDate();
        return ApiResult.ok(requirementService.markFirstRelease(ctx.getWsId(), id, date));
    }

    /** 删除项目：其下任务保留（解除关联），其下需求文档一并删除 */
    @DeleteMapping({"/api/reqs/{id}", "/api/projects/{id}"})
    public ApiResult<RequirementDeleteResult> delete(@PathVariable String id,
                                                     @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        /* 删除项目会级联删需求文档：仅空间主可执行 */
        workspaceService.requireOwner(userId, ws.getId());
        return ApiResult.ok(requirementService.delete(userId, ws.getId(), id));
    }
}
