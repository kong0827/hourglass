package com.hourglass.controller;

import com.hourglass.common.ApiResult;
import com.hourglass.common.CurrentUser;
import com.hourglass.dto.ProjectSetSaveRequest;
import com.hourglass.entity.ProjectSet;
import com.hourglass.entity.Workspace;
import com.hourglass.service.ProjectSetService;
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
 * 项目集：项目之上的可选归组。查询对所有空间成员开放（按项目可见性过滤），
 * 增删改仅空间主/管理员（服务层校验）。
 */
@RestController
public class ProjectSetController {

    private final ProjectSetService projectSetService;
    private final WorkspaceService workspaceService;

    public ProjectSetController(ProjectSetService projectSetService, WorkspaceService workspaceService) {
        this.projectSetService = projectSetService;
        this.workspaceService = workspaceService;
    }

    @GetMapping("/api/project-sets")
    public ApiResult<List<ProjectSet>> list(@RequestParam(required = false) String workspace) {
        Workspace ws = workspaceService.resolve(CurrentUser.id(), workspace);
        return ApiResult.ok(projectSetService.list(ws.getId(), CurrentUser.id()));
    }

    @PostMapping("/api/project-sets")
    public ApiResult<ProjectSet> create(@Valid @RequestBody ProjectSetSaveRequest req,
                                        @RequestParam(required = false) String workspace) {
        Workspace ws = workspaceService.resolve(CurrentUser.id(), workspace);
        return ApiResult.ok(projectSetService.create(ws.getId(), CurrentUser.id(), req));
    }

    @PutMapping("/api/project-sets/{id}")
    public ApiResult<ProjectSet> update(@PathVariable String id,
                                        @Valid @RequestBody ProjectSetSaveRequest req,
                                        @RequestParam(required = false) String workspace) {
        Workspace ws = workspaceService.resolve(CurrentUser.id(), workspace);
        return ApiResult.ok(projectSetService.update(ws.getId(), CurrentUser.id(), id, req));
    }

    /** 删除只解绑项目；项目本身与工作项、需求、权限全部保留。 */
    @DeleteMapping("/api/project-sets/{id}")
    public ApiResult<Void> delete(@PathVariable String id,
                                  @RequestParam(required = false) String workspace) {
        Workspace ws = workspaceService.resolve(CurrentUser.id(), workspace);
        projectSetService.delete(ws.getId(), CurrentUser.id(), id);
        return ApiResult.ok();
    }
}
