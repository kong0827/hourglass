package com.hourglass.common;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** 相似度只做字面比较：标点空格归一、包含关系给下限、无关标题不误报 */
class SimilarityTextTest {

    @Test
    void normalizeDropsPunctuationSpaceAndCase() {
        assertEquals("导出对账单v2", SimilarityText.normalize(" 导出 对账单（V2）！ "));
        assertEquals("loginpage", SimilarityText.normalize("Login-Page"));
        assertEquals("", SimilarityText.normalize("…—…"));
        assertEquals("", SimilarityText.normalize(null));
    }

    @Test
    void identicalTitleScoresOne() {
        assertEquals(1.0, SimilarityText.titleScore("导出对账单", "导出对账单"), 0.0001);
        assertEquals(1.0, SimilarityText.titleScore("导出 对账单", "导出对账单！"), 0.0001);
    }

    @Test
    void containmentKeepsNearDuplicateAboveThreshold() {
        double score = SimilarityText.titleScore("登录白屏", "登录白屏问题");
        assertTrue(score >= 0.72, "包含关系应给下限，实际 " + score);
        assertTrue(score < 1);
    }

    @Test
    void unrelatedTitlesStayLow() {
        double score = SimilarityText.titleScore("导出对账单", "登录后白屏");
        assertTrue(score < 0.3, "无关标题不应误报，实际 " + score);
    }

    @Test
    void shortTitlesStillCompareBySingleChar() {
        assertEquals(1.0, SimilarityText.titleScore("白屏", "白屏"), 0.0001);
        assertTrue(SimilarityText.titleScore("白屏", "黑屏") < 0.5);
    }

    @Test
    void plainSnippetStripsTagsAndCollapsesSpace() {
        String s = SimilarityText.plainSnippet("<p>导出 <b>对账单</b></p><script>x()</script> 失败", 40);
        assertEquals("导出 对账单 失败", s);
    }

    @Test
    void plainSnippetCutsLongText() {
        String s = SimilarityText.plainSnippet("一二三四五六七八九十", 4);
        assertEquals("一二三四…", s);
    }
}
