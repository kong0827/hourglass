package com.hourglass.dto;

import lombok.Data;

import javax.validation.constraints.NotBlank;
import javax.validation.constraints.Pattern;

/** 只改文档可见范围：不携带正文，避免整篇保存覆盖并发编辑 */
@Data
public class ReqDocVisibilityRequest {

    @NotBlank(message = "请选择文档可见范围")
    @Pattern(regexp = "^(team|members|personal)$", message = "文档可见范围不合法")
    private String visibility;

    /** visibility=members 时必填 1–50 人；其他档位忽略 */
    private java.util.List<String> memberIds;
}
