package com.hourglass.dto;

import lombok.Data;

import javax.validation.constraints.NotBlank;
import javax.validation.constraints.Pattern;

@Data
public class ColumnTransitionRequest {

    @NotBlank(message = "缺少来源列")
    private String from;

    @NotBlank(message = "缺少目标列")
    private String to;

    @NotBlank(message = "缺少流转规则")
    @Pattern(regexp = "allow|reason|deny", message = "流转规则只能是 allow、reason 或 deny")
    private String rule;
}
