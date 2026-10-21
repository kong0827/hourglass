package com.devstudio.kanban.dto;

import lombok.Data;

import javax.validation.constraints.NotBlank;
import javax.validation.constraints.Size;

/** 修改自己的显示名（个人资料） */
@Data
public class ProfileUpdateRequest {

    @NotBlank(message = "请填写显示名")
    @Size(max = 32, message = "显示名不能超过 32 字")
    private String displayName;
}
