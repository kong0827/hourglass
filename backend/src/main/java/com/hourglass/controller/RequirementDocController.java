package com.hourglass.controller;

import com.hourglass.common.ApiResult;
import com.hourglass.common.AppException;
import com.hourglass.common.CurrentUser;
import com.hourglass.dto.PageResult;
import com.hourglass.dto.ReqDocActivityView;
import com.hourglass.dto.ReqDocPublishRequest;
import com.hourglass.dto.ReqDocRenameRequest;
import com.hourglass.dto.ReqDocReorderRequest;
import com.hourglass.dto.ReqDocRestoreRequest;
import com.hourglass.dto.ReqDocSaveRequest;
import com.hourglass.dto.ReqDocShareResponse;
import com.hourglass.dto.ReqDocStatusRequest;
import com.hourglass.dto.ReqDocView;
import com.hourglass.dto.ReqDocVisibilityRequest;
import com.hourglass.entity.ReqDocShare;
import com.hourglass.entity.RequirementDoc;
import com.hourglass.entity.RequirementDocHistory;
import com.hourglass.entity.Task;
import com.hourglass.entity.WorkActivity;
import com.hourglass.entity.Workspace;
import com.hourglass.service.HtmlDocxService;
import com.hourglass.service.RequirementDocService;
import com.hourglass.service.WorkspaceService;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import javax.validation.Valid;
import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 需求（项目下的需求文档）。
 * 层级：空间 → 项目(/api/reqs) → 需求(/api/req-docs) → 任务(task.reqDocId)
 */
@RestController
public class RequirementDocController {

    private final RequirementDocService docService;
    private final WorkspaceService workspaceService;
    private final HtmlDocxService htmlDocxService;

    public RequirementDocController(RequirementDocService docService, WorkspaceService workspaceService,
                                    HtmlDocxService htmlDocxService) {
        this.docService = docService;
        this.workspaceService = workspaceService;
        this.htmlDocxService = htmlDocxService;
    }

    /** 需求列表（含所属项目名、关联任务数、正文摘要），不含完整正文；keyword 按标题/正文模糊搜索 */
    @GetMapping("/api/req-docs")
    public ApiResult<PageResult<ReqDocView>> list(@RequestParam(required = false) String workspace,
                                                  @RequestParam(required = false) String reqId,
                                                  @RequestParam(required = false) String categoryId,
                                                  @RequestParam(required = false, defaultValue = "false") boolean spaceOnly,
                                                  @RequestParam(required = false) String keyword,
                                                  @RequestParam(required = false) Integer offset,
                                                  @RequestParam(required = false) Integer limit) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(docService.page(ws.getId(), userId, reqId, categoryId, spaceOnly, keyword,
                offset == null ? 0 : offset, limit == null ? 100 : limit));
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
    public ApiResult<PageResult<java.util.Map<String, Object>>> demands(
            @PathVariable String id,
            @RequestParam(required = false) String workspace,
            @RequestParam(required = false) Integer offset,
            @RequestParam(required = false) Integer limit) {
        Workspace ws = workspaceService.resolve(CurrentUser.id(), workspace);
        docService.getVisible(ws.getId(), CurrentUser.id(), id);
        return ApiResult.ok(docService.demandsOfDoc(ws.getId(), id,
                offset == null ? 0 : offset, limit == null ? 100 : limit));
    }

