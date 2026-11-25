package com.hourglass.service;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** 表格快照 → @ 解析文本：只取单元格文本，表名等结构字段不参与，异常快照不抛错。 */
class RequirementDocSheetMentionTest {

    @Test
    void collectsCellValuesAndRichTextButNotSheetName() {
        String snapshot = "{\"sheetOrder\":[\"s1\"],\"sheets\":{\"s1\":{\"name\":\"张三\",\"rowCount\":2,"
                + "\"cellData\":{\"0\":{\"0\":{\"v\":\"@李四 \"},\"1\":{\"p\":{\"body\":{\"dataStream\":\"@王五 \"}}}}}}}}";

        String text = RequirementDocService.sheetMentionText(snapshot);

        assertTrue(text.contains("@李四"));
        assertTrue(text.contains("@王五"));
        assertFalse(text.contains("张三"), "表名不是单元格内容，不能参与 @ 匹配");
    }

    @Test
    void malformedSnapshotReturnsWhatWasParsedAndDoesNotThrow() {
        assertEquals("", RequirementDocService.sheetMentionText(null));
        assertEquals("", RequirementDocService.sheetMentionText("not-json"));
        String broken = "{\"sheets\":{\"s1\":{\"cellData\":{\"0\":{\"0\":{\"v\":\"@李四\"}}";
        assertTrue(RequirementDocService.sheetMentionText(broken).contains("@李四"));
    }
}
