package com.devstudio.kanban.dto;

import lombok.Data;

import javax.validation.constraints.Email;
import javax.validation.constraints.NotBlank;
import javax.validation.constraints.Size;

/** 修改自己的显示名（个人资料） */
@Data
public class ProfileUpdateRequest {

    @NotBlank(message = "请填写显示名")
    @Size(max = 32, message = "显示名不能超过 32 字")
    private String displayName;

    /** 可空；空字符串由 Service 归一为 null，用于清除个人邮箱 */
    @Email(message = "邮箱格式不正确")
    @Size(max = 254, message = "邮箱不能超过 254 个字符")
    private String email;
}
