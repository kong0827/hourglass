package com.hourglass.controller;

import com.hourglass.common.ApiResult;
import com.hourglass.common.CurrentUser;
import com.hourglass.dto.CaseModuleNode;
import com.hourglass.dto.TestModuleSaveRequest;
import com.hourglass.entity.Workspace;
import com.hourglass.service.TestModuleService;
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
 * 测试模块目录：项目下的树（不限层级，仅防环），用例单归属挂在节点上。
 * 与「用例集」的区别：目录计数不重叠、进覆盖矩阵；用例集是多归属的整理工具。
 */
@RestController
public class TestModuleController {

    private final TestModuleService moduleService;
    private final WorkspaceService workspaceService;

    public TestModuleController(TestModuleService moduleService, WorkspaceService workspaceService) {
        this.moduleService = moduleService;
        this.workspaceService = workspaceService;
    }

    /** 目录树：DFS 顺序的扁平列表，带层级、直接挂载数与子树合计 */
    @GetMapping("/api/test-modules")
    public ApiResult<List<CaseModuleNode>> tree(@RequestParam String reqId,
                                                @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(moduleService.tree(ws.getId(), userId, reqId));
    }

    @PostMapping("/api/test-modules")
    public ApiResult<CaseModuleNode> create(@Valid @RequestBody TestModuleSaveRequest req,
                                            @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(moduleService.create(userId, ws.getId(), req));
    }

    /** 改名 / 换父节点（拖拽目录）：校验层级上限、环与同级重名 */
    @PutMapping("/api/test-modules/{id}")
    public ApiResult<CaseModuleNode> update(@PathVariable String id,
                                            @Valid @RequestBody TestModuleSaveRequest req,
                                            @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(moduleService.update(userId, ws.getId(), id, req));
    }

    /**
     * 删除节点：仍有子目录或动态规则引用时拒绝；有工作项 / 需求 / 用例时迁到 targetId。
     * 目录删除限空间主、管理员或项目负责人。
     */
    @DeleteMapping("/api/test-modules/{id}")
    public ApiResult<Void> delete(@PathVariable String id,
                                  @RequestParam(required = false) String targetId,
                                  @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        moduleService.delete(userId, ws.getId(), id,
                targetId == null || targetId.trim().isEmpty() ? null : targetId.trim());
        return ApiResult.ok(null);
    }

    /** 同级排序（拖拽目录）：ids 必须恰好是该父级的全部直接子目录 */
    @PutMapping("/api/test-modules/order")
    public ApiResult<Void> order(@Valid @RequestBody com.hourglass.dto.ColumnOrderRequest req,
                                 @RequestParam String reqId,
                                 @RequestParam(required = false) String parentId,
                                 @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        moduleService.order(userId, ws.getId(), reqId, parentId, req.getIds());
        return ApiResult.ok(null);
    }
}