package com.hourglass.service;

import com.hourglass.common.AppException;
import org.apache.poi.util.Units;
import org.apache.poi.xwpf.usermodel.Document;
import org.apache.poi.xwpf.usermodel.XWPFDocument;
import org.apache.poi.xwpf.usermodel.XWPFRun;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.util.LinkedHashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** Word 导入为文档正文：docx 保留排版，doc 提取文本，返回清洗后的 HTML。 */
class RequirementDocImportWordTest {

    private final DocPreviewService previewService = mock(DocPreviewService.class);
    private final RequirementDocService docService = new RequirementDocService(
            mock(com.hourglass.mapper.RequirementDocMapper.class),
            mock(com.hourglass.mapper.RequirementDocHistoryMapper.class),
            mock(com.hourglass.mapper.RequirementDocCommentMapper.class),
            mock(com.hourglass.mapper.RequirementMapper.class),
            mock(com.hourglass.mapper.UserMapper.class),
            mock(com.hourglass.mapper.TaskMapper.class),
            mock(WorkActivityService.class),
            mock(com.hourglass.mapper.DemandMapper.class),
            mock(ProjectAccessService.class),
            mock(NotificationEventService.class),
            mock(com.hourglass.mapper.ReqDocShareMapper.class),
            mock(com.hourglass.mapper.WorkspaceMapper.class),
            previewService, mock(DeletionTraceService.class));

    private Map<String, String> previewResult(String content) {
        Map<String, String> m = new LinkedHashMap<String, String>();
        m.put("type", "html");
        m.put("content", content);
        return m;
    }

    @Test
    void importsDocxHtmlAndSanitizes() {
        when(previewService.preview(any(File.class), eq("docx")))
                .thenReturn(previewResult("<html><body><p>Hello</p><script>alert(1)</script></body></html>"));

        String html = docService.importWord(mock(File.class));

        assertTrue(html.contains("<p>Hello</p>"));
        assertTrue(!html.contains("<script>"));
    }

    @Test
    void importsLegacyDocUsingDocConverter() {
        when(previewService.preview(any(File.class), eq("doc")))
                .thenReturn(previewResult("<html><body><p>Legacy</p></body></html>"));

        String html = docService.importWord(mock(File.class), "doc");

        assertTrue(html.contains("<p>Legacy</p>"));
    }

    @Test
    void emptyPreviewContentIsRejected() {
        when(previewService.preview(any(File.class), eq("docx")))
                .thenReturn(previewResult("   "));

        AppException ex = assertThrows(AppException.class, () -> docService.importWord(mock(File.class)));
        assertEquals(400, ex.getCode());
    }

    /** xdocreport 把标题压成 p.Heading1，白名单又不保留 font-weight/style，导入时要还原成 hN 与行内标签。 */
    @Test
    void wordHeadingsAndInlineStylesArePromotedBeforeSanitize() {
        String wordHtml = "<html><body><div>"
                + "<p class=\"Normal Heading1\"><span class=\"Normal Heading1\">一级标题</span></p>"
                + "<p><span style=\"font-weight:bold;white-space:pre-wrap;\">加粗</span>"
                + "<span style=\"font-style:italic;\">斜体</span>"
                + "<span style=\"text-decoration:underline;\">下划线</span>"
                + "<span style=\"text-decoration:line-through;\">删除线</span></p>"
                + "</div></body></html>";
        when(previewService.preview(any(File.class), eq("docx"))).thenReturn(previewResult(wordHtml));

        String html = docService.importWord(mock(File.class));

        assertTrue(html.contains("<h1"), "标题应还原成 h1：" + html);
        assertTrue(html.contains("<strong>加粗</strong>"), html);
        assertTrue(html.contains("<em>斜体</em>"), html);
        assertTrue(html.contains("<u>下划线</u>"), html);
        assertTrue(html.contains("<s>删除线</s>"), html);
    }

