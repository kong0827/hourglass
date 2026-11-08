package com.devstudio.kanban.controller;

import com.devstudio.kanban.common.ApiResult;
import com.devstudio.kanban.common.CurrentUser;
import com.devstudio.kanban.dto.TaskCommentRequest;
import com.devstudio.kanban.entity.TaskComment;
import com.devstudio.kanban.entity.Workspace;
import com.devstudio.kanban.entity.WorkspaceMember;
import com.devstudio.kanban.service.TaskCommentService;
import com.devstudio.kanban.service.WorkspaceService;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import javax.validation.Valid;
import java.util.List;

/** 任务评论 / 讨论（N-6） */
@RestController
public class TaskCommentController {

    private final TaskCommentService commentService;
    private final WorkspaceService workspaceService;

    public TaskCommentController(TaskCommentService commentService, WorkspaceService workspaceService) {
        this.commentService = commentService;
        this.workspaceService = workspaceService;
    }

    @GetMapping("/api/tasks/{id}/comments")
    public ApiResult<List<TaskComment>> list(@PathVariable String id,
                                             @RequestParam(required = false) Long beforeId,
                                             @RequestParam(required = false) Integer limit,
                                             @RequestParam(required = false) String workspace) {
        Workspace ws = workspaceService.resolve(CurrentUser.id(), workspace);
        return ApiResult.ok(commentService.list(ws.getId(), CurrentUser.id(), id, beforeId, limit));
    }

    @PostMapping("/api/tasks/{id}/comments")
    public ApiResult<TaskComment> create(@PathVariable String id,
                                         @Valid @RequestBody TaskCommentRequest req,
                                         @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(commentService.create(userId, ws.getId(), id, req.getContent(),
                req.getMentionUserIds()));
    }

    /** @提及候选：只返回对该任务所在项目可见的空间成员 */
    @GetMapping("/api/tasks/{id}/mention-candidates")
    public ApiResult<List<WorkspaceMember>> mentionCandidates(@PathVariable String id,
                                                              @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(commentService.mentionCandidates(userId, ws.getId(), id));
    }

    @DeleteMapping("/api/comments/{id}")
    public ApiResult<Void> delete(@PathVariable Long id, @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        commentService.delete(userId, ws.getId(), id);
        return ApiResult.ok();
    }
}
