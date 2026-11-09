package com.hourglass.dto;

import lombok.Data;

import javax.validation.constraints.NotBlank;
import javax.validation.constraints.Size;

@Data
public class CategoryRequest {

    @NotBlank(message = "请填写模块名称")
    @Size(max = 12, message = "模块名称不能超过 12 字")
    private String name;

    /** #RRGGBB，可选 */
    @Size(max = 16, message = "颜色格式不合法")
    private String color;
}
