package com.hourglass.dto;

import lombok.Data;

import javax.validation.constraints.NotBlank;
import javax.validation.constraints.Size;

/** 字段级 AI 草稿：只要当前表单里的标题与描述，不要求先保存 */
@Data
public class AiDraftRequest {

    /** 所属项目：用于服务端校验写权限，也决定团队/个人模型来源的解析空间 */
    @NotBlank(message = "请选择所属项目")
    @Size(max = 32, message = "所属项目ID不合法")
    private String projectId;

    @NotBlank(message = "请填写标题")
    @Size(max = 100, message = "标题不能超过 100 字")
    private String title;

    @Size(max = 2000, message = "描述不能超过 2000 字")
    private String description;

    /** 表单里已有的验收标准：让模型只补缺，不要重复写过的条目 */
    @Size(max = 2000, message = "已有内容不能超过 2000 字")
    private String existing;
}
