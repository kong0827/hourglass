package com.hourglass.controller;

import com.hourglass.common.ApiResult;
import com.hourglass.common.CurrentUser;
import com.hourglass.dto.SimilarCheckRequest;
import com.hourglass.dto.SimilarCheckResponse;
import com.hourglass.entity.Workspace;
import com.hourglass.service.SimilarItemService;
import com.hourglass.service.WorkspaceService;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import javax.validation.Valid;

/**
 * 新建需求 / 缺陷时的相似条目提示。
 *
 * <p>只读：不写库、不记审计、不调用模型；用 POST 是因为要带描述，且只作为表单输入的一部分。
 * 由于是 POST，ChangeBroadcastFilter 已显式排除 /api/similar/，避免空间内其他人白刷新。
 */
@RestController
public class SimilarItemController {

    private final SimilarItemService similarService;
    private final WorkspaceService workspaceService;

    public SimilarItemController(SimilarItemService similarService, WorkspaceService workspaceService) {
        this.similarService = similarService;
        this.workspaceService = workspaceService;
    }

    @PostMapping("/api/similar/check")
    public ApiResult<SimilarCheckResponse> check(@Valid @RequestBody SimilarCheckRequest req,
                                                 @RequestParam(required = false) String workspace) {
        Workspace ws = workspaceService.resolve(CurrentUser.id(), workspace);
        return ApiResult.ok(similarService.check(CurrentUser.id(), ws.getId(), req));
    }
}
