package com.hourglass.dto;

import lombok.Data;

import javax.validation.constraints.NotBlank;
import javax.validation.constraints.Pattern;
import javax.validation.constraints.Size;

@Data
public class ColumnRequest {

    @NotBlank(message = "请填写列名")
    @Size(max = 12, message = "列名不能超过 12 字")
    private String name;

    /** #RRGGBB，可选 */
    private String color;

    /** normal / waiting / ended；不填则保持 normal */
    @Pattern(regexp = "normal|waiting|ended", message = "处理规则只能是 normal、waiting 或 ended")
    private String processingRule;
}
