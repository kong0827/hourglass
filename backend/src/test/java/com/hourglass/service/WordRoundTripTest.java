package com.hourglass.service;

import org.apache.poi.xwpf.usermodel.XWPFDocument;
import org.apache.poi.xwpf.usermodel.XWPFTable;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.nio.file.Files;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 沙漏导出的 .docx 要能被自己再导入：缺少 sectPr / tblGrid 时
 * xdocreport 会 NPE 并降级成纯文本，表格与合并单元格全部丢失。
 */
public class WordRoundTripTest {

    @Test
    public void exportedTableSurvivesPreviewConversion() throws Exception {
        String html = "<p>正文</p><table>"
                + "<tr><td colspan=\"2\" rowspan=\"2\">A</td><td>B</td></tr>"
                + "<tr><td>C</td></tr>"
                + "<tr><td>D</td><td>E</td><td>F</td></tr></table>";
        byte[] docx = new HtmlDocxService().toDocx(html);
        File file = File.createTempFile("hg-roundtrip-", ".docx");
        Files.write(file.toPath(), docx);
        try {
            Map<String, String> preview = new DocPreviewService().preview(file, "docx");
            String out = preview.get("content");
            assertNotNull(out);
            assertTrue(out.contains("<table"), "表格应保留，不能降级成纯文本");
            assertTrue(out.contains("colspan"), "横向合并应还原");
            assertTrue(out.contains("rowspan"), "纵向合并应还原");
            assertTrue(out.contains("正文"), "正文段落应保留");
        } finally {
            file.delete();
        }
    }

    /** 旧版导出/极简工具产出的 docx 没有 sectPr、tblGrid，预览时也要补结构而不是退化成纯文本。 */
    @Test
    public void minimalDocxWithoutSectPrOrGridStillKeepsTable() throws Exception {
        byte[] docx;
        try (XWPFDocument doc = new XWPFDocument(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            doc.createStyles();
            XWPFTable table = doc.createTable(1, 2);
            table.getRow(0).getCell(0).setText("左");
            table.getRow(0).getCell(1).setText("右");
            doc.write(out);
            docx = out.toByteArray();
        }
        File file = File.createTempFile("hg-minimal-", ".docx");
        Files.write(file.toPath(), docx);
        try {
            String out = new DocPreviewService().preview(file, "docx").get("content");
            assertNotNull(out);
            assertTrue(out.contains("<table"), "缺结构也应保住表格");
            assertTrue(out.contains("左") && out.contains("右"), "单元格文字应保留");
        } finally {
            file.delete();
        }
    }
}
