package com.hourglass.controller;

import com.hourglass.common.ApiResult;
import com.hourglass.common.CurrentUser;
import com.hourglass.dto.CategoryRequest;
import com.hourglass.dto.ColumnOrderRequest;
import com.hourglass.entity.Category;
import com.hourglass.entity.Workspace;
import com.hourglass.service.CategoryService;
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

@RestController
public class CategoryController {

    private final CategoryService categoryService;
    private final WorkspaceService workspaceService;

    public CategoryController(CategoryService categoryService, WorkspaceService workspaceService) {
        this.categoryService = categoryService;
        this.workspaceService = workspaceService;
    }

    @GetMapping("/api/categories")
    public ApiResult<List<Category>> list(@RequestParam(required = false) String workspace) {
        Workspace ws = workspaceService.resolve(CurrentUser.id(), workspace);
        return ApiResult.ok(categoryService.list(ws.getId()));
    }

    @PostMapping("/api/categories")
    public ApiResult<Category> create(@Valid @RequestBody CategoryRequest req,
                                      @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        workspaceService.requireWriter(userId, ws.getId());
        return ApiResult.ok(categoryService.create(ws.getId(), req));
    }

    @PutMapping("/api/categories/{id}")
    public ApiResult<Category> update(@PathVariable String id, @Valid @RequestBody CategoryRequest req,
                                      @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        workspaceService.requireWriter(userId, ws.getId());
        return ApiResult.ok(categoryService.update(ws.getId(), id, req));
    }

    /** 删除分类（仅空间主），其下任务改到第一个分类 */
    @DeleteMapping("/api/categories/{id}")
    public ApiResult<Void> delete(@PathVariable String id, @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        workspaceService.requireOwner(userId, ws.getId());
        categoryService.delete(ws.getId(), id);
        return ApiResult.ok();
    }

    @PutMapping("/api/categories/order")
    public ApiResult<Void> order(@Valid @RequestBody ColumnOrderRequest req,
                                 @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        workspaceService.requireWriter(userId, ws.getId());
        categoryService.order(ws.getId(), req.getIds());
        return ApiResult.ok();
    }
}
