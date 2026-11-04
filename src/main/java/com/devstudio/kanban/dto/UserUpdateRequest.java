package com.devstudio.kanban.dto;

import lombok.Data;

import javax.validation.constraints.Email;
import javax.validation.constraints.NotBlank;
import javax.validation.constraints.Pattern;
import javax.validation.constraints.Size;

@Data
public class UserUpdateRequest {

    @NotBlank(message = "请填写显示名")
    @Size(max = 32, message = "显示名不能超过 32 字")
    private String displayName;

    /** 可空；空字符串由 Service 归一为 null（清除邮箱）；邮箱可作为登录凭据，保存时校验唯一 */
    @Email(message = "邮箱格式不正确")
    @Size(max = 254, message = "邮箱不能超过 254 个字符")
    private String email;

    @Pattern(regexp = "admin|user", message = "角色不合法")
    private String role;
}
