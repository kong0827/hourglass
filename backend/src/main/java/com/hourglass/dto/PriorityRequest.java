package com.hourglass.dto;

import lombok.Data;

import javax.validation.constraints.NotBlank;
import javax.validation.constraints.Size;

@Data
public class PriorityRequest {

    @NotBlank(message = "请填写优先级显示名")
    @Size(max = 12, message = "优先级显示名不能超过 12 字")
    private String name;

    /** #RRGGBB，可选；缺省或不合法时回落该档默认色 */
    @Size(max = 16, message = "颜色格式不合法")
    private String color;
}
