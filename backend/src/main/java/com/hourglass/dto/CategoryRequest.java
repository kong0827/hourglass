package com.hourglass.dto;

import lombok.Data;

import javax.validation.constraints.NotBlank;
import javax.validation.constraints.Size;

@Data
public class CategoryRequest {

    @NotBlank(message = "请填写目录名称")
    @Size(max = 50, message = "目录名称不能超过 50 字")
    private String name;

    /** 父目录 ID；空 = 顶级 */
    @Size(max = 32, message = "父目录 ID 不合法")
    private String parentId;

    /** #RRGGBB，可选 */
    @Size(max = 16, message = "颜色格式不合法")
    private String color;
}
