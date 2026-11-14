package com.hourglass.dto;

import lombok.Data;

import javax.validation.constraints.NotBlank;
import javax.validation.constraints.Size;

@Data
public class VersionEndRequest {

    @NotBlank(message = "请填写关闭或取消原因")
    @Size(max = 500, message = "原因不能超过 500 字")
    private String reason;
}
