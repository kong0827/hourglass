package com.devstudio.kanban.controller;

import com.devstudio.kanban.common.ApiResult;
import com.devstudio.kanban.common.AppException;
import com.devstudio.kanban.common.CurrentUser;
import com.devstudio.kanban.dto.MemberAddRequest;
import com.devstudio.kanban.dto.WorkspaceCreateRequest;
import com.devstudio.kanban.dto.WorkspaceUpdateRequest;
import com.devstudio.kanban.entity.AppUser;
import com.devstudio.kanban.entity.Workspace;
import com.devstudio.kanban.entity.WorkspaceMember;
import com.devstudio.kanban.mapper.UserMapper;
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
 * 空间：个人空间 + 共享空间。成员通过邀请链接加入（对方确认）；按登录名直接加人仅平台管理员可用。
 */
@RestController
public class WorkspaceController {

    private final WorkspaceService workspaceService;
    private final UserMapper userMapper;

    public WorkspaceController(WorkspaceService workspaceService, UserMapper userMapper) {
        this.workspaceService = workspaceService;
        this.userMapper = userMapper;
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

    /**
     * 按登录名直接加人只留给平台管理员做运维。
     * 普通空间主不能这么干 —— 那等于不经对方同意就把人拉进空间（对方的「我的任务」/通知里
     * 会突然出现这个空间的内容）。普通空间主请改用「邀请链接」：对方打开链接、确认后才加入。
     */
    @PostMapping("/api/workspaces/{id}/members")
    public ApiResult<Void> addMember(@PathVariable String id, @Valid @RequestBody MemberAddRequest req) {
        AppUser me = userMapper.selectById(CurrentUser.id());
        if (me == null || !"admin".equals(me.getRole())) {
            throw new AppException(403, "共享空间成员需通过邀请链接加入：请生成邀请链接发给对方，对方确认后才会成为成员");
        }
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
