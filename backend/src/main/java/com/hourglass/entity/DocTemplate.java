package com.hourglass.entity;

import lombok.Data;

import java.time.LocalDateTime;

/** 工作区自定义文档模板；内置模板在 DocTemplateService 中以常量提供。 */
@Data
public class DocTemplate {

    private String id;
    private String workspaceId;
    private String name;
    private String docType;
    private String format;
    private String content;
    private String createdBy;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
