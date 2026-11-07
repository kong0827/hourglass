package com.hourglass.dto;

import lombok.Data;

import javax.validation.constraints.NotBlank;
import javax.validation.constraints.Pattern;

/** 看板拖拽等轻量状态流转：只改状态，不携带正文 */
@Data
public class ReqDocStatusRequest {

    @NotBlank(message = "文档状态不能为空")
    @Pattern(regexp = "^(draft|active|done)$", message = "文档状态不合法")
    private String status;
}