    /** Word 列表符号是正文文字：导入后应是真正的 ul/ol，且不再带“• ”前缀。 */
    @Test
    void wordListsBecomeRealLists() {
        String wordHtml = "<p class=\"Normal ListBullet\"><span class=\"Normal ListBullet\">&bull; </span><span class=\"Normal ListBullet\">项目一</span></p>"
                + "<p class=\"Normal ListBullet\"><span class=\"Normal ListBullet\">&bull; </span><span class=\"Normal ListBullet\">项目二</span></p>"
                + "<p class=\"Normal ListNumber\"><span class=\"Normal ListNumber\">1. </span><span class=\"Normal ListNumber\">第一步</span></p>";
        when(previewService.preview(any(File.class), eq("docx"))).thenReturn(previewResult(wordHtml));

        String html = docService.importWord(mock(File.class));

        assertTrue(html.contains("<ul"), html);
        assertTrue(html.contains("<ol"), html);
        assertTrue(html.contains("项目一"));
        assertTrue(html.contains("第一步"));
        assertTrue(!html.contains("•"), "列表符号应被移除：" + html);
    }

    /** docx 内嵌图片必须转成带 MIME 的 data URL 并穿过正文白名单，否则导入后只剩文字。 */
    @Test
    void docxEmbeddedImageSurvivesConversionAndSanitize() throws Exception {
        /* 1x1 PNG：最小合法图片，避免测试依赖外部素材 */
        byte[] png = java.util.Base64.getDecoder().decode(
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==");
        File file = File.createTempFile("hourglass-docx-image-", ".docx");
        try {
            try (XWPFDocument doc = new XWPFDocument(); FileOutputStream out = new FileOutputStream(file)) {
                /* xdocreport 要求恰好一个 styles 部件，空白新建的 POI 文档默认没有 */
                doc.createStyles();
                /* 真实 Word 文档必有节属性；缺 sectPr 时 xdocreport 遍历页眉页脚会 NPE */
                if (doc.getDocument().getBody().getSectPr() == null) {
                    doc.getDocument().getBody().addNewSectPr();
                }
                XWPFRun run = doc.createParagraph().createRun();
                run.setText("before-image");
                run.addPicture(new ByteArrayInputStream(png), Document.PICTURE_TYPE_PNG, "dot.png",
                        Units.toEMU(12), Units.toEMU(12));
                doc.write(out);
            }

            String html = new DocPreviewService().preview(file, "docx").get("content");
            assertTrue(html.contains("data:image/png;base64,"), "转换结果应内联 base64 图片：" + html);

            String clean = RequirementDocService.sanitize(html);
            assertNotNull(clean);
            assertTrue(clean.contains("data:image/png;base64,"), "清洗后图片不应被丢弃：" + clean);
            assertTrue(clean.contains("before-image"));
        } finally {
            file.delete();
        }
    }

    /** 导入 → 清洗 → 导出整条链路：导出的 .docx 仍应带同一张图片和文字。 */
    @Test
    void importedDocxCanBeExportedBackToDocxWithImage() throws Exception {
        byte[] png = java.util.Base64.getDecoder().decode(
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==");
        File file = File.createTempFile("hourglass-docx-roundtrip-", ".docx");
        try {
            try (XWPFDocument doc = new XWPFDocument(); FileOutputStream out = new FileOutputStream(file)) {
                doc.createStyles();
                if (doc.getDocument().getBody().getSectPr() == null) {
                    doc.getDocument().getBody().addNewSectPr();
                }
                XWPFRun run = doc.createParagraph().createRun();
                run.setText("roundtrip-text");
                run.addPicture(new ByteArrayInputStream(png), Document.PICTURE_TYPE_PNG, "dot.png",
                        Units.toEMU(12), Units.toEMU(12));
                doc.write(out);
            }

            String html = new DocPreviewService().preview(file, "docx").get("content");
            String clean = RequirementDocService.sanitize(html);
            assertNotNull(clean);

            byte[] exported = new HtmlDocxService().toDocx(clean);
            try (XWPFDocument reopened = new XWPFDocument(new ByteArrayInputStream(exported))) {
                assertEquals(1, reopened.getAllPictures().size(), "导出的 docx 应包含内嵌图片");
                assertTrue(reopened.getDocument().getBody().xmlText().contains("roundtrip-text"));
            }
        } finally {
            file.delete();
        }
    }
}
