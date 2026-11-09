package com.hourglass.controller;

import com.hourglass.common.ApiResult;
import com.hourglass.common.CurrentUser;
import com.hourglass.dto.CategoryRequest;
import com.hourglass.dto.ColumnOrderRequest;
import com.hourglass.entity.Category;
import com.hourglass.entity.Workspace;
import com.hourglass.service.CategoryService;
import com.hourglass.service.ProjectAccessService;
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
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

@RestController
public class CategoryController {

    private final CategoryService categoryService;
    private final WorkspaceService workspaceService;
    private final ProjectAccessService projectAccess;

    public CategoryController(CategoryService categoryService, WorkspaceService workspaceService,
                              ProjectAccessService projectAccess) {
        this.categoryService = categoryService;
        this.workspaceService = workspaceService;
        this.projectAccess = projectAccess;
    }

    /** project 为空返回空间内全部项目的模块（跨项目展示/筛选），带 project 只返回该项目清单 */
    @GetMapping("/api/categories")
    public ApiResult<List<Category>> list(@RequestParam(required = false) String project,
                                          @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        List<Category> list = categoryService.list(ws.getId(), project);
        /* 与任务/需求同一可见口径：被设为「不可见」的项目，其模块名也不下发 */
        Set<String> hidden = projectAccess.hiddenProjectIds(ws.getId(), userId);
        if (hidden.isEmpty()) {
            return ApiResult.ok(list);
        }
        List<Category> visible = new ArrayList<Category>();
        for (Category c : list) {
            if (c.getProjectId() == null || !hidden.contains(c.getProjectId())) {
                visible.add(c);
            }
        }
        return ApiResult.ok(visible);
    }

    @PostMapping("/api/categories")
    public ApiResult<Category> create(@Valid @RequestBody CategoryRequest req,
                                      @RequestParam String project,
                                      @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        workspaceService.requireWriter(userId, ws.getId());
        return ApiResult.ok(categoryService.create(ws.getId(), project, req));
    }

    @PutMapping("/api/categories/{id}")
    public ApiResult<Category> update(@PathVariable String id, @Valid @RequestBody CategoryRequest req,
                                      @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        workspaceService.requireWriter(userId, ws.getId());
        return ApiResult.ok(categoryService.update(ws.getId(), id, req));
    }

    /** 删除项目模块（仅空间主），该项目下任务与需求迁到 targetId 指定模块；缺省迁到项目内最靠前的其他模块 */
    @DeleteMapping("/api/categories/{id}")
    public ApiResult<Void> delete(@PathVariable String id,
                                  @RequestParam(required = false) String targetId,
                                  @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        workspaceService.requireOwner(userId, ws.getId());
        String target = targetId == null || targetId.trim().isEmpty() ? null : targetId.trim();
        categoryService.delete(ws.getId(), id, target);
        return ApiResult.ok();
    }

    @PutMapping("/api/categories/order")
    public ApiResult<Void> order(@Valid @RequestBody ColumnOrderRequest req,
                                 @RequestParam String project,
                                 @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        workspaceService.requireWriter(userId, ws.getId());
        categoryService.order(ws.getId(), project, req.getIds());
        return ApiResult.ok();
    }
}
