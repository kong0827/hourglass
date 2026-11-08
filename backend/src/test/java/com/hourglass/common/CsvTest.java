package com.hourglass.common;

import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** A3：用例 CSV 导入导出的底层解析/生成口径 */
class CsvTest {

    @Test
    void roundTripsTrickyFields() {
        List<String> lines = new ArrayList<String>();
        lines.add(Csv.row("标题", "模块", "步骤"));
        lines.add(Csv.row("登录,成功", "带\"引号\"的模块", "第一步 => 预期A\n第二步 => 预期B"));
        byte[] out = Csv.toCsv(lines);
        String text = new String(out, StandardCharsets.UTF_8);
        assertTrue(text.startsWith("\uFEFF"), "导出必须带 BOM，Excel 双击不乱码");
        assertTrue(text.contains("\r\n"), "行尾统一 CRLF");

        List<List<String>> back = Csv.parse(text);
        assertEquals(2, back.size());
        assertEquals(Arrays.asList("标题", "模块", "步骤"), back.get(0));
        assertEquals(Arrays.asList("登录,成功", "带\"引号\"的模块", "第一步 => 预期A\n第二步 => 预期B"), back.get(1));
    }

    @Test
    void parsesAllLineEndingStyles() {
        assertEquals(3, Csv.parse("a,1\nb,2\r\nc,3\r").size());
        assertEquals(2, Csv.parse("\uFEFFx,1\r\ny,2").size(), "BOM 与尾行不带换行也要解析");
    }

    @Test
    void skipsBlankLinesKeepsEmptyCells() {
        List<List<String>> rows = Csv.parse("a,,c\n\n,,\n");
        assertEquals(2, rows.size(), "纯空行跳过，空字段保留");
        assertEquals(Arrays.asList("", "", ""), rows.get(1));
    }

    @Test
    void nullAndEmptyTextProduceNoRows() {
        assertTrue(Csv.parse(null).isEmpty());
        assertTrue(Csv.parse("").isEmpty());
    }
}
