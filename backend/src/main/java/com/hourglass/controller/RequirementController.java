package com.hourglass.controller;

import com.hourglass.common.ApiResult;
import com.hourglass.common.CurrentUser;
import com.hourglass.common.CurrentWorkspace;
import com.hourglass.common.RequireRole;
import com.hourglass.config.WorkspaceCtx;
import com.hourglass.dto.FirstReleaseRequest;
import com.hourglass.dto.PageResult;
import com.hourglass.dto.ReqOrderRequest;
import com.hourglass.dto.ReqProgress;
import com.hourglass.dto.ReqSaveRequest;
import com.hourglass.dto.RequirementDeleteResult;
import com.hourglass.entity.Requirement;
import com.hourglass.entity.Task;
import com.hourglass.entity.WorkActivity;
import com.hourglass.entity.Workspace;
import com.hourglass.mapper.RequirementMapper;
import com.hourglass.service.AuditService;
import com.hourglass.service.RequirementService;
import com.hourglass.service.WorkspaceService;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import javax.servlet.http.HttpServletRequest;
import javax.validation.Valid;

@RestController
public class RequirementController {

    private final RequirementService requirementService;
    private final WorkspaceService workspaceService;
    private final RequirementMapper requirementMapper;
    private final AuditService audit;

    public RequirementController(RequirementService requirementService, WorkspaceService workspaceService,
                                 RequirementMapper requirementMapper, AuditService audit) {
        this.requirementService = requirementService;
        this.workspaceService = workspaceService;
        this.requirementMapper = requirementMapper;
        this.audit = audit;
    }

    /** 项目列表（含任务数、完成数、平均进度） */
    @GetMapping({"/api/reqs", "/api/projects"})
    public ApiResult<PageResult<ReqProgress>> list(@RequestParam(required = false) String workspace,
                                                   @RequestParam(required = false) Integer offset,
                                                   @RequestParam(required = false) Integer limit) {
        Workspace ws = workspaceService.resolve(CurrentUser.id(), workspace);
        return ApiResult.ok(requirementService.page(ws.getId(), CurrentUser.id(),
                offset == null ? 0 : offset, limit == null ? 100 : limit));
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

    /** 项目手动排序：ids 为空间内全部项目的新顺序，项目列表与下拉框据此排序 */
    @PutMapping({"/api/reqs/order", "/api/projects/order"})
    public ApiResult<Void> reorder(@RequestBody ReqOrderRequest body,
                                   @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        requirementService.reorder(ws.getId(), userId, body == null ? null : body.getIds());
        return ApiResult.ok();
    }

    /** 项目活动轨迹：沿用空间成员权限，并校验项目属于该空间。 */
    @GetMapping({"/api/reqs/{id}/activities", "/api/projects/{id}/activities"})
    public ApiResult<PageResult<WorkActivity>> activities(@PathVariable String id,
                                                          @RequestParam(required = false) String workspace,
                                                          @RequestParam(required = false) Integer offset,
                                                          @RequestParam(required = false) Integer limit) {
        Workspace ws = workspaceService.resolve(CurrentUser.id(), workspace);
        return ApiResult.ok(requirementService.activities(ws.getId(), CurrentUser.id(), id,
                offset == null ? 0 : offset, limit == null ? 100 : limit));
    }

    @GetMapping({"/api/reqs/{id}/tasks", "/api/projects/{id}/tasks"})
    public ApiResult<PageResult<Task>> tasks(@PathVariable String id,
                                             @RequestParam(required = false) String workspace,
                                             @RequestParam(required = false) Integer offset,
                                             @RequestParam(required = false) Integer limit) {
        Workspace ws = workspaceService.resolve(CurrentUser.id(), workspace);
        return ApiResult.ok(requirementService.tasks(ws.getId(), CurrentUser.id(), id,
                offset == null ? 0 : offset, limit == null ? 100 : limit));
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

    /** 归档项目：只从默认视图隐藏，不删除任何数据；archived=false 可恢复 */
    @PutMapping({"/api/reqs/{id}/archive", "/api/projects/{id}/archive"})
    public ApiResult<Requirement> archive(@PathVariable String id,
                                          @RequestParam(defaultValue = "true") boolean archived,
                                          @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(requirementService.setArchived(ws.getId(), userId, id, archived));
    }

    /** 删除影响预览（A5）：任务解绑数/文档/版本/需求池/用例数量，确认框据此写准确文案 */
    @GetMapping({"/api/reqs/{id}/delete-impact", "/api/projects/{id}/delete-impact"})
    public ApiResult<RequirementDeleteResult> deleteImpact(@PathVariable String id,
                                                           @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        /* 只为删除确认服务，删除仅空间主可执行：预览口径保持一致，不对其他成员暴露项目规模 */
        workspaceService.requireOwner(userId, ws.getId());
        return ApiResult.ok(requirementService.deleteImpact(ws.getId(), userId, id));
    }

    /**
     * 删除项目：其下任务保留（解除关联），其下需求文档/用例/版本/需求池条目一并删除。
     * A5 删除保护：服务端强制"输入完整项目名"确认——与前端确认框同口径，
     * 绕过前端的直接 API 调用同样被拦下（400 并附预览接口地址）。
     */
    @DeleteMapping({"/api/reqs/{id}", "/api/projects/{id}"})
    public ApiResult<RequirementDeleteResult> delete(@PathVariable String id,
                                                     @RequestParam(required = false) String confirm,
                                                     @RequestParam(required = false) String workspace,
                                                     HttpServletRequest request) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        /* 删除项目会级联删需求文档：仅空间主可执行 */
        workspaceService.requireOwner(userId, ws.getId());
        Requirement project = requirementMapper.selectById(id);
        if (project == null || !ws.getId().equals(project.getWorkspaceId())) {
            throw new com.hourglass.common.AppException(404, "项目不存在");
        }
        if (confirm == null || !confirm.equals(project.getName())) {
            throw com.hourglass.common.AppException.badRequest(
                    "删除项目需要输入完整项目名确认（防误删）；影响范围请先查 GET /api/reqs/" + id + "/delete-impact");
        }
        RequirementDeleteResult result = requirementService.delete(userId, ws.getId(), id);
        audit.recordCurrent(ws.getId(), "project_delete", "project", id,
                project == null ? id : project.getName(), true,
                "删除项目「" + (project == null ? id : project.getName()) + "」，解除关联 "
                        + result.getUnlinked() + " 项任务" + (result.getDocs() > 0 ? "，" + result.getDocs() + " 份文档" : ""),
                request);
        return ApiResult.ok(result);
    }
}
