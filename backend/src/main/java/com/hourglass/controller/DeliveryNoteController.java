package com.hourglass.controller;

import com.hourglass.common.ApiResult;
import com.hourglass.common.CurrentWorkspace;
import com.hourglass.config.WorkspaceCtx;
import com.hourglass.dto.DeliveryNoteResponse;
import com.hourglass.dto.DeliveryNoteSaveRequest;
import com.hourglass.dto.DeliveryShareRequest;
import com.hourglass.dto.DeliveryShareResponse;
import com.hourglass.dto.PublicDeliveryNote;
import com.hourglass.entity.DeliveryNoteShareVisit;
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

import javax.servlet.http.HttpServletRequest;

import java.util.List;
import java.util.Map;

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

    /* ---------- 发布计划维度：一份计划一章版本，人工层按计划单独保存 ---------- */

    @GetMapping("/api/release-plans/{id}/delivery-note")
    public ApiResult<DeliveryNoteResponse> planNote(@PathVariable String id,
                                                    @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(notes.aggregatePlan(ctx.getWsId(), ctx.getUserId(), id));
    }

    @PutMapping("/api/release-plans/{id}/delivery-note")
    public ApiResult<DeliveryNoteResponse> savePlanNote(@PathVariable String id,
                                                        @RequestBody DeliveryNoteSaveRequest req,
                                                        @CurrentWorkspace WorkspaceCtx ctx) {
        DeliveryNoteResponse resp = notes.savePlan(ctx.getWsId(), ctx.getUserId(), id, req);
        audit.recordCurrent(ctx.getWsId(), "delivery_note_save", "version_release_plan", id,
                resp.getScopeName(), true, "保存发布计划交付说明人工层与生成控制", null);
        return ApiResult.ok(resp);
    }

    @GetMapping("/api/release-plans/{id}/delivery-note/snapshots")
    public ApiResult<List<DeliveryNoteResponse.RevisionRow>> planSnapshots(@PathVariable String id,
                                                                          @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(notes.planSnapshots(ctx.getWsId(), ctx.getUserId(), id));
    }

    @PostMapping("/api/release-plans/{id}/delivery-note/snapshots")
    public ApiResult<DeliveryNoteResponse> planSnapshot(@PathVariable String id,
                                                        @RequestBody(required = false) DeliveryNoteSaveRequest req,
                                                        @CurrentWorkspace WorkspaceCtx ctx) {
        DeliveryNoteResponse resp = notes.createPlanSnapshot(ctx.getWsId(), ctx.getUserId(), id, req);
        audit.recordCurrent(ctx.getWsId(), "delivery_note_snapshot", "delivery_note_snapshot", resp.getSnapshotId(),
                resp.getDocNo(), true, "生成发布计划交付说明不可变快照（" + resp.getOptions().get("tone") + "）", null);
        return ApiResult.ok(resp);
    }

    @GetMapping("/api/delivery-notes/{snapshotId}/share")
    public ApiResult<DeliveryShareResponse> shareInfo(@PathVariable String snapshotId,
                                                      @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(notes.shareInfo(ctx.getWsId(), ctx.getUserId(), snapshotId));
    }

    /** 参数优先取请求体（密码不进 URL）；查询参数保留给旧页面缓存兼容。 */
    @PostMapping("/api/delivery-notes/{snapshotId}/share")
    public ApiResult<DeliveryShareResponse> createShare(@PathVariable String snapshotId,
                                                        @RequestBody(required = false) DeliveryShareRequest body,
                                                        @RequestParam(required = false) Boolean allowDownload,
                                                        @RequestParam(required = false) Integer days,
                                                        @RequestParam(required = false) String password,
                                                        @RequestParam(required = false) String domains,
                                                        @RequestParam(required = false) String watermark,
                                                        @CurrentWorkspace WorkspaceCtx ctx) {
        DeliveryShareResponse resp = notes.createShare(ctx.getWsId(), ctx.getUserId(), snapshotId,
                pick(body == null ? null : body.getAllowDownload(), allowDownload),
                pick(body == null ? null : body.getDays(), days),
                pick(body == null ? null : body.getPassword(), password),
                pick(body == null ? null : body.getDomains(), domains),
                pick(body == null ? null : body.getWatermark(), watermark));
        audit.recordCurrent(ctx.getWsId(), "delivery_note_share_create", "delivery_note_snapshot", snapshotId,
                resp.getDocNo(), true, "生成交付说明只读分享链接（有效至 " + resp.getExpiresAt()
                        + (resp.getPasswordRequired() ? "，需访问密码" : "")
                        + (resp.getWatermarkText() != null ? "，带水印" : "") + "）", null);
        return ApiResult.ok(resp);
    }

    private static <T> T pick(T fromBody, T fromQuery) {
        return fromBody != null ? fromBody : fromQuery;
    }

    @GetMapping("/api/delivery-notes/{snapshotId}/share/visits")
    public ApiResult<List<DeliveryNoteShareVisit>> shareVisits(@PathVariable String snapshotId,
                                                               @CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(notes.shareVisits(ctx.getWsId(), ctx.getUserId(), snapshotId));
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
    public ApiResult<PublicDeliveryNote> publicShare(@RequestParam(required = false) String token,
                                                     @RequestParam(required = false) String from,
                                                     HttpServletRequest request) {
        return ApiResult.ok(notes.publicShare(token, clientIp(request),
                request.getHeader("User-Agent"), sourceOf(request, from)));
    }

    /** 有访问密码时，接收人先校验密码再取正文 */
    @PostMapping("/api/share/delivery/unlock")
    public ApiResult<PublicDeliveryNote> unlock(@RequestBody Map<String, String> body,
                                                HttpServletRequest request) {
        return ApiResult.ok(notes.unlock(body == null ? null : body.get("token"),
                body == null ? null : body.get("password"),
                clientIp(request), request.getHeader("User-Agent"),
                sourceOf(request, body == null ? null : body.get("from"))));
    }

    /** 接收人下载留痕（仅记录，不返回正文）；受密码保护的分享需带上解锁密码 */
    @PostMapping("/api/share/delivery/visit")
    public ApiResult<Void> visit(@RequestBody(required = false) Map<String, String> body,
                                 @RequestParam(required = false) String token,
                                 @RequestParam(required = false) String action,
                                 @RequestParam(required = false) String from,
                                 @RequestParam(required = false) String password,
                                 HttpServletRequest request) {
        String act = pick(action, body == null ? null : body.get("action"));
        if ("download".equals(act)) {
            notes.logShareDownload(pick(token, body == null ? null : body.get("token")),
                    pick(password, body == null ? null : body.get("password")),
                    clientIp(request), request.getHeader("User-Agent"),
                    sourceOf(request, pick(from, body == null ? null : body.get("from"))));
        }
        return ApiResult.ok();
    }

    /* 分享页自己的请求 Referer 是本服务域名，判断域名白名单要用接收人真正的来路：
       前端把 document.referrer 作为 from 传上来，缺失时再退回请求头 */
    private static String sourceOf(HttpServletRequest request, String explicit) {
        if (explicit != null && !explicit.trim().isEmpty()) {
            return explicit.trim();
        }
        return request.getHeader("Referer");
    }

    private static String clientIp(HttpServletRequest request) {
        String forwarded = request.getHeader("X-Forwarded-For");
        if (forwarded != null && !forwarded.trim().isEmpty()) {
            int comma = forwarded.indexOf(',');
            return comma >= 0 ? forwarded.substring(0, comma).trim() : forwarded.trim();
        }
        return request.getRemoteAddr();
    }
}