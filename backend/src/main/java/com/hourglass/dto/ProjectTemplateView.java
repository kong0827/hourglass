package com.hourglass.dto;

import lombok.Data;

import java.util.List;

/** 项目模板说明：新建项目时按模板补齐列、文档骨架、测试模块与默认版本。 */
@Data
public class ProjectTemplateView {

    private String code;
    private String name;
    private String description;
    private List<String> columns;
    private List<String> docs;
    private List<String> modules;
    private String versionName;
}
