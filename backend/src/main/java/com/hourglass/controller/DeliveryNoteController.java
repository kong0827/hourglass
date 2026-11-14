package com.hourglass.controller;

import com.hourglass.common.ApiResult;
import com.hourglass.common.CurrentWorkspace;
import com.hourglass.config.WorkspaceCtx;
import com.hourglass.dto.DeliveryNoteResponse;
import com.hourglass.dto.DeliveryNoteSaveRequest;
import com.hourglass.dto.DeliveryShareResponse;
import com.hourglass.dto.PublicDeliveryNote;
import com.hourglass.service.AuditService;
import com.hourglass.service.DeliveryNoteService;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * 一页式交付说明：版本级只读聚合 + 薄人工层 + 不可变快照 + 只读分享。
 *
 * <p>/api/share/delivery 是唯一不需要登录的接口（SecurityConfig 已放行 GET /api/share/**），
 * 只按 token 取冻结载荷，没有任何写入口，内部版快照永不可分享。
 */
@RestController
public class DeliveryNoteController {

    private final DeliveryNoteService notes;
    private final AuditService audit;

    public DeliveryNoteController(DeliveryNoteService notes, AuditService audit) {
        this.notes = notes;
        this.audit = audit;
    }

    @GetMapping("/api/versions/{id}/delivery-note")
    public ApiResult<DeliveryNoteResponse> get(@PathVariable String id,
                                               @RequestParam(required = false) String releaseId,
                                               @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(notes.aggregate(ctx.getWsId(), ctx.getUserId(), id, releaseId));
    }

    @PutMapping("/api/versions/{id}/delivery-note")
    public ApiResult<DeliveryNoteResponse> save(@PathVariable String id,
                                                @RequestBody DeliveryNoteSaveRequest req,
                                                @CurrentWorkspace WorkspaceCtx ctx) {
        DeliveryNoteResponse resp = notes.save(ctx.getWsId(), ctx.getUserId(), id, req);
        audit.recordCurrent(ctx.getWsId(), "delivery_note_save", "project_version", id,
                resp.getVersionName(), true, "保存交付说明人工层与生成控制", null);
        return ApiResult.ok(resp);
    }

    @GetMapping("/api/versions/{id}/delivery-note/snapshots")
    public ApiResult<List<DeliveryNoteResponse.RevisionRow>> snapshots(@PathVariable String id,
                                                                      @CurrentWorkspace WorkspaceCtx ctx) {
        DeliveryNoteResponse current = notes.aggregate(ctx.getWsId(), ctx.getUserId(), id, null);
        return ApiResult.ok(current.getRevisions());
    }

    /** 导出即锁定：落一条不可变快照，之后系统记录变化不影响它 */
    @PostMapping("/api/versions/{id}/delivery-note/snapshots")
    public ApiResult<DeliveryNoteResponse> snapshot(@PathVariable String id,
                                                    @RequestBody(required = false) DeliveryNoteSaveRequest req,
                                                    @CurrentWorkspace WorkspaceCtx ctx) {
        DeliveryNoteResponse resp = notes.createSnapshot(ctx.getWsId(), ctx.getUserId(), id, req);
        audit.recordCurrent(ctx.getWsId(), "delivery_note_snapshot", "delivery_note_snapshot", resp.getSnapshotId(),
                resp.getDocNo(), true, "生成交付说明不可变快照（" + resp.getOptions().get("tone") + "）", null);
        return ApiResult.ok(resp);
    }

    @GetMapping("/api/delivery-notes/{snapshotId}")
    public ApiResult<DeliveryNoteResponse> snapshotDetail(@PathVariable String snapshotId,
                                                          @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(notes.snapshotDetail(ctx.getWsId(), ctx.getUserId(), snapshotId));
    }

    @GetMapping("/api/delivery-notes/{snapshotId}/share")
    public ApiResult<DeliveryShareResponse> shareInfo(@PathVariable String snapshotId,
                                                      @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(notes.shareInfo(ctx.getWsId(), ctx.getUserId(), snapshotId));
    }

    @PostMapping("/api/delivery-notes/{snapshotId}/share")
    public ApiResult<DeliveryShareResponse> createShare(@PathVariable String snapshotId,
                                                        @RequestParam(required = false) Boolean allowDownload,
                                                        @RequestParam(required = false) Integer days,
                                                        @CurrentWorkspace WorkspaceCtx ctx) {
        DeliveryShareResponse resp = notes.createShare(ctx.getWsId(), ctx.getUserId(), snapshotId, allowDownload, days);
        audit.recordCurrent(ctx.getWsId(), "delivery_note_share_create", "delivery_note_snapshot", snapshotId,
                resp.getDocNo(), true, "生成交付说明只读分享链接（有效至 " + resp.getExpiresAt() + "）", null);
        return ApiResult.ok(resp);
    }

    @DeleteMapping("/api/delivery-notes/{snapshotId}/share")
    public ApiResult<Void> revokeShare(@PathVariable String snapshotId, @CurrentWorkspace WorkspaceCtx ctx) {
        notes.revokeShare(ctx.getWsId(), ctx.getUserId(), snapshotId);
        audit.recordCurrent(ctx.getWsId(), "delivery_note_share_revoke", "delivery_note_snapshot", snapshotId,
                null, true, "撤销交付说明只读分享链接", null);
        return ApiResult.ok();
    }

    /** 公开只读：不需要登录 */
    @GetMapping("/api/share/delivery")
    public ApiResult<PublicDeliveryNote> publicShare(@RequestParam(required = false) String token) {
        return ApiResult.ok(notes.publicShare(token));
    }
}