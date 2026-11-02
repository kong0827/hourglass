package com.devstudio.kanban.dto;

import lombok.Data;

import javax.validation.constraints.NotBlank;
import javax.validation.constraints.Pattern;

/** 空间成员角色变更：只允许 member/exec，owner 不参与变更。 */
@Data
public class MemberRoleRequest {

    @NotBlank(message = "请选择角色")
    @Pattern(regexp = "member|exec", message = "角色只能是成员或只读管理层")
    private String role;
}
