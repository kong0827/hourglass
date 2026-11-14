package com.hourglass.controller;

import com.hourglass.common.ApiResult;
import com.hourglass.common.CurrentUser;
import com.hourglass.dto.RepoSaveRequest;
import com.hourglass.entity.ProjectRepo;
import com.hourglass.entity.Workspace;
import com.hourglass.service.GitSyncService;
import com.hourglass.service.RepoService;
import com.hourglass.service.WorkspaceService;
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
 * 项目仓库绑定（GitLab 只读同步）。
 *
 * <p>读取按项目可见范围；绑定、编辑、启停、立即同步只有空间主可执行 ——
 * 令牌代表一台外部服务的凭据，普通成员不应看到或修改。
 */
@RestController
public class RepoController {

    private final RepoService repoService;
    private final GitSyncService gitSyncService;
    private final WorkspaceService workspaceService;

    public RepoController(RepoService repoService, GitSyncService gitSyncService,
                          WorkspaceService workspaceService) {
        this.repoService = repoService;
        this.gitSyncService = gitSyncService;
        this.workspaceService = workspaceService;
    }

    @GetMapping("/api/repos")
    public ApiResult<List<ProjectRepo>> list(@RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(repoService.list(ws.getId(), userId));
    }

    @PostMapping("/api/repos")
    public ApiResult<ProjectRepo> create(@Valid @RequestBody RepoSaveRequest req,
                                         @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        workspaceService.requireOwner(userId, ws.getId());
        return ApiResult.ok(repoService.create(userId, ws.getId(), req));
    }

    @PutMapping("/api/repos/{id}")
    public ApiResult<ProjectRepo> update(@PathVariable String id,
                                         @Valid @RequestBody RepoSaveRequest req,
                                         @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        workspaceService.requireOwner(userId, ws.getId());
        return ApiResult.ok(repoService.update(userId, ws.getId(), id, req));
    }

    /** 立即同步一次；失败时回写 last_sync_* 并返回错误，不影响其它仓库 */
    @PostMapping("/api/repos/{id}/sync-now")
    public ApiResult<ProjectRepo> syncNow(@PathVariable String id,
                                          @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        workspaceService.requireOwner(userId, ws.getId());
        ProjectRepo repo = repoService.get(ws.getId(), id);
        gitSyncService.syncRepo(repo);
        return ApiResult.ok(repoService.getPublic(ws.getId(), userId, id));
    }

    @PostMapping("/api/repos/{id}/enabled")
    public ApiResult<ProjectRepo> enabled(@PathVariable String id,
                                          @RequestParam boolean enabled,
                                          @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        workspaceService.requireOwner(userId, ws.getId());
        return ApiResult.ok(repoService.setEnabled(userId, ws.getId(), id, enabled));
    }
}
