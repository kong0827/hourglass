package com.hourglass.controller;

import com.hourglass.common.ApiResult;
import com.hourglass.common.CurrentUser;
import com.hourglass.dto.DocCategoryNode;
import com.hourglass.dto.DocCategorySaveRequest;
import com.hourglass.entity.Workspace;
import com.hourglass.service.DocCategoryService;
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
 * 文档分类树：项目级 + 空间级（req_id 空串），不限层级，文档单归属挂在节点上。
 * 与测试模块目录的区别：支持空间级、不限层级；本期仅改名，拖拽移动留待后续。
 */
@RestController
public class DocCategoryController {

    private final DocCategoryService categoryService;
    private final WorkspaceService workspaceService;

    public DocCategoryController(DocCategoryService categoryService, WorkspaceService workspaceService) {
        this.categoryService = categoryService;
        this.workspaceService = workspaceService;
    }

    /**
     * 分类树：DFS 顺序扁平列表，带层级。
     * 不传 reqId → 返回空间下全部可见分类（每个节点带 reqId，前端分组到项目 / 空间两棵树）；
     * 传 reqId（空串=空间级，非空=项目级）→ 只返回该范围的树。
     */
    @GetMapping("/api/doc-categories")
    public ApiResult<List<DocCategoryNode>> list(@RequestParam(required = false) String reqId,
                                                 @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        if (reqId == null) {
            return ApiResult.ok(categoryService.listAll(ws.getId(), userId));
        }
        return ApiResult.ok(categoryService.tree(ws.getId(), userId, reqId));
    }

    @PostMapping("/api/doc-categories")
    public ApiResult<DocCategoryNode> create(@Valid @RequestBody DocCategorySaveRequest req,
                                             @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(categoryService.create(userId, ws.getId(), req));
    }

    /** 改名：本期不支持移动分类（保留原上级与排序），校验同级重名 */
    @PutMapping("/api/doc-categories/{id}")
    public ApiResult<DocCategoryNode> update(@PathVariable String id,
                                             @Valid @RequestBody DocCategorySaveRequest req,
                                             @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(categoryService.update(userId, ws.getId(), id, req));
    }

    /** 删除节点：仍有子分类或挂着文档时拒绝，避免把归类悄悄丢掉 */
    @DeleteMapping("/api/doc-categories/{id}")
    public ApiResult<Void> delete(@PathVariable String id,
                                  @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        categoryService.delete(userId, ws.getId(), id);
        return ApiResult.ok(null);
    }
}