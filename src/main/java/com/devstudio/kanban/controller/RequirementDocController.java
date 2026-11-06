package com.devstudio.kanban.controller;

import com.devstudio.kanban.common.ApiResult;
import com.devstudio.kanban.common.CurrentUser;
import com.devstudio.kanban.dto.ReqDocPublishRequest;
import com.devstudio.kanban.dto.ReqDocRestoreRequest;
import com.devstudio.kanban.dto.ReqDocSaveRequest;
import com.devstudio.kanban.dto.ReqDocShareResponse;
import com.devstudio.kanban.dto.ReqDocView;
import com.devstudio.kanban.entity.ReqDocShare;
import com.devstudio.kanban.entity.RequirementDoc;
import com.devstudio.kanban.entity.RequirementDocHistory;
import com.devstudio.kanban.entity.Task;
import com.devstudio.kanban.entity.WorkActivity;
import com.devstudio.kanban.entity.Workspace;
import com.devstudio.kanban.service.RequirementDocService;
import com.devstudio.kanban.service.WorkspaceService;
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
 * 需求（项目下的需求文档）。
 * 层级：空间 → 项目(/api/reqs) → 需求(/api/req-docs) → 任务(task.reqDocId)
 */
@RestController
public class RequirementDocController {

    private final RequirementDocService docService;
    private final WorkspaceService workspaceService;

    public RequirementDocController(RequirementDocService docService, WorkspaceService workspaceService) {
        this.docService = docService;
        this.workspaceService = workspaceService;
    }

    /** 需求列表（含所属项目名、关联任务数、正文摘要），不含完整正文；keyword 按标题/正文模糊搜索 */
    @GetMapping("/api/req-docs")
    public ApiResult<List<ReqDocView>> list(@RequestParam(required = false) String workspace,
                                            @RequestParam(required = false) String keyword) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(docService.list(ws.getId(), userId, keyword));
    }

    /** 需求详情（含正文 HTML） */
    @GetMapping("/api/req-docs/{id}")
    public ApiResult<RequirementDoc> get(@PathVariable String id,
                                        @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(docService.getVisible(ws.getId(), userId, id));
    }

    /** 文档关联的需求池需求（id / title / status / priority） */
    @GetMapping("/api/req-docs/{id}/demands")
    public ApiResult<List<java.util.Map<String, Object>>> demands(@PathVariable String id,
                                                                  @RequestParam(required = false) String workspace) {
        Workspace ws = workspaceService.resolve(CurrentUser.id(), workspace);
        docService.getVisible(ws.getId(), CurrentUser.id(), id);
        return ApiResult.ok(docService.demandsOfDoc(ws.getId(), id));
    }

    @GetMapping("/api/req-docs/{id}/tasks")
    public ApiResult<List<Task>> tasks(@PathVariable String id,
                                       @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        docService.getVisible(ws.getId(), userId, id);
        return ApiResult.ok(docService.tasks(ws.getId(), id));
    }

    /** 需求文档活动轨迹：沿用空间成员权限，并校验文档属于该空间。 */
    @GetMapping("/api/req-docs/{id}/activities")
    public ApiResult<List<WorkActivity>> activities(@PathVariable String id,
                                                    @RequestParam(required = false) String workspace) {
        Workspace ws = workspaceService.resolve(CurrentUser.id(), workspace);
        docService.getVisible(ws.getId(), CurrentUser.id(), id);
        return ApiResult.ok(docService.activities(ws.getId(), id));
    }

    @PostMapping("/api/req-docs")
    public ApiResult<RequirementDoc> create(@Valid @RequestBody ReqDocSaveRequest req,
                                            @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(docService.create(userId, ws.getId(), req));
    }

    @PutMapping("/api/req-docs/{id}")
    public ApiResult<RequirementDoc> update(@PathVariable String id,
                                            @Valid @RequestBody ReqDocSaveRequest req,
                                            @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(docService.update(userId, ws.getId(), id, req));
    }

    /** 文档历史版本列表（不含正文） */
    @GetMapping("/api/req-docs/{id}/history")
    public ApiResult<List<RequirementDocHistory>> history(@PathVariable String id,
                                                          @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(docService.history(ws.getId(), userId, id));
    }

    /** 单个历史版本（含正文） */
    @GetMapping("/api/req-docs/{id}/history/{historyId}")
    public ApiResult<RequirementDocHistory> historyVersion(@PathVariable String id,
                                                           @PathVariable String historyId,
                                                           @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(docService.historyVersion(ws.getId(), userId, id, historyId));
    }

    /** 恢复到指定历史版本（恢复前会把当前正文留一版快照） */
    @PostMapping("/api/req-docs/{id}/restore")
    public ApiResult<RequirementDoc> restore(@PathVariable String id,
                                             @Valid @RequestBody ReqDocRestoreRequest req,
                                             @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(docService.restore(userId, ws.getId(), id, req.getHistoryId()));
    }

    /** 发布 / 收回发布：草稿仅作者与空间管理员可见，发布后按项目可见范围对成员开放 */
    @PutMapping("/api/req-docs/{id}/publish")
    public ApiResult<RequirementDoc> publish(@PathVariable String id,
                                             @RequestBody ReqDocPublishRequest req,
                                             @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        boolean published = req != null && Boolean.TRUE.equals(req.getPublished());
        return ApiResult.ok(docService.publish(userId, ws.getId(), id, published));
    }

    @DeleteMapping("/api/req-docs/{id}")
    public ApiResult<Void> delete(@PathVariable String id,
                                  @RequestParam(required = false) String workspace) {
        Workspace ws = workspaceService.resolve(CurrentUser.id(), workspace);
        docService.delete(CurrentUser.id(), ws.getId(), id);
        return ApiResult.ok(null);
    }

    /* ---------------- 只读分享 ---------------- */

    /** 查看文档的分享链接（能看文档即可；已过期按无链接处理） */
    @GetMapping("/api/req-docs/{id}/share")
    public ApiResult<ReqDocShare> shareInfo(@PathVariable String id,
                                            @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(docService.shareInfo(userId, ws.getId(), id));
    }

    /** 生成/重置分享链接（作者或项目可写者；文档须已发布） */
    @PostMapping("/api/req-docs/{id}/share")
    public ApiResult<ReqDocShare> createShare(@PathVariable String id,
                                              @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(docService.createShare(userId, ws.getId(), id));
    }

    @DeleteMapping("/api/req-docs/{id}/share")
    public ApiResult<Void> revokeShare(@PathVariable String id,
                                       @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        docService.revokeShare(userId, ws.getId(), id);
        return ApiResult.ok(null);
    }

    /** 公开只读：不需要登录，按 token 取数（SecurityConfig 已放行 GET /api/share/**） */
    @GetMapping("/api/share/docs")
    public ApiResult<ReqDocShareResponse> publicShare(@RequestParam(required = false) String token) {
        return ApiResult.ok(docService.publicShare(token));
    }
}
