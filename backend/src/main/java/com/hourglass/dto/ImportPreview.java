package com.hourglass.dto;

import lombok.Data;

import java.util.List;
import java.util.Map;

/** 导入预检：只读，不写入；返回列映射、逐行校验结果与可导入数量。 */
@Data
public class ImportPreview {

    private String kind;
    private List<String> headers;
    private List<Field> fields;
    /** 实际使用的列映射：字段 key → 表头名 */
    private Map<String, String> mapping;
    private int total;
    private int valid;
    private int invalid;
    /** rows 只回传前 N 行，避免大文件把响应撑大 */
    private boolean truncated;
    private List<Row> rows;
    /** 表头级问题（如缺少必填列、映射列不存在） */
    private List<String> errors;
    private List<String> ignored;

    @Data
    public static class Field {
        private String key;
        private String label;
        private boolean required;
    }

    @Data
    public static class Row {
        private int row;
        private boolean ok;
        private List<String> errors;
        private String title;
        private String project;
    }
}
