package com.devstudio.kanban.dto;

import lombok.Data;

import javax.validation.constraints.NotBlank;
import javax.validation.constraints.Pattern;
import javax.validation.constraints.Size;

@Data
public class UserCreateRequest {

    @NotBlank(message = "请填写登录名")
    @Pattern(regexp = "^[A-Za-z0-9_.-]{3,32}$", message = "登录名只允许字母、数字、_ . -，长度 3-32")
    private String username;

    @NotBlank(message = "请填写初始密码")
    @Size(min = 6, max = 64, message = "密码长度 6-64 位")
    private String password;

    @Size(max = 32, message = "显示名不能超过 32 字")
    private String displayName;

    @Pattern(regexp = "admin|user", message = "角色不合法")
    private String role = "user";
}