    @GetMapping("/api/req-docs/{id}/tasks")
    public ApiResult<PageResult<Task>> tasks(@PathVariable String id,
                                             @RequestParam(required = false) String workspace,
                                             @RequestParam(required = false) Integer offset,
                                             @RequestParam(required = false) Integer limit) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        docService.getVisible(ws.getId(), userId, id);
        return ApiResult.ok(docService.taskPage(ws.getId(), id,
                offset == null ? 0 : offset, limit == null ? 100 : limit));
    }

    /** 需求文档活动轨迹：沿用空间成员权限，并校验文档属于该空间。 */
    @GetMapping("/api/req-docs/{id}/activities")
    public ApiResult<PageResult<WorkActivity>> activities(@PathVariable String id,
                                                          @RequestParam(required = false) String workspace,
                                                          @RequestParam(required = false) Integer offset,
                                                          @RequestParam(required = false) Integer limit) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(docService.activities(ws.getId(), userId, id,
                offset == null ? 0 : offset, limit == null ? 100 : limit));
    }

    /** 文档最近动态（空间级）：全部文档的创建/更新/状态流转/发布等活动，按查看人过滤可见性 */
    @GetMapping("/api/req-docs/activities")
    public ApiResult<PageResult<ReqDocActivityView>> docActivities(
            @RequestParam(required = false) String workspace,
            @RequestParam(required = false) Integer offset,
            @RequestParam(required = false) Integer limit) {
        Workspace ws = workspaceService.resolve(CurrentUser.id(), workspace);
        return ApiResult.ok(docService.feedActivities(ws.getId(), CurrentUser.id(),
                offset == null ? 0 : offset, limit == null ? 100 : limit));
    }

    @PostMapping("/api/req-docs")
    public ApiResult<RequirementDoc> create(@Valid @RequestBody ReqDocSaveRequest req,
                                            @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(docService.create(userId, ws.getId(), req));
    }

    /** 导入 Word 文件（docx 保留排版，doc 提取纯文本），返回清洗后的 HTML 正文 */
    @PostMapping("/api/req-docs/import-word")
    public ApiResult<Map<String, String>> importWord(@RequestParam("file") MultipartFile file,
                                                     @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        if (file == null || file.isEmpty()) {
            return ApiResult.error(400, "请选择文件");
        }
        if (file.getSize() > 10L * 1024 * 1024) {
            return ApiResult.error(400, "文件不能超过 10MB");
        }
        String original = file.getOriginalFilename();
        String ext = null;
        if (original != null) {
            int idx = original.lastIndexOf('.');
            ext = idx > 0 ? original.substring(idx + 1).toLowerCase() : null;
        }
        if (!"docx".equals(ext) && !"doc".equals(ext)) {
            return ApiResult.error(400, "仅支持 .docx / .doc 格式");
        }
        File temp = null;
        try {
            temp = File.createTempFile("hourglass-word-import-", "." + ext);
            file.transferTo(temp);
            String html = docService.importWord(temp, ext);
            Map<String, String> data = new LinkedHashMap<String, String>();
            data.put("format", "html");
            data.put("content", html);
            return ApiResult.ok(data);
        } catch (IOException e) {
            throw new AppException(500, "文件处理失败");
        } finally {
            if (temp != null && temp.exists()) {
                temp.delete();
            }
        }
    }

    /**
     * 导出 Word（.docx）：正文由前端按当前编辑内容传入，Markdown 已先转成 HTML。
     * 这里再走一次白名单清洗，避免把未经清洗的 HTML 直接写进文件。
     */
    @PostMapping("/api/req-docs/export-docx")
    public ResponseEntity<byte[]> exportDocx(@RequestBody Map<String, String> body,
                                             @RequestParam(required = false) String workspace) {
        workspaceService.resolve(CurrentUser.id(), workspace);
        String html = body == null ? null : body.get("html");
        if (html != null && html.length() > 12_000_000) {
            throw AppException.badRequest("文档正文过大，暂不支持导出 Word");
        }
        String clean = RequirementDocService.sanitize(html);
        byte[] bytes = htmlDocxService.toDocx(clean == null ? "" : clean);
        String title = body == null ? null : body.get("title");
        String name = docxFileName(title);
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.parseMediaType(
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document"));
        headers.setContentDisposition(ContentDisposition.attachment()
                .filename(name, StandardCharsets.UTF_8).build());
        headers.setContentLength(bytes.length);
        return new ResponseEntity<byte[]>(bytes, headers, HttpStatus.OK);
    }

    private String docxFileName(String title) {
        String base = title == null ? "" : title.trim();
        base = base.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_");
        if (base.length() > 80) {
            base = base.substring(0, 80);
        }
        return (base.isEmpty() ? "文档" : base) + ".docx";
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
    public ApiResult<PageResult<RequirementDocHistory>> history(
            @PathVariable String id,
            @RequestParam(required = false) String workspace,
            @RequestParam(required = false) Integer offset,
            @RequestParam(required = false) Integer limit) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(docService.history(ws.getId(), userId, id,
                offset == null ? 0 : offset, limit == null ? 100 : limit));
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
                                             @Valid @RequestBody ReqDocPublishRequest req,
                                             @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        boolean published = req != null && Boolean.TRUE.equals(req.getPublished());
        return ApiResult.ok(docService.publish(userId, ws.getId(), id, published));
    }

    /** 看板拖拽状态流转：轻量接口，只改状态，不携带正文也不走整篇乐观锁 */
    @PutMapping("/api/req-docs/{id}/status")
    public ApiResult<RequirementDoc> changeStatus(@PathVariable String id,
                                                  @Valid @RequestBody ReqDocStatusRequest req,
                                                  @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(docService.changeStatus(userId, ws.getId(), id, req.getStatus()));
    }

    /** 调整可见范围：轻量接口，只改范围与名单，不携带正文也不走整篇乐观锁 */
    @PutMapping("/api/req-docs/{id}/visibility")
    public ApiResult<RequirementDoc> changeVisibility(@PathVariable String id,
                                                      @Valid @RequestBody ReqDocVisibilityRequest req,
                                                      @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(docService.changeVisibility(userId, ws.getId(), id,
                req.getVisibility(), req.getMemberIds()));
    }

    /** 行内重命名：轻量接口，只改标题，不携带正文也不走整篇乐观锁 */
    @PutMapping("/api/req-docs/{id}/title")
    public ApiResult<RequirementDoc> rename(@PathVariable String id,
                                            @Valid @RequestBody ReqDocRenameRequest req,
                                            @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(docService.rename(userId, ws.getId(), id, req.getTitle()));
    }

    /** 阅读/树拖拽排序：批量调整 sort_order 与 parent_id，不携带正文也不走整篇乐观锁 */
    @PostMapping("/api/req-docs/reorder")
    public ApiResult<Void> reorder(@Valid @RequestBody ReqDocReorderRequest req,
                                   @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        docService.reorder(userId, ws.getId(), req);
        return ApiResult.ok(null);
    }

    @DeleteMapping("/api/req-docs/{id}")
    public ApiResult<Void> delete(@PathVariable String id,
                                  @RequestParam(required = false) String workspace) {
        Workspace ws = workspaceService.resolve(CurrentUser.id(), workspace);
        docService.delete(CurrentUser.id(), ws.getId(), id);
        return ApiResult.ok(null);
    }

    /* ---------------- 只读分享 ---------------- */

    /** 查看文档的分享链接（当前项目可写者；已过期按无链接处理） */
    @GetMapping("/api/req-docs/{id}/share")
    public ApiResult<ReqDocShare> shareInfo(@PathVariable String id,
                                            @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(docService.shareInfo(userId, ws.getId(), id));
    }

    /** 生成/重置分享链接（当前项目可写者；文档须已发布） */
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
