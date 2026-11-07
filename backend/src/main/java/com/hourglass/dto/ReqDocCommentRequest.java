package com.hourglass.dto;

import lombok.Data;

import javax.validation.constraints.NotBlank;
import javax.validation.constraints.Size;

/** 文档评论提交 */
@Data
public class ReqDocCommentRequest {

    @NotBlank(message = "评论内容不能为空")
    @Size(max = 1000, message = "评论最多 1000 字")
    private String content;

    /** 引用的正文片段，用于批注场景 */
    @Size(max = 500, message = "引用片段最多 500 字")
    private String quoteText;
}
