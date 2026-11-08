package com.hourglass.common;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * 最小 CSV 工具（RFC4180 子集）：供测试用例模板导入导出使用。
 * 口径与 AuditService 导出一致：UTF-8 BOM（Excel 双击不乱码）、\r\n 行尾、
 * 含 , " 换行的字段加引号且 " 翻倍。
 */
public final class Csv {

    private Csv() {
    }

    /** 单元格转义：null 视为空串 */
    public static String cell(Object value) {
        String v = value == null ? "" : String.valueOf(value);
        if (v.indexOf(',') >= 0 || v.indexOf('"') >= 0 || v.indexOf('\n') >= 0 || v.indexOf('\r') >= 0) {
            return "\"" + v.replace("\"", "\"\"") + "\"";
        }
        return v;
    }

    /** 一行拼成 CSV 文本（不含行尾） */
    public static String row(Object... cells) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < cells.length; i++) {
            if (i > 0) {
                sb.append(',');
            }
            sb.append(cell(cells[i]));
        }
        return sb.toString();
    }

    /** 整表导出：BOM + CRLF */
    public static byte[] toCsv(List<String> headerAndRows) {
        StringBuilder sb = new StringBuilder("\uFEFF");
        for (String line : headerAndRows) {
            sb.append(line).append("\r\n");
        }
        return sb.toString().getBytes(StandardCharsets.UTF_8);
    }

    /**
     * 解析 CSV 文本为二维表（支持带引号字段内的逗号与换行、CRLF/LF、BOM）。
     * 尾随空行忽略；行内空字段保留为空串。
     */
    public static List<List<String>> parse(String text) {
        List<List<String>> out = new ArrayList<List<String>>();
        if (text == null) {
            return out;
        }
        if (text.startsWith("\uFEFF")) {
            text = text.substring(1);
        }
        List<String> current = new ArrayList<String>();
        StringBuilder field = new StringBuilder();
        boolean inQuotes = false;
        boolean rowStarted = false;
        for (int i = 0; i < text.length(); i++) {
            char ch = text.charAt(i);
            if (inQuotes) {
                if (ch == '"') {
                    if (i + 1 < text.length() && text.charAt(i + 1) == '"') {
                        field.append('"');
                        i++;
                    } else {
                        inQuotes = false;
                    }
                } else {
                    field.append(ch);
                }
                continue;
            }
            if (ch == '"') {
                inQuotes = true;
                rowStarted = true;
            } else if (ch == ',') {
                current.add(field.toString());
                field.setLength(0);
                rowStarted = true;
            } else if (ch == '\n' || ch == '\r') {
                if (ch == '\r' && i + 1 < text.length() && text.charAt(i + 1) == '\n') {
                    i++; // CRLF 当一个换行
                }
                endRow(out, current, field);
                field.setLength(0);
                rowStarted = false;
            } else {
                field.append(ch);
                rowStarted = true;
            }
        }
        if (rowStarted || field.length() > 0 || !current.isEmpty()) {
            endRow(out, current, field);
        }
        return out;
    }

    private static void endRow(List<List<String>> out, List<String> current, StringBuilder field) {
        List<String> copy = new ArrayList<String>(current);
        copy.add(field.toString());
        // 整行为空白（只有一个空字段）跳过
        if (copy.size() == 1 && copy.get(0).trim().isEmpty()) {
            current.clear();
            return;
        }
        out.add(copy);
        current.clear();
    }
}
