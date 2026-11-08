package com.hourglass.dto;

import lombok.Data;

import javax.validation.constraints.NotBlank;
import javax.validation.constraints.Size;

/** 行内重命名：只改标题，不携带正文 */
@Data
public class ReqDocRenameRequest {

    @NotBlank(message = "文档标题不能为空")
    @Size(max = 100, message = "标题最多 100 字")
    private String title;
}
