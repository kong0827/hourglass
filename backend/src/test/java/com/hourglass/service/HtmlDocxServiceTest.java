package com.hourglass.service;

import org.apache.poi.xwpf.usermodel.XWPFDocument;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.util.Base64;

import static org.junit.jupiter.api.Assertions.assertEquals;
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
}
