package com.hourglass.controller;

import com.hourglass.common.ApiResult;
import com.hourglass.common.CurrentUser;
import com.hourglass.dto.DemandCommentRequest;
import com.hourglass.dto.DemandCommentResolveRequest;
import com.hourglass.dto.DemandCommentView;
import com.hourglass.entity.Workspace;
import com.hourglass.entity.WorkspaceMember;
import com.hourglass.service.DemandCommentService;
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

/** 需求池评论：一层回复、解决、@提及、转工作项 */
@RestController
public class DemandCommentController {

    private final DemandCommentService commentService;
    private final WorkspaceService workspaceService;

    public DemandCommentController(DemandCommentService commentService, WorkspaceService workspaceService) {
        this.commentService = commentService;
        this.workspaceService = workspaceService;
    }

    @GetMapping("/api/demands/{demandId}/comments")
    public ApiResult<com.hourglass.dto.PageResult<DemandCommentView>> list(
            @PathVariable String demandId,
            @RequestParam(required = false) String workspace,
            @RequestParam(required = false) Boolean unresolved,
            @RequestParam(required = false) Integer offset,
            @RequestParam(required = false) Integer limit) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(commentService.list(ws.getId(), userId, demandId,
                Boolean.TRUE.equals(unresolved), offset == null ? 0 : offset, limit == null ? 100 : limit));
    }

    @GetMapping("/api/demands/{demandId}/comments/counts")
    public ApiResult<Map<String, Integer>> counts(@PathVariable String demandId,
                                                  @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(commentService.counts(ws.getId(), userId, demandId));
    }

    @PostMapping("/api/demands/{demandId}/comments")
    public ApiResult<DemandCommentView> create(@PathVariable String demandId,
                                               @Valid @RequestBody DemandCommentRequest req,
                                               @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(commentService.create(userId, ws.getId(), demandId, req));
    }

    @PutMapping("/api/demands/{demandId}/comments/{commentId}/resolve")
    public ApiResult<DemandCommentView> resolve(@PathVariable String demandId,
                                                @PathVariable String commentId,
                                                @RequestBody DemandCommentResolveRequest req,
                                                @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        boolean resolved = req != null && Boolean.TRUE.equals(req.getResolved());
        return ApiResult.ok(commentService.resolve(userId, ws.getId(), demandId, commentId, resolved));
    }

    @PostMapping("/api/demands/{demandId}/comments/{commentId}/to-task")
    public ApiResult<Map<String, Object>> toTask(@PathVariable String demandId,
                                                 @PathVariable String commentId,
                                                 @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(commentService.toTask(userId, ws.getId(), demandId, commentId));
    }

    @GetMapping("/api/demands/{demandId}/mention-candidates")
    public ApiResult<List<WorkspaceMember>> mentionCandidates(@PathVariable String demandId,
                                                              @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(commentService.mentionCandidates(userId, ws.getId(), demandId));
    }

    @DeleteMapping("/api/demands/{demandId}/comments/{commentId}")
    public ApiResult<Void> delete(@PathVariable String demandId,
                                  @PathVariable String commentId,
                                  @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        commentService.delete(userId, ws.getId(), demandId, commentId);
        return ApiResult.ok(null);
    }
}
