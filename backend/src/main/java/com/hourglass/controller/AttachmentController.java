package com.hourglass.controller;

import com.hourglass.common.ApiResult;
import com.hourglass.common.AppException;
import com.hourglass.common.CurrentUser;
import com.hourglass.common.CurrentWorkspace;
import com.hourglass.config.WorkspaceCtx;
import com.hourglass.entity.Attachment;
import com.hourglass.entity.Workspace;
import com.hourglass.service.AttachmentService;
import com.hourglass.service.WorkspaceService;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.net.URLEncoder;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import javax.imageio.ImageIO;
import javax.imageio.ImageReadParam;
import javax.imageio.ImageReader;
import javax.imageio.stream.ImageInputStream;

@RestController
public class AttachmentController {

    /** 服务端按扩展名定 MIME，不信任上传方声明的 Content-Type */
    private static final Map<String, String> EXT_MIME = new HashMap<String, String>();

    static {
        EXT_MIME.put("jpg", "image/jpeg");
        EXT_MIME.put("jpeg", "image/jpeg");
        EXT_MIME.put("png", "image/png");
        EXT_MIME.put("gif", "image/gif");
        EXT_MIME.put("webp", "image/webp");
        EXT_MIME.put("pdf", "application/pdf");
        EXT_MIME.put("txt", "text/plain");
        EXT_MIME.put("md", "text/plain");
        EXT_MIME.put("zip", "application/zip");
        EXT_MIME.put("xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    }

    private final AttachmentService attachmentService;
    private final WorkspaceService workspaceService;

    public AttachmentController(AttachmentService attachmentService, WorkspaceService workspaceService) {
        this.attachmentService = attachmentService;
        this.workspaceService = workspaceService;
    }

    @GetMapping("/api/tasks/{taskId}/attachments")
    public ApiResult<List<Attachment>> list(@PathVariable String taskId,
                                            @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(attachmentService.list(ws.getId(), userId, taskId, AttachmentService.KIND_TASK));
    }

    @PostMapping("/api/tasks/{taskId}/attachments")
    public ApiResult<Attachment> upload(@PathVariable String taskId, @RequestParam("file") MultipartFile file,
                                        @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(attachmentService.upload(userId, ws.getId(), taskId, AttachmentService.KIND_TASK, file));
    }

    /** T2.1 / T2.3：需求池需求附件（attachment 泛化 target=demand） */
    @GetMapping("/api/demands/{demandId}/attachments")
    public ApiResult<List<Attachment>> listDemand(@PathVariable String demandId,
                                                  @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(attachmentService.list(ws.getId(), userId, demandId, AttachmentService.KIND_DEMAND));
    }

    @PostMapping("/api/demands/{demandId}/attachments")
    public ApiResult<Attachment> uploadDemand(@PathVariable String demandId, @RequestParam("file") MultipartFile file,
                                              @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(attachmentService.upload(userId, ws.getId(), demandId, AttachmentService.KIND_DEMAND, file));
    }

    @GetMapping("/api/attachments/{id}/download")
    public ResponseEntity<Resource> download(@PathVariable String id,
                                             @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        Attachment a = attachmentService.getVisible(ws.getId(), userId, id);
        File file = attachmentService.fileOf(a);
        if (!file.exists()) {
            throw AppException.notFound("附件文件不存在：" + a.getFilename());
        }
        String encoded;
        try {
            encoded = URLEncoder.encode(a.getFilename(), "UTF-8").replace("+", "%20");
        } catch (Exception e) {
            encoded = "attachment";
        }
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "inline; filename*=UTF-8''" + encoded)
                .header(HttpHeaders.CACHE_CONTROL, "private, max-age=86400")
                .contentType(mediaTypeOf(a.getStoredName()))
                .body(new FileSystemResource(file));
    }

    /** 缩略图：小尺寸预览用，避免移动端为 34px 缩略图全量下载原图 */
    @GetMapping("/api/attachments/{id}/thumb")
    public ResponseEntity<?> thumb(@PathVariable String id,
                                   @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        Attachment a = attachmentService.getVisible(ws.getId(), userId, id);
        File file = attachmentService.fileOf(a);
        if (!file.exists()) {
            throw AppException.notFound("附件文件不存在：" + a.getFilename());
        }
        String ext = extOfStored(a.getStoredName());
        boolean decodable = "jpg".equals(ext) || "jpeg".equals(ext) || "png".equals(ext) || "gif".equals(ext);
        if (decodable) {
            try {
                ResponseEntity<byte[]> res = buildThumb(file, ext);
                if (res != null) {
                    return res;
                }
            } catch (Exception e) {
                // 解码失败则回退原图
            }
        }
        return download(id, workspace);
    }

    private static final int THUMB_MAX = 200;

    /**
     * 读取时按整数倍采样再解码：解码像素量始终限制在 (2*THUMB_MAX)^2 内，
     * 大尺寸压缩图不会先整张解码，避免拖垮堆内存；输出宽高均不超过上限。
     */
    private ResponseEntity<byte[]> buildThumb(File file, String ext) throws IOException {
        ImageInputStream iis = ImageIO.createImageInputStream(file);
        if (iis == null) {
            return null;
        }
        try {
            Iterator<ImageReader> readers = ImageIO.getImageReaders(iis);
            if (!readers.hasNext()) {
                return null;
            }
            ImageReader reader = readers.next();
            try {
                reader.setInput(iis, true, true);
                int sw = reader.getWidth(0);
                int sh = reader.getHeight(0);
                if (sw <= 0 || sh <= 0) {
                    return null;
                }
                int step = Math.max(1, Math.max(sw / (THUMB_MAX * 2), sh / (THUMB_MAX * 2)));
                ImageReadParam param = reader.getDefaultReadParam();
                if (step > 1) {
                    param.setSourceSubsampling(step, step, 0, 0);
                }
                BufferedImage src = reader.read(0, param);
                int dw = src.getWidth();
                int dh = src.getHeight();
                double scale = Math.min(1.0, Math.min(THUMB_MAX / (double) dw, THUMB_MAX / (double) dh));
                int tw = Math.max(1, (int) Math.round(dw * scale));
                int th = Math.max(1, (int) Math.round(dh * scale));
                boolean alpha = "png".equals(ext) || "gif".equals(ext);
                BufferedImage dst = new BufferedImage(tw, th,
                        alpha ? BufferedImage.TYPE_INT_ARGB : BufferedImage.TYPE_INT_RGB);
                Graphics2D g = dst.createGraphics();
                if (!alpha) {
                    g.setColor(Color.WHITE);
                    g.fillRect(0, 0, tw, th);
                }
                g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BILINEAR);
                g.drawImage(src, 0, 0, tw, th, null);
                g.dispose();
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                ImageIO.write(dst, alpha ? "png" : "jpg", out);
                return ResponseEntity.ok()
                        .header(HttpHeaders.CACHE_CONTROL, "private, max-age=86400")
                        .contentType(MediaType.parseMediaType(alpha ? "image/png" : "image/jpeg"))
                        .body(out.toByteArray());
            } finally {
                reader.dispose();
            }
        } finally {
            iis.close();
        }
    }

