package com.hourglass.service;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** AI 需求文档的纯函数口径：富文本转文本 / 优先级与状态归一 / 覆盖结论推导 */
class AiReqDocServiceTest {

    @Test
    void htmlToTextKeepsStructure() {
        String html = "<h2>接口</h2><p>出金接口要幂等。</p>"
                + "<ul><li>按流水号去重</li><li>失败重试 3 次</li></ul>"
                + "<table><tr><th>字段</th><th>说明</th></tr><tr><td>fundId</td><td>资金账户</td></tr></table>";
        String text = AiReqDocService.htmlToText(html);
        assertTrue(text.contains("## 接口"), "标题保留为 ## 行");
        assertTrue(text.contains("\n出金接口要幂等"), "段落保留换行");
        assertTrue(text.contains("- 按流水号去重"), "列表项带 - 前缀");
        assertTrue(text.contains("fundId | 资金账户"), "表格行保留单元格边界");
        assertFalse(text.contains("\n\n\n"), "没有连续三个以上空行");
    }

    @Test
    void htmlToTextEmptyInput() {
        assertEquals("", AiReqDocService.htmlToText(null));
        assertEquals("", AiReqDocService.htmlToText("   "));
    }

    @Test
    void normalizePriority() {
        assertEquals("P0", AiReqDocService.normalizePriority("P0"));
        assertEquals("P1", AiReqDocService.normalizePriority("p1"));
        assertEquals("P0", AiReqDocService.normalizePriority("high"));
        assertEquals("P0", AiReqDocService.normalizePriority("紧急"));
        assertEquals("P2", AiReqDocService.normalizePriority("中"));
        assertEquals("P3", AiReqDocService.normalizePriority("low"));
        assertEquals("P2", AiReqDocService.normalizePriority("P9"));
        assertEquals("P2", AiReqDocService.normalizePriority(null));
    }

    @Test
    void normalizeStatus() {
        assertEquals("done", AiReqDocService.normalizeStatus("done", true));
        assertEquals("done", AiReqDocService.normalizeStatus("已完成", true));
        assertEquals("doing", AiReqDocService.normalizeStatus("进行中", true));
        assertEquals("doing", AiReqDocService.normalizeStatus("in_progress", true));
        assertEquals("todo", AiReqDocService.normalizeStatus("未开始", false));
        assertEquals("missing", AiReqDocService.normalizeStatus("缺失", false));
        assertEquals("done", AiReqDocService.normalizeStatus(null, true));
        assertEquals("missing", AiReqDocService.normalizeStatus("", false));
    }

    /** 结论只由覆盖率与缺失点数推导：有 missing 就永远不可能是"做完了" */
    @Test
    void verdictOf() {
        assertEquals("done", AiReqDocService.verdictOf(96, 0, 10));
        assertEquals("mostly", AiReqDocService.verdictOf(96, 1, 10));
        assertEquals("mostly", AiReqDocService.verdictOf(70, 2, 10));
        assertEquals("partial", AiReqDocService.verdictOf(40, 3, 10));
        assertEquals("not_started", AiReqDocService.verdictOf(10, 5, 10));
        assertEquals("not_started", AiReqDocService.verdictOf(0, 0, 0));
    }
}
