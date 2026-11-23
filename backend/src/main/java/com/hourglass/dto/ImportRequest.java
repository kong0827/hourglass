package com.hourglass.dto;

import lombok.Data;

import java.util.Map;

/** Excel / CSV 导入请求：文件二选一（文本或 base64），mapping 为「字段key → 表头名」。 */
@Data
public class ImportRequest {

    /** task / demand / case / worklog */
    private String kind;

    /** CSV 文本（UTF-8） */
    private String csv;

    /** xlsx / xls 的 base64（不含 data: 前缀） */
    private String file;

    private String fileName;

    /** 可选：整体限定项目（工作项/需求/用例）；不填则按每行「项目」列解析 */
    private String reqId;

    private Map<String, String> mapping;
}