    @DeleteMapping("/api/attachments/{id}")
    public ApiResult<Void> delete(@PathVariable String id, @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        attachmentService.delete(userId, ws.getId(), id);
        return ApiResult.ok();
    }

    /** 在线编辑整体覆盖保存（智能表格回写）：保留附件 id/文件名 */
    @PostMapping("/api/attachments/{id}/content")
    public ApiResult<Attachment> overwriteContent(@CurrentWorkspace WorkspaceCtx ctx,
                                                  @PathVariable String id,
                                                  @RequestParam("file") MultipartFile file) {
        return ApiResult.ok(attachmentService.overwriteContent(ctx.getUserId(), ctx.getWsId(), id, file));
    }

    private MediaType mediaTypeOf(String storedName) {
        int idx = storedName == null ? -1 : storedName.lastIndexOf('.');
        String ext = idx >= 0 ? storedName.substring(idx + 1).toLowerCase(Locale.ROOT) : "";
        String mime = EXT_MIME.get(ext);
        if (mime == null) {
            return MediaType.APPLICATION_OCTET_STREAM;
        }
        return MediaType.parseMediaType(mime);
    }

    private String extOfStored(String storedName) {
        int idx = storedName == null ? -1 : storedName.lastIndexOf('.');
        return idx >= 0 ? storedName.substring(idx + 1).toLowerCase(Locale.ROOT) : "";
    }
}
