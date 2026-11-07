package com.hourglass.dto;

import lombok.Data;

import javax.validation.constraints.NotBlank;
import javax.validation.constraints.Size;

@Data
public class PasswordResetRequest {

    @NotBlank(message = "请填写新密码")
    @Size(min = 6, max = 64, message = "密码长度 6-64 位")
    private String password;
}
