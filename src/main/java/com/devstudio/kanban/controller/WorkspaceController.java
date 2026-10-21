package com.devstudio.kanban.controller;

import com.devstudio.kanban.common.ApiResult;
import com.devstudio.kanban.common.CurrentUser;
import com.devstudio.kanban.dto.MemberAddRequest;
import com.devstudio.kanban.dto.WorkspaceCreateRequest;
import com.devstudio.kanban.dto.WorkspaceUpdateRequest;
import com.devstudio.kanban.entity.Workspace;
import com.devstudio.kanban.entity.WorkspaceMember;
import com.devstudio.kanban.service.WorkspaceService;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import javax.validation.Valid;
import java.util.List;

/**
 * 空间：个人空间 + 共享空间（空间主按登录名添加成员，危险操作仅空间主）
 */
@RestController
public class WorkspaceController {

    private final WorkspaceService workspaceService;

    public WorkspaceController(WorkspaceService workspaceService) {
        this.workspaceService = workspaceService;
    }

    /** 我参与的空间（个人空间排前） */
    @GetMapping("/api/workspaces")
    public ApiResult<List<Workspace>> list() {
        return ApiResult.ok(workspaceService.list(CurrentUser.id()));
    }

    /** 新建共享空间 */
    @PostMapping("/api/workspaces")
    public ApiResult<Workspace> create(@Valid @RequestBody WorkspaceCreateRequest req) {
        return ApiResult.ok(workspaceService.createShared(CurrentUser.id(), req.getName()));
    }

    /** 切换当前空间（记住选择） */
    @PostMapping("/api/workspaces/{id}/select")
    public ApiResult<Void> select(@PathVariable String id) {
        workspaceService.select(CurrentUser.id(), id);
        return ApiResult.ok();
    }

    /** 改名 / 配置推送地址（仅空间主） */
    @PutMapping("/api/workspaces/{id}")
    public ApiResult<Workspace> update(@PathVariable String id, @Valid @RequestBody WorkspaceUpdateRequest req) {
        return ApiResult.ok(workspaceService.update(CurrentUser.id(), id, req));
    }

    /** 删除共享空间（仅空间主，连带数据） */
    @DeleteMapping("/api/workspaces/{id}")
    public ApiResult<Void> delete(@PathVariable String id) {
        workspaceService.deleteShared(CurrentUser.id(), id);
        return ApiResult.ok();
    }

    /** 成员列表 */
    @GetMapping("/api/workspaces/{id}/members")
    public ApiResult<List<WorkspaceMember>> members(@PathVariable String id) {
        return ApiResult.ok(workspaceService.members(CurrentUser.id(), id));
    }

    /** 添加成员（仅空间主，按登录名） */
    @PostMapping("/api/workspaces/{id}/members")
    public ApiResult<Void> addMember(@PathVariable String id, @Valid @RequestBody MemberAddRequest req) {
        workspaceService.addMember(CurrentUser.id(), id, req.getUsername());
        return ApiResult.ok();
    }

    /** 移除成员（空间主）/ 退出空间（成员自己） */
    @DeleteMapping("/api/workspaces/{id}/members/{userId}")
    public ApiResult<Void> removeMember(@PathVariable String id, @PathVariable String userId) {
        workspaceService.removeMember(CurrentUser.id(), id, userId);
        return ApiResult.ok();
    }
}
