package com.hourglass.service;

import org.apache.poi.xwpf.usermodel.XWPFDocument;
import org.apache.poi.xwpf.usermodel.XWPFRun;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.util.Base64;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

public class HtmlDocxServiceTest {

    /* 1x1 透明 PNG，正文图片白名单认的格式 */
    private static final String PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

    @Test
    public void exportKeepsTextTableAndEmbeddedImage() throws Exception {
        String html = "<h2>Overview</h2>"
                + "<p>before-image <strong>bold</strong> <em>italic</em></p>"
                + "<table><tr><th>Name</th><th>Value</th></tr>"
                + "<tr><td>alpha</td><td>1</td></tr></table>"
                + "<p><img src=\"data:image/png;base64," + PNG + "\" alt=\"pic\"></p>"
                + "<ul><li>first</li><li>second</li></ul>";

        byte[] docx = new HtmlDocxService().toDocx(html);
        assertTrue(docx.length > 0);

        try (XWPFDocument doc = new XWPFDocument(new ByteArrayInputStream(docx))) {
            assertEquals(1, doc.getAllPictures().size());
            String xml = doc.getDocument().getBody().xmlText();
            assertTrue(xml.contains("before-image"), "正文文本应保留");
            assertTrue(xml.contains("alpha"), "表格文本应保留");
            assertTrue(xml.contains("second"), "列表文本应保留");
        }
    }

    @Test
    public void exportHandlesRichEditorMarkup() throws Exception {
        String html = "<h1>Title</h1><div style=\"text-align:center\">centered</div>"
                + "<blockquote>quoted</blockquote><pre>line1\nline2</pre><hr>"
                + "<ol><li>one<ul><li>nested</li></ul></li><li>two</li></ol>"
                + "<table><tr><td colspan=\"2\">merged</td></tr>"
                + "<tr><td>a</td><td>b</td></tr></table>"
                + "<p><a href=\"https://example.com\">link</a> <code>inline-code</code>"
                + " <span style=\"color:#d93025\">red-text</span></p>";

        byte[] docx = new HtmlDocxService().toDocx(html);
        assertTrue(docx.length > 0);
        try (XWPFDocument doc = new XWPFDocument(new ByteArrayInputStream(docx))) {
            String xml = doc.getDocument().getBody().xmlText();
            assertTrue(xml.contains("Title"));
            assertTrue(xml.contains("nested"));
            assertTrue(xml.contains("line2"));
            assertTrue(xml.contains("merged"));
            assertTrue(xml.contains("inline-code"));
            assertEquals(0, doc.getAllPictures().size());
        }
    }

    @Test
    public void exportWithoutContentStillProducesValidDocx() throws Exception {
        byte[] docx = new HtmlDocxService().toDocx("<p><br></p>");
        try (XWPFDocument doc = new XWPFDocument(new ByteArrayInputStream(docx))) {
            assertTrue(doc.getBodyElements().size() >= 1);
        }
    }

    @Test
    public void externalImageIsSkippedInsteadOfFetched() throws Exception {
        byte[] docx = new HtmlDocxService().toDocx("<p><img src=\"https://example.com/a.png\" alt=\"remote\"></p>");
        try (XWPFDocument doc = new XWPFDocument(new ByteArrayInputStream(docx))) {
            assertEquals(0, doc.getAllPictures().size());
            assertTrue(doc.getDocument().getBody().xmlText().contains("[remote]"));
        }
    }

    /** Univer 导出的标题是 p.UniverHeading + aria-level，不能退化成正文。 */
    @Test
    public void exportTreatsUniverHeadingAsHeading() throws Exception {
        String html = "<p class=\"UniverHeading\" role=\"heading\" aria-level=\"2\"><span>二级标题</span></p>"
                + "<p class=\"UniverNormal\"><span>正文</span></p>";

        byte[] docx = new HtmlDocxService().toDocx(html);
        try (XWPFDocument doc = new XWPFDocument(new ByteArrayInputStream(docx))) {
            XWPFRun headingRun = doc.getParagraphs().get(0).getRuns().get(0);
            XWPFRun bodyRun = doc.getParagraphs().get(1).getRuns().get(0);
            assertTrue(headingRun.isBold(), "标题应加粗");
            assertTrue(headingRun.getFontSizeAsDouble() != null && headingRun.getFontSizeAsDouble() >= 28,
                    "二级标题应为 14 磅（28 半磅）");
            assertTrue(!bodyRun.isBold(), "正文不应被连带加粗");
        }
    }

    /** 标题要带 HeadingN 样式和大纲级别，Word 导航窗格/自动目录才能识别层级。 */
    @Test
    public void exportHeadingsCarryOutlineLevels() throws Exception {
        String html = "<h1>一级标题</h1><h2>二级标题</h2><p>正文</p>";

        byte[] docx = new HtmlDocxService().toDocx(html);
        try (XWPFDocument doc = new XWPFDocument(new ByteArrayInputStream(docx))) {
            assertEquals("Heading1", doc.getParagraphs().get(0).getStyle());
            assertEquals("Heading2", doc.getParagraphs().get(1).getStyle());
            assertNotNull(doc.getStyles().getStyle("Heading1"), "样式表应定义 Heading1");
            assertNotNull(doc.getStyles().getStyle("Heading2"), "样式表应定义 Heading2");
            assertTrue(doc.getDocument().getBody().xmlText().contains("outlineLvl"), "标题应写入大纲级别");
        }
    }

    /** Univer 列表项正文包在 <p> 里：符号和文字要在同一段，不能只有符号单独成段。 */
    @Test
    public void exportKeepsUniverListItemTextOnMarkerLine() throws Exception {
        String html = "<ul data-doc-type=\"bullet-list\"><li><p class=\"UniverNormal\"><span>项目一</span></p></li>"
                + "<li><p class=\"UniverNormal\"><span>项目二</span></p></li></ul>";

        byte[] docx = new HtmlDocxService().toDocx(html);
        try (XWPFDocument doc = new XWPFDocument(new ByteArrayInputStream(docx))) {
            assertEquals(2, doc.getParagraphs().size());
            assertTrue(doc.getParagraphs().get(0).getText().startsWith("•"));
            assertTrue(doc.getParagraphs().get(0).getText().contains("项目一"));
            assertTrue(doc.getParagraphs().get(1).getText().contains("项目二"));
        }
    }
}
