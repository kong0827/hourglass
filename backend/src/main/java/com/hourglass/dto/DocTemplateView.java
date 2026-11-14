package com.hourglass.dto;

import lombok.Data;

/** 文档模板列表项：内置模板 id 以 builtin: 开头，自定义模板为数据库 ID。 */
@Data
public class DocTemplateView {

    private String id;
    private String name;
    private String docType;
    private String format;
    private String content;
    private boolean builtin;
    private boolean deletable;
}
