package com.hourglass.dto;

import lombok.Data;

import javax.validation.constraints.NotBlank;
import javax.validation.constraints.Size;

@Data
public class PasswordChangeRequest {

    @NotBlank(message = "请填写原密码")
    private String oldPassword;

    @NotBlank(message = "请填写新密码")
    @Size(min = 6, max = 64, message = "密码长度 6-64 位")
    private String newPassword;
}
