package com.devstudio.kanban.dto;

import lombok.Data;

import javax.validation.constraints.NotBlank;
import javax.validation.constraints.Pattern;
import javax.validation.constraints.Size;

@Data
public class UserUpdateRequest {

    @NotBlank(message = "请填写显示名")
    @Size(max = 32, message = "显示名不能超过 32 字")
    private String displayName;

    @Pattern(regexp = "admin|user", message = "角色不合法")
    private String role;
}
