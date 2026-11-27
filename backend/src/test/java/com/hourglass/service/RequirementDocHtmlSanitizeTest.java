package com.hourglass.service;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** HTML 导入/保存的样式白名单：常用排版保留，可隐藏/遮挡/外链的样式丢弃。 */
class RequirementDocHtmlSanitizeTest {

    @Test
    void keepsCommonLayoutStyles() {
        String html = "<h2 style=\"font-size:22px;font-family:'Microsoft YaHei',sans-serif;"
                + "color:#1f2329;text-align:center;line-height:1.6;margin:12px 0 8px;\">标题</h2>"
                + "<table style=\"border-collapse:collapse;width:100%;\">"
                + "<tr><td colspan=\"2\" rowspan=\"2\" style=\"border:1px solid rgb(208, 211, 217);"
                + "padding:6px 10px;vertical-align:middle;background-color:#f5f7fa;\">单元格</td></tr></table>";

        String clean = RequirementDocService.sanitize(html);

        assertNotNull(clean);
        assertTrue(clean.contains("font-size"), clean);
        assertTrue(clean.contains("font-family"), clean);
        assertTrue(clean.contains("text-align"), clean);
        assertTrue(clean.contains("line-height"), clean);
        assertTrue(clean.contains("border"), clean);
        assertTrue(clean.contains("padding"), clean);
        assertTrue(clean.contains("background-color"), clean);
        assertTrue(clean.contains("colspan=\"2\""), clean);
        assertTrue(clean.contains("rowspan=\"2\""), clean);
    }

    @Test
    void keepsCodeLanguageClass() {
        /* 代码块语言只靠 class 传递：清洗必须保留，否则阅读页和分享页的标签会丢 */
        String clean = RequirementDocService.sanitize(
                "<pre class=\"language-sql\"><code class=\"language-sql\">select 1</code></pre>");

        assertNotNull(clean);
        assertTrue(clean.contains("language-sql"), clean);
        assertTrue(clean.contains("select 1"), clean);
    }

    @Test
    void dropsDangerousStylesAndAttributes() {
        String html = "<p style=\"position:fixed;display:none;background-image:url(https://evil/x.png);"
                + "color:red;\">可见文字</p>"
                + "<div style=\"width:expression(alert(1));\">x</div>"
                + "<script>alert(1)</script>";

        String clean = RequirementDocService.sanitize(html);

        assertNotNull(clean);
        assertTrue(clean.contains("可见文字"), clean);
        assertFalse(clean.contains("position"), clean);
        assertFalse(clean.contains("display"), clean);
        assertFalse(clean.contains("background-image"), clean);
        assertFalse(clean.contains("expression"), clean);
        assertFalse(clean.contains("<script"), clean);
        assertTrue(clean.contains("color: red"), clean);
    }
}
