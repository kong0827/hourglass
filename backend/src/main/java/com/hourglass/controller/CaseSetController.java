package com.hourglass.controller;

import com.hourglass.common.ApiResult;
import com.hourglass.common.CurrentUser;
import com.hourglass.dto.CaseSelection;
import com.hourglass.dto.CaseSetSaveRequest;
import com.hourglass.dto.CaseSetView;
import com.hourglass.entity.Workspace;
import com.hourglass.service.CaseSetService;
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
import java.util.Map;

/**
 * 用例集（测试人员自定义分组，多归属）：成员是引用不是复制，删分组不删用例。
 * 团队共享分组可进交付证据；个人分组只本人可见，不进证据链。
 */
@RestController
public class CaseSetController {

    private final CaseSetService setService;
    private final WorkspaceService workspaceService;

    public CaseSetController(CaseSetService setService, WorkspaceService workspaceService) {
        this.setService = setService;
        this.workspaceService = workspaceService;
    }

    /**
     * 项目下当前用户可见的分组（团队共享 + 自己的个人分组），带成员数与可编辑标记。
     * caseId 可选：用例抽屉回显归属，逐组返回 inCase 标记。
     */
    @GetMapping("/api/case-sets")
    public ApiResult<List<CaseSetView>> list(@RequestParam String reqId,
                                             @RequestParam(required = false) String caseId,
                                             @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(setService.list(ws.getId(), userId, reqId, caseId));
    }

    @PostMapping("/api/case-sets")
    public ApiResult<CaseSetView> create(@Valid @RequestBody CaseSetSaveRequest req,
                                         @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(setService.create(userId, ws.getId(), req));
    }

    @PutMapping("/api/case-sets/{id}")
    public ApiResult<CaseSetView> update(@PathVariable String id,
                                         @Valid @RequestBody CaseSetSaveRequest req,
                                         @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(setService.update(userId, ws.getId(), id, req));
    }

    /** 删除分组：只删分组与成员引用，用例本体保留 */
    @DeleteMapping("/api/case-sets/{id}")
    public ApiResult<Void> delete(@PathVariable String id,
                                  @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        setService.delete(userId, ws.getId(), id);
        return ApiResult.ok(null);
    }

    /** 同级分组手动排序：整体提交该父级下的分组顺序 */
    @PutMapping("/api/case-sets/order")
    public ApiResult<Map<String, Object>> order(@Valid @RequestBody com.hourglass.dto.CaseSetOrderRequest req,
                                                @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(setService.order(userId, ws.getId(), req));
    }

    /** 加入分组：范围支持勾选或「全选筛选结果」，已在组内的跳过 */
    @PostMapping("/api/case-sets/{id}/members")
    public ApiResult<Map<String, Object>> addMembers(@PathVariable String id,
                                                     @Valid @RequestBody CaseSelection selection,
                                                     @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(setService.addMembers(userId, ws.getId(), id, selection));
    }

    /** 移出分组（用 POST 承载范围条件，避免 DELETE 带 body 的客户端差异） */
    @PostMapping("/api/case-sets/{id}/members/remove")
    public ApiResult<Map<String, Object>> removeMembers(@PathVariable String id,
                                                        @Valid @RequestBody CaseSelection selection,
                                                        @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(setService.removeMembers(userId, ws.getId(), id, selection));
    }
}