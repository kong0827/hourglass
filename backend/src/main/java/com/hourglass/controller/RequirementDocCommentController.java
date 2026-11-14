package com.hourglass.controller;

import com.hourglass.common.ApiResult;
import com.hourglass.common.CurrentUser;
import com.hourglass.dto.ReqDocCommentRequest;
import com.hourglass.dto.ReqDocCommentResolveRequest;
import com.hourglass.dto.ReqDocCommentView;
import com.hourglass.entity.Workspace;
import com.hourglass.entity.WorkspaceMember;
import com.hourglass.service.RequirementDocCommentService;
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

/** 文档评论：一层回复、解决、@提及、转工作项 */
@RestController
public class RequirementDocCommentController {

    private final RequirementDocCommentService commentService;
    private final WorkspaceService workspaceService;

    public RequirementDocCommentController(RequirementDocCommentService commentService,
                                           WorkspaceService workspaceService) {
        this.commentService = commentService;
        this.workspaceService = workspaceService;
    }

    @GetMapping("/api/req-docs/{docId}/comments")
    public ApiResult<com.hourglass.dto.PageResult<ReqDocCommentView>> list(
            @PathVariable String docId,
            @RequestParam(required = false) String workspace,
            @RequestParam(required = false) Boolean unresolved,
            @RequestParam(required = false) Integer offset,
            @RequestParam(required = false) Integer limit) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(commentService.list(ws.getId(), userId, docId,
                Boolean.TRUE.equals(unresolved),
                offset == null ? 0 : offset, limit == null ? 100 : limit));
    }

    @GetMapping("/api/req-docs/{docId}/comments/counts")
    public ApiResult<Map<String, Integer>> counts(@PathVariable String docId,
                                                  @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(commentService.counts(ws.getId(), userId, docId));
    }

    @PostMapping("/api/req-docs/{docId}/comments")
    public ApiResult<ReqDocCommentView> create(@PathVariable String docId,
                                               @Valid @RequestBody ReqDocCommentRequest req,
                                               @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(commentService.create(userId, ws.getId(), docId, req));
    }

    @PutMapping("/api/req-docs/{docId}/comments/{commentId}/resolve")
    public ApiResult<ReqDocCommentView> resolve(@PathVariable String docId,
                                                @PathVariable String commentId,
                                                @RequestBody ReqDocCommentResolveRequest req,
                                                @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        boolean resolved = req != null && Boolean.TRUE.equals(req.getResolved());
        return ApiResult.ok(commentService.resolve(userId, ws.getId(), docId, commentId, resolved));
    }

    @PostMapping("/api/req-docs/{docId}/comments/{commentId}/to-task")
    public ApiResult<Map<String, Object>> toTask(@PathVariable String docId,
                                                 @PathVariable String commentId,
                                                 @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(commentService.toTask(userId, ws.getId(), docId, commentId));
    }

    @GetMapping("/api/req-docs/{docId}/mention-candidates")
    public ApiResult<List<WorkspaceMember>> mentionCandidates(@PathVariable String docId,
                                                              @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(commentService.mentionCandidates(userId, ws.getId(), docId));
    }

    @DeleteMapping("/api/req-docs/{docId}/comments/{commentId}")
    public ApiResult<Void> delete(@PathVariable String docId,
                                  @PathVariable String commentId,
                                  @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        commentService.delete(userId, ws.getId(), docId, commentId);
        return ApiResult.ok(null);
    }
}
