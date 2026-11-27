package com.hourglass.service;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** 章节级搜索的标题提取：与前端阅读大纲同一口径（h1–h6 / ATX / Setext，跳过围栏代码块）。 */
class DocHeadingsTest {

    @Test
    void htmlExtractsHeadingsInDocumentOrder() {
        List<String> hs = DocHeadings.fromHtml(
                "<p>前言</p><h1>总体方案</h1><div><h2>接口设计 &amp; 字段</h2><h3><strong>鉴权</strong></h3></div>"
                        + "<p>正文</p><h6>附录</h6>");
        assertEquals(4, hs.size());
        assertEquals("总体方案", hs.get(0));
        assertEquals("接口设计 & 字段", hs.get(1));
        assertEquals("鉴权", hs.get(2));
        assertEquals("附录", hs.get(3));
    }

    @Test
    void htmlPlainTextHasNoHeadings() {
        assertTrue(DocHeadings.fromHtml("<p>只有正文，没有标题</p>").isEmpty());
        assertTrue(DocHeadings.fromHtml("").isEmpty());
        assertTrue(DocHeadings.fromHtml(null).isEmpty());
    }

    @Test
    void markdownSupportsAtxSetextAndSkipsFences() {
        String md = "# 目标\n\n## 方案\n\n```\n# 注释里的井号\n```\n\n细节说明\n-----\n\n### 风险\n";
        List<String> hs = DocHeadings.fromMarkdown(md);
        assertEquals(4, hs.size());
        assertEquals("目标", hs.get(0));
        assertEquals("方案", hs.get(1));
        assertEquals("细节说明", hs.get(2));
        assertEquals("风险", hs.get(3));
    }

    @Test
    void markdownHeadingInsideFenceIsNotAHeading() {
        String md = "```md\n## 示例代码里的标题\n```\n\n## 真正的标题\n";
        List<String> hs = DocHeadings.fromMarkdown(md);
        assertEquals(1, hs.size());
        assertEquals("真正的标题", hs.get(0));
    }
}
