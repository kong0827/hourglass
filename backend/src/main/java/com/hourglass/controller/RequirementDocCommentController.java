package com.hourglass.controller;

import com.hourglass.common.ApiResult;
import com.hourglass.common.CurrentUser;
import com.hourglass.dto.ReqDocCommentRequest;
import com.hourglass.dto.ReqDocCommentView;
import com.hourglass.entity.Workspace;
import com.hourglass.service.RequirementDocCommentService;
import com.hourglass.service.WorkspaceService;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import javax.validation.Valid;
import java.util.List;

/** 文档评论 */
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
    public ApiResult<List<ReqDocCommentView>> list(@PathVariable String docId,
                                                   @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(commentService.list(ws.getId(), userId, docId));
    }

    @PostMapping("/api/req-docs/{docId}/comments")
    public ApiResult<ReqDocCommentView> create(@PathVariable String docId,
                                               @Valid @RequestBody ReqDocCommentRequest req,
                                               @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(commentService.create(userId, ws.getId(), docId, req));
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
