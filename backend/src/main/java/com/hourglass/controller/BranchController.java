package com.hourglass.controller;

import com.hourglass.common.ApiResult;
import com.hourglass.common.CurrentUser;
import com.hourglass.dto.BranchSaveRequest;
import com.hourglass.dto.BranchStatusRequest;
import com.hourglass.entity.DevBranch;
import com.hourglass.entity.DevBranchLog;
import com.hourglass.entity.Workspace;
import com.hourglass.service.BranchService;
import com.hourglass.service.WorkspaceService;
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

    /** 分支看板：各状态先给一屏 + 状态计数；列内滚动加载走 /api/branches/page */
    @GetMapping("/api/branches/board")
    public ApiResult<com.hourglass.dto.BranchBoard> board(@RequestParam(required = false) String workspace,
                                                          @RequestParam(required = false) String project,
                                                          @RequestParam(required = false) String q,
                                                          @RequestParam(required = false) Integer limit) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        com.hourglass.dto.BranchQuery query = new com.hourglass.dto.BranchQuery();
        query.setProjectId(project);
        query.setQ(q);
        if (limit != null) {
            query.setLimit(limit);
        }
        return ApiResult.ok(branchService.board(ws.getId(), userId, query));
    }

    /** 分支按状态分页（滚动加载已发布等大分组） */
    @GetMapping("/api/branches/page")
    public ApiResult<com.hourglass.dto.BranchPage> page(@RequestParam(required = false) String workspace,
                                                        @RequestParam(required = false) String status,
                                                        @RequestParam(required = false) String project,
                                                        @RequestParam(required = false) String q,
                                                        @RequestParam(required = false) Integer offset,
                                                        @RequestParam(required = false) Integer limit) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        com.hourglass.dto.BranchQuery query = new com.hourglass.dto.BranchQuery();
        query.setStatus(status);
        query.setProjectId(project);
        query.setQ(q);
        if (offset != null) {
            query.setOffset(offset);
        }
        if (limit != null) {
            query.setLimit(limit);
        }
        return ApiResult.ok(branchService.page(ws.getId(), userId, query));
    }

    /** 轻量分支选项：任务抽屉下拉、看板卡片分支名映射用 */
    @GetMapping("/api/branches/options")
    public ApiResult<List<DevBranch>> options(@RequestParam(required = false) String workspace,
                                              @RequestParam(required = false) String project) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(branchService.options(ws.getId(), userId, project));
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
        return ApiResult.ok(branchService.logs(ws.getId(), CurrentUser.id(), id));
    }

    /** 分支详情里的关联任务列表 */
    @GetMapping("/api/branches/{id}/tasks")
    public ApiResult<List<com.hourglass.entity.Task>> tasks(@PathVariable String id,
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
        branchService.delete(userId, ws.getId(), id);
        return ApiResult.ok(null);
    }
}
