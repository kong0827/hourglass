package com.hourglass.controller;

import com.hourglass.common.ApiResult;
import com.hourglass.common.Consts;
import com.hourglass.common.CurrentUser;
import com.hourglass.dto.ColumnOrderRequest;
import com.hourglass.dto.ColumnRequest;
import com.hourglass.dto.ColumnTransitionRequest;
import com.hourglass.dto.ColumnTransitionView;
import com.hourglass.dto.BoardResponse;
import com.hourglass.entity.BoardColumn;
import com.hourglass.entity.Workspace;
import com.hourglass.service.BoardColumnService;
import com.hourglass.service.ColumnTransitionService;
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

@RestController
public class ColumnController {

    private final BoardColumnService boardColumnService;
    private final ColumnTransitionService transitionService;
    private final WorkspaceService workspaceService;

    public ColumnController(BoardColumnService boardColumnService,
                            ColumnTransitionService transitionService,
                            WorkspaceService workspaceService) {
        this.boardColumnService = boardColumnService;
        this.transitionService = transitionService;
        this.workspaceService = workspaceService;
    }

    /** 看板列定义（含系统「已完成」列） */
    @GetMapping("/api/columns")
    public ApiResult<List<BoardResponse.ColumnDef>> list(@RequestParam(required = false) String workspace) {
        Workspace ws = workspaceService.resolve(CurrentUser.id(), workspace);
        List<BoardResponse.ColumnDef> defs = new ArrayList<BoardResponse.ColumnDef>();
        for (BoardColumn c : boardColumnService.list(ws.getId())) {
            defs.add(new BoardResponse.ColumnDef(c.getId(), c.getName(), c.getColor(),
                    processingRuleOf(c), false));
        }
        defs.add(new BoardResponse.ColumnDef(Consts.COL_DONE, "已完成", "#5f7a4a", "done", true));
        return ApiResult.ok(defs);
    }

    private String processingRuleOf(BoardColumn c) {
        if (Consts.COL_BACKLOG.equals(c.getId())) {
            return "backlog";
        }
        if (Consts.COL_DOING.equals(c.getId())) {
            return "normal";
        }
        String rule = c.getProcessingRule();
        return rule == null ? "normal" : rule;
    }

    /** 状态流转矩阵（含默认值，任何成员可查看） */
    @GetMapping("/api/columns/transitions")
    public ApiResult<ColumnTransitionView> transitions(@RequestParam(required = false) String workspace) {
        Workspace ws = workspaceService.resolve(CurrentUser.id(), workspace);
        return ApiResult.ok(transitionService.view(ws.getId()));
    }

    /** 修改单个格子：空间主 / 管理员 */
    @PutMapping("/api/columns/transitions")
    public ApiResult<Void> saveTransition(@Valid @RequestBody ColumnTransitionRequest req,
                                          @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        workspaceService.requireManager(userId, ws.getId());
        transitionService.save(ws.getId(), req.getFrom().trim(), req.getTo().trim(), req.getRule());
        return ApiResult.ok();
    }

    /** 恢复默认（删除全部显式配置）：空间主 / 管理员 */
    @PostMapping("/api/columns/transitions/reset")
    public ApiResult<Void> resetTransitions(@RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        workspaceService.requireManager(userId, ws.getId());
        transitionService.reset(ws.getId());
        return ApiResult.ok();
    }

    @PostMapping("/api/columns")
    public ApiResult<BoardColumn> create(@Valid @RequestBody ColumnRequest req,
                                         @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        workspaceService.requireWriter(userId, ws.getId());
        return ApiResult.ok(boardColumnService.create(ws.getId(), req));
    }

    @PutMapping("/api/columns/{id}")
    public ApiResult<BoardColumn> update(@PathVariable String id, @Valid @RequestBody ColumnRequest req,
                                         @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        workspaceService.requireWriter(userId, ws.getId());
        return ApiResult.ok(boardColumnService.update(ws.getId(), id, req));
    }

    /** 删除列（仅空间主） */
    @DeleteMapping("/api/columns/{id}")
    public ApiResult<Void> delete(@PathVariable String id, @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        workspaceService.requireOwner(userId, ws.getId());
        boardColumnService.delete(ws.getId(), id);
        return ApiResult.ok();
    }

    @PutMapping("/api/columns/order")
    public ApiResult<Void> order(@Valid @RequestBody ColumnOrderRequest req,
                                 @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        workspaceService.requireWriter(userId, ws.getId());
        boardColumnService.order(ws.getId(), req.getIds());
        return ApiResult.ok();
    }
}
