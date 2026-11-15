package com.hourglass.dto;

import lombok.Data;

import javax.validation.constraints.NotBlank;
import javax.validation.constraints.Pattern;
import javax.validation.constraints.Size;

/**
 * 文档里选中一段文字后要做的处理。
 *
 * <p>选区与上下文都由前端按当前编辑器真实内容截取；服务端不重新解析整篇文档，
 * 避免"选的是 A 段、模型看到的是 B 段"。
 */
@Data
public class AiSelectionRequest {

    /** rewrite 改写 / shorten 缩写 / expand 扩写 / explain 解释 / to_task 提为工作项 */
    @NotBlank(message = "缺少操作类型")
    @Pattern(regexp = "^(rewrite|shorten|expand|explain|to_task)$", message = "不支持的操作")
    private String action;

    @NotBlank(message = "请先选中要处理的文字")
    @Size(max = 3000, message = "选中内容最多 3000 字，请分段处理")
    private String selection;

    /** 用户在卡片里补充的要求（可空），比如「更简洁」「面向非技术读者」 */
    @Size(max = 200, message = "补充要求最多 200 字")
    private String instruction;

    /** 选区前文，用于让模型知道这段话在讲什么（前端截最近 400 字） */
    @Size(max = 400, message = "前文过长")
    private String before;

    /** 选区后文，同上 */
    @Size(max = 400, message = "后文过长")
    private String after;

    /** 选区所在小节标题（可空）；用于提示词定位，不做校验 */
    @Size(max = 120, message = "小节标题过长")
    private String section;

    /** 原文格式：html 富文本 / markdown；决定改写结果按段落还是保留 Markdown 语法 */
    @Pattern(regexp = "^(html|markdown)?$", message = "正文格式不合法")
    private String format;
}
