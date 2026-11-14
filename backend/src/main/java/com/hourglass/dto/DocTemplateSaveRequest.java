package com.hourglass.dto;

import lombok.Data;

import javax.validation.constraints.NotBlank;
import javax.validation.constraints.Pattern;
import javax.validation.constraints.Size;

/** 从现有文档另存为模板 */
@Data
public class DocTemplateSaveRequest {

    @NotBlank(message = "请填写模板名称")
    @Size(max = 20, message = "模板名称不能超过 20 字")
    private String name;

    @Pattern(regexp = "^(requirement|technical|acceptance|other)?$", message = "文档分类不合法")
    private String docType;

    @Pattern(regexp = "^(html|markdown)?$", message = "正文格式不合法")
    private String format;

    private String content;
}
