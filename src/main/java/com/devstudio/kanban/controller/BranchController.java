package com.devstudio.kanban.controller;

import com.devstudio.kanban.common.ApiResult;
import com.devstudio.kanban.common.CurrentUser;
import com.devstudio.kanban.dto.BranchSaveRequest;
import com.devstudio.kanban.dto.BranchStatusRequest;
import com.devstudio.kanban.entity.DevBranch;
import com.devstudio.kanban.entity.DevBranchLog;
import com.devstudio.kanban.entity.Workspace;
import com.devstudio.kanban.service.BranchService;
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

/**
 * 分支管理（空间级）。
 *
 * <p>状态：dev(开发中) / testing(待测试) / merging(待合并) / released(已发布)。
 * 改状态走 POST /api/branches/{id}/status —— 它要同时写时间线与状态时间点，
 * 和「改名字/改负责人」这类基础信息编辑分开，避免一次 PUT 悄悄改了状态却没过时间线。
 */
@RestController
public class BranchController {

    private final BranchService branchService;
    private final WorkspaceService workspaceService;

    public BranchController(BranchService branchService, WorkspaceService workspaceService) {
        this.branchService = branchService;
        this.workspaceService = workspaceService;
    }

    /** 分支列表（含关联任务数 / 已完成数 / 归属项目；只统计查看人可见项目） */
    @GetMapping("/api/branches")
    public ApiResult<List<DevBranch>> list(@RequestParam(required = false) String workspace,
                                           @RequestParam(required = false) String project) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(branchService.list(ws.getId(), userId, project));
    }

    @GetMapping("/api/branches/{id}")
    public ApiResult<DevBranch> get(@PathVariable String id,
                                    @RequestParam(required = false) String workspace) {
        Workspace ws = workspaceService.resolve(CurrentUser.id(), workspace);
        return ApiResult.ok(branchService.getDetail(ws.getId(), CurrentUser.id(), id));
    }

    /** 状态变更时间线（倒序：最近的在前） */
    @GetMapping("/api/branches/{id}/logs")
    public ApiResult<List<DevBranchLog>> logs(@PathVariable String id,
                                              @RequestParam(required = false) String workspace) {
        Workspace ws = workspaceService.resolve(CurrentUser.id(), workspace);
        return ApiResult.ok(branchService.logs(ws.getId(), id));
    }

    /** 分支详情里的关联任务列表 */
    @GetMapping("/api/branches/{id}/tasks")
    public ApiResult<List<com.devstudio.kanban.entity.Task>> tasks(@PathVariable String id,
                                                                  @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(branchService.tasks(ws.getId(), userId, id));
    }

    @PostMapping("/api/branches")
    public ApiResult<DevBranch> create(@Valid @RequestBody BranchSaveRequest req,
                                       @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        workspaceService.requireWriter(userId, ws.getId());
        return ApiResult.ok(branchService.create(userId, ws.getId(), req));
    }

    @PutMapping("/api/branches/{id}")
    public ApiResult<DevBranch> update(@PathVariable String id,
                                       @Valid @RequestBody BranchSaveRequest req,
                                       @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        workspaceService.requireWriter(userId, ws.getId());
        return ApiResult.ok(branchService.update(userId, ws.getId(), id, req));
    }

    /** 改状态（唯一入口：会写状态时间点与时间线） */
    @PostMapping("/api/branches/{id}/status")
    public ApiResult<DevBranch> changeStatus(@PathVariable String id,
                                             @Valid @RequestBody BranchStatusRequest req,
                                             @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        workspaceService.requireWriter(userId, ws.getId());
        return ApiResult.ok(branchService.changeStatus(userId, ws.getId(), id, req));
    }

    @DeleteMapping("/api/branches/{id}")
    public ApiResult<Void> delete(@PathVariable String id,
                                  @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        /* 删除分支会清掉操作记录并解除任务关联：仅空间主可执行 */
        workspaceService.requireOwner(userId, ws.getId());
        branchService.delete(ws.getId(), id);
        return ApiResult.ok(null);
    }
}
